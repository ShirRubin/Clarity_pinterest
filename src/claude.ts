import Anthropic from "@anthropic-ai/sdk";
import "dotenv/config";

// claude-opus-5 unless overridden via CLARITY_MODEL in .env.
const MODEL = process.env.CLARITY_MODEL || "claude-opus-5";

const client = new Anthropic();

// Ask Claude for JSON and parse it. Server-side refusal fallback is enabled so a
// rare safety decline reroutes to Opus 4.8 inside the same call instead of failing.
export async function generateJSON<T>(system: string, user: string): Promise<T> {
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-06-01"],
    fallbacks: [{ model: "claude-opus-4-8" }],
    system,
    messages: [{ role: "user", content: user }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error(`Claude refused the request: ${response.stop_details?.explanation ?? "no explanation"}`);
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("Response hit max_tokens — output truncated, not parsing.");
  }

  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const jsonText = text.replace(/^[\s\S]*?```(?:json)?\s*/, "").replace(/```[\s\S]*$/, "").trim() || text.trim();
  try {
    return JSON.parse(jsonText) as T;
  } catch {
    // Model may have answered without fences; try to find the outermost JSON value.
    const start = Math.min(...["[", "{"].map((c) => text.indexOf(c)).filter((i) => i >= 0));
    const end = Math.max(text.lastIndexOf("]"), text.lastIndexOf("}"));
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1)) as T;
    throw new Error(`Could not parse JSON from model output: ${text.slice(0, 300)}`);
  }
}
