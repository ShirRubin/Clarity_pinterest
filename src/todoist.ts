// src/todoist.ts — the little Todoist client the nightly job uses for the review
// reminder. Plain fetch, no SDK, same spirit as review-worker/src/notion-fetch.ts.
//
// Two APIs are needed, because they do not overlap:
//   • REST  — create / update / close a task. Stable and simple.
//   • Sync  — reminders. REST has no reminder endpoint at all.
// Both now live under the unified /api/v1 prefix (the old /rest/v2 and /sync/v9
// hosts return 410). SYNC_BASES stays a list so a future move costs one line.
import { randomUUID } from "node:crypto";

// Todoist retired /rest/v2 and /sync/v9 — both answer 410 and point at /api/v1.
// Verified against the live account on 2026-09-22 by scripts/check-todoist.ts.
const REST_BASE = "https://api.todoist.com/api/v1";
const SYNC_BASES = ["https://api.todoist.com/api/v1/sync"];

export const TODOIST_TOKEN_VAR = "TODOIST_TOKEN";
export const TODOIST_PROJECT_VAR = "TODOIST_PROJECT_ID";

/** True when the job is configured to talk to Todoist at all. */
export function todoistConfigured(): boolean {
  return Boolean(process.env[TODOIST_TOKEN_VAR]);
}

function token(): string {
  const t = process.env[TODOIST_TOKEN_VAR];
  if (!t) throw new Error(`${TODOIST_TOKEN_VAR} is not set — see CLAUDE.md (Environment).`);
  return t;
}

async function rest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${REST_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
      ...(init.body ? { "X-Request-Id": randomUUID() } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`Todoist ${init.method ?? "GET"} ${path} → ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  // 204 on close/delete.
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export interface TaskFields {
  content: string;
  description: string;
  /** Absolute instant, UTC ISO. */
  dueUtcISO: string;
  /** IANA zone the due time was expressed in, so Todoist keeps it across DST. */
  timezone: string;
}

export interface TodoistTask {
  id: string;
  content: string;
  url?: string;
}

export async function createTask(fields: TaskFields, projectId?: string): Promise<TodoistTask> {
  return rest<TodoistTask>("/tasks", {
    method: "POST",
    body: JSON.stringify({
      content: fields.content,
      description: fields.description,
      due_datetime: fields.dueUtcISO,
      ...(projectId ? { project_id: projectId } : {}),
    }),
  });
}

export async function updateTask(id: string, fields: TaskFields): Promise<void> {
  await rest<TodoistTask>(`/tasks/${id}`, {
    method: "POST",
    body: JSON.stringify({
      content: fields.content,
      description: fields.description,
      due_datetime: fields.dueUtcISO,
    }),
  });
}

export async function closeTask(id: string): Promise<void> {
  await rest<void>(`/tasks/${id}/close`, { method: "POST" });
}

/** Only used by the probe script — the job closes tasks, it never deletes them. */
export async function deleteTask(id: string): Promise<void> {
  await rest<void>(`/tasks/${id}`, { method: "DELETE" });
}

/**
 * Does this task still exist and is it still open? Used to spot a task ticked
 * off by hand, so the job raises a fresh one instead of updating a done task
 * back into view.
 *
 * The v1 API keeps answering 200 for a completed task and reports it as
 * `checked` — the old REST v2 `is_completed` is gone, and reading the wrong
 * field silently makes every task look open (verified 2026-09-22).
 */
export async function taskIsOpen(id: string): Promise<boolean> {
  try {
    const task = await rest<TodoistTask & { checked?: boolean; is_deleted?: boolean }>(`/tasks/${id}`);
    return Boolean(task) && !task.checked && !task.is_deleted;
  } catch (err) {
    // 404 = deleted, 400 = the stored id is no longer meaningful to Todoist.
    // Both mean "raise a fresh one" — a stale id must never wedge the job nightly.
    if (err instanceof Error && /→ 40[04]/.test(err.message)) return false;
    throw err;
  }
}

// --- Sync: reminders -----------------------------------------------------------------

let syncBase: string | undefined;

async function sync(commands: unknown[]): Promise<Record<string, unknown>> {
  const bases = syncBase ? [syncBase] : SYNC_BASES;
  let lastErr = "";
  for (const base of bases) {
    const res = await fetch(base, {
      method: "POST",
      headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ commands }),
    });
    if (res.ok) {
      if (!syncBase) {
        syncBase = base;
        console.log(`  (Todoist sync endpoint: ${base})`);
      }
      return (await res.json()) as Record<string, unknown>;
    }
    lastErr = `${base} → ${res.status} ${(await res.text()).slice(0, 200)}`;
    // Only a missing/retired endpoint is worth trying the next base for.
    if (res.status !== 404 && res.status !== 410) break;
  }
  throw new Error(`Todoist sync failed: ${lastErr}`);
}

function assertNoCommandError(out: Record<string, unknown>, uuid: string): void {
  const status = (out.sync_status ?? {}) as Record<string, unknown>;
  const result = status[uuid];
  if (result && result !== "ok") throw new Error(`Todoist command failed: ${JSON.stringify(result).slice(0, 300)}`);
}

/** Add an absolute reminder to a task; returns its id. */
export async function addReminder(taskId: string, atUtcISO: string, timezone: string): Promise<string | undefined> {
  const uuid = randomUUID();
  const tempId = randomUUID();
  const out = await sync([
    {
      type: "reminder_add",
      uuid,
      temp_id: tempId,
      args: { item_id: taskId, type: "absolute", due: { date: atUtcISO, timezone } },
    },
  ]);
  assertNoCommandError(out, uuid);
  const mapping = (out.temp_id_mapping ?? {}) as Record<string, string | number>;
  const id = mapping[tempId];
  return id === undefined ? undefined : String(id);
}

/** Move an existing reminder to a new instant. */
export async function updateReminder(reminderId: string, atUtcISO: string, timezone: string): Promise<void> {
  const uuid = randomUUID();
  const out = await sync([
    { type: "reminder_update", uuid, args: { id: reminderId, due: { date: atUtcISO, timezone } } },
  ]);
  assertNoCommandError(out, uuid);
}

export async function deleteReminder(reminderId: string): Promise<void> {
  const uuid = randomUUID();
  const out = await sync([{ type: "reminder_delete", uuid, args: { id: reminderId } }]);
  assertNoCommandError(out, uuid);
}
