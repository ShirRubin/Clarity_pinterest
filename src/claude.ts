// Content generation runs through the Claude Code CLI in headless mode (`claude -p`),
// NOT the Anthropic SDK. The CLI authenticates with the user's Claude Max subscription,
// so the pipeline needs no ANTHROPIC_API_KEY and generation costs nothing extra.
//
// Notes on the flags:
//   --system-prompt      replaces Claude Code's agent system prompt entirely, so this is
//                        pure generation with no coding-agent behaviour.
//   --json-schema        structured output. The API requires a top-level OBJECT, so array
//                        results are wrapped in {"result": ...} and unwrapped here.
//   --disable-slash-commands / --disallowed-tools
//                        no skills, no tool loops — one prompt in, one JSON blob out.
// Never pass --bare: it forces ANTHROPIC_API_KEY auth and ignores the OAuth login.
import { spawn } from "node:child_process";
import "dotenv/config";

// Alias ('opus'/'sonnet') or full id. Override with CLARITY_MODEL in .env.
const MODEL = process.env.CLARITY_MODEL || "opus";
const CLI = process.env.CLAUDE_CLI || "claude";
// Generous ceiling, not an expected duration: a 10-idea Opus call with extended
// thinking measured ~85s, but heavier prompts run several times longer.
const TIMEOUT_MS = Number(process.env.CLARITY_TIMEOUT_MS || 900_000);

// The CLI's --output-format json envelope (only the fields we rely on).
interface CliEnvelope {
  is_error?: boolean;
  subtype?: string;
  result?: string;
  total_cost_usd?: number;
  api_error_status?: number;
  permission_denials?: unknown[];
}

function runCli(args: string[], stdin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // claude.exe is a real binary, so no shell — this dodges cmd.exe's 8191-char
    // argument limit (CreateProcess allows 32767, enough for our system prompts).
    const child = spawn(CLI, args, { stdio: ["pipe", "pipe", "pipe"], shell: false });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Claude CLI timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) =>
      reject(new Error(`Could not run "${CLI}" — is Claude Code on PATH? (${err.message})`)),
    );
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`Claude CLI exited ${code}: ${stderr.slice(0, 500)}`));
      resolve(stdout);
    });

    child.stdin.write(stdin);
    child.stdin.end();
  });
}

/**
 * Ask Claude for JSON and parse it.
 *
 * @param schema JSON Schema for the expected value. Arrays are wrapped automatically.
 *               Omit it to fall back to fence-stripping the raw text.
 */
export async function generateJSON<T>(
  system: string,
  user: string,
  schema?: Record<string, unknown>,
  opts?: { allowFileRead?: boolean; addDirs?: string[] },
): Promise<T> {
  // allowFileRead lets the model view local files named in the prompt (e.g. a pin
  // image to transcribe). Everything else stays locked down.
  // IMPORTANT: headless mode silently DENIES Read outside the CLI's working dir —
  // and a schema-forced reply can't refuse, so the model fabricates plausible
  // output instead. Any dir holding files the prompt references MUST be passed in
  // addDirs, and a denied permission is treated as a hard failure below.
  const disallowed = opts?.allowFileRead
    ? "Bash,Edit,Write,Glob,Grep,WebFetch,WebSearch,Task"
    : "Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch,Task";
  const args = [
    "-p",
    "--output-format",
    "json",
    "--model",
    MODEL,
    "--disable-slash-commands",
    "--disallowed-tools",
    disallowed,
    "--system-prompt",
    `${system}\n\nReply with ONLY the requested JSON. No prose, no explanation, no code fences.`,
  ];
  for (const dir of opts?.addDirs ?? []) args.push("--add-dir", dir);
  // The API rejects a non-object top-level schema, so arrays ride inside {"result": …}.
  if (schema) {
    args.push(
      "--json-schema",
      JSON.stringify({
        type: "object",
        properties: { result: schema },
        required: ["result"],
        additionalProperties: false,
      }),
    );
  }

  const raw = await runCli(args, user);

  let envelope: CliEnvelope;
  try {
    envelope = JSON.parse(raw) as CliEnvelope;
  } catch {
    throw new Error(`Claude CLI returned non-JSON output: ${raw.slice(0, 300)}`);
  }
  if (envelope.is_error) {
    throw new Error(`Claude CLI error${envelope.api_error_status ? ` (${envelope.api_error_status})` : ""}: ${envelope.result ?? envelope.subtype ?? "unknown"}`);
  }
  if (envelope.permission_denials?.length) {
    throw new Error(
      `Claude CLI denied ${envelope.permission_denials.length} permission(s) — a schema-forced reply after a denied file read is fabricated, not transcribed: ${JSON.stringify(envelope.permission_denials).slice(0, 300)}`,
    );
  }
  const text = envelope.result ?? "";
  if (!text.trim()) throw new Error("Claude returned an empty result.");

  const parsed = parseJSON(text);
  // Unwrap the schema envelope; without a schema the model answers with the value itself.
  if (schema && parsed && typeof parsed === "object" && "result" in (parsed as object)) {
    return (parsed as { result: T }).result;
  }
  return parsed as T;
}

// Tolerant parse: exact JSON, then fenced JSON, then the outermost JSON value in the text.
function parseJSON(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through */
  }
  const fenced = trimmed.replace(/^[\s\S]*?```(?:json)?\s*/, "").replace(/```[\s\S]*$/, "").trim();
  if (fenced) {
    try {
      return JSON.parse(fenced);
    } catch {
      /* fall through */
    }
  }
  const starts = ["[", "{"].map((c) => trimmed.indexOf(c)).filter((i) => i >= 0);
  const start = starts.length ? Math.min(...starts) : -1;
  const end = Math.max(trimmed.lastIndexOf("]"), trimmed.lastIndexOf("}"));
  if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
  throw new Error(`Could not parse JSON from model output: ${trimmed.slice(0, 300)}`);
}
