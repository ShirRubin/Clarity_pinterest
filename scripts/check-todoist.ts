// One-off probe: does this machine's TODOIST_TOKEN actually work, and which of
// Todoist's two Sync hosts answers? Creates a throwaway task with a reminder a
// couple of minutes out, reads it back, then deletes it again.
//
//   npx tsx scripts/check-todoist.ts
//
// Nothing here is part of the nightly job — it exists so the wire calls in
// src/todoist.ts can be verified by hand after the token is first pasted in.
import "dotenv/config";
import { POST_TZ } from "../src/schedule.js";
import { localHHMM, localToUtcISO } from "../src/reviewReminder.js";
import { localToday } from "../src/publishedFlip.js";
import {
  todoistConfigured,
  createTask,
  updateTask,
  taskIsOpen,
  deleteTask,
  addReminder,
  updateReminder,
  TODOIST_TOKEN_VAR,
  TODOIST_PROJECT_VAR,
} from "../src/todoist.js";

if (!todoistConfigured()) {
  console.error(`${TODOIST_TOKEN_VAR} is not set in .env — nothing to probe.`);
  process.exit(1);
}

const projectId = process.env[TODOIST_PROJECT_VAR];
console.log(`Project: ${projectId ?? "(none set — the task will land in Inbox)"}`);

// Two minutes out, so the reminder is genuinely in the future while we look at it.
const now = new Date();
const [h, m] = localHHMM(now, POST_TZ).split(":").map(Number);
const at = `${localToday()}T${String(h).padStart(2, "0")}:${String(Math.min(m + 2, 59)).padStart(2, "0")}:00`;
const atUtc = localToUtcISO(at, POST_TZ);
console.log(`Reminder target: ${at} ${POST_TZ} = ${atUtc}`);

const fields = {
  content: "Clarity probe — safe to ignore",
  description: "Created by scripts/check-todoist.ts. It deletes itself.",
  dueUtcISO: atUtc,
  timezone: POST_TZ,
};

let taskId = "";
try {
  const task = await createTask(fields, projectId);
  taskId = task.id;
  console.log(`✓ createTask   → ${taskId}`);

  const reminderId = await addReminder(taskId, atUtc, POST_TZ);
  console.log(`✓ addReminder  → ${reminderId ?? "(no id returned — check Todoist by hand)"}`);

  await updateTask(taskId, { ...fields, content: "Clarity probe — updated" });
  console.log(`✓ updateTask   → ok`);

  if (reminderId) {
    await updateReminder(reminderId, atUtc, POST_TZ);
    console.log(`✓ updateReminder → ok`);
  }

  console.log(`✓ taskIsOpen   → ${await taskIsOpen(taskId)}`);
  console.log(`\nAll Todoist calls the nightly job makes are working.`);
} catch (err) {
  console.error(`\nx probe failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  if (taskId) {
    try {
      await deleteTask(taskId);
      console.log(`(probe task ${taskId} deleted)`);
    } catch (err) {
      console.error(`Could not delete the probe task ${taskId} — remove it by hand. ${String(err)}`);
    }
  }
}
