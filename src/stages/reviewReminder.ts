// The daily nudge: while lists sit in "In Review", keep one Todoist task open
// with the review link, due 09:00 and carrying a reminder, re-dated every night
// until the queue empties. Called last by the nightly job so it sees the night's
// final state (revise can push rows INTO the queue, generate can add more).
//
// The decisions live in ../reviewReminder.ts and are unit-tested; this file is
// only I/O: Notion in, Todoist out, task id remembered on disk.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { pinsByStatus } from "../notion.js";
import { POST_TZ } from "../schedule.js";
import { localToday } from "../publishedFlip.js";
import { planReminder, localHHMM, localToUtcISO, type ReminderState } from "../reviewReminder.js";
import {
  todoistConfigured,
  createTask,
  updateTask,
  closeTask,
  taskIsOpen,
  addReminder,
  updateReminder,
  TODOIST_TOKEN_VAR,
  TODOIST_PROJECT_VAR,
} from "../todoist.js";

const STATE_FILE = path.join("exports", "review-reminder.json");

interface StoredState extends ReminderState {
  reminderId?: string;
  lastCount?: number;
  lastRun?: string;
}

function readState(): StoredState {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8")) as StoredState;
  } catch {
    return {};
  }
}

function writeState(state: StoredState): void {
  mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

/** Keeps the reminder task in step with the review queue. Returns the queue size. */
export async function runReviewReminder(today: string = localToday()): Promise<number> {
  const rows = await pinsByStatus("In Review");
  const names = rows.map((r) => r.name);

  if (!todoistConfigured()) {
    console.log(
      names.length
        ? `${names.length} list(s) in review, but ${TODOIST_TOKEN_VAR} is not set — no reminder raised.`
        : `Nothing in review. (${TODOIST_TOKEN_VAR} is not set; reminders are off.)`,
    );
    return names.length;
  }

  const state = readState();

  // A task ticked off by hand in Todoist must not be updated back to life —
  // if the queue is still full the next run raises a fresh one.
  if (state.taskId && !(await taskIsOpen(state.taskId))) {
    console.log(`Previous reminder (${state.taskId}) is gone or already done — starting a fresh one.`);
    delete state.taskId;
    delete state.reminderId;
  }

  const plan = planReminder(state, names, today, localHHMM(new Date(), POST_TZ));
  const projectId = process.env[TODOIST_PROJECT_VAR];

  switch (plan.kind) {
    case "none":
      console.log(`Nothing in review — no reminder needed.`);
      return 0;

    case "close":
      await closeTask(plan.taskId);
      console.log(`✓ Review queue is empty — reminder task closed.`);
      writeState({ lastCount: 0, lastRun: today });
      return 0;

    case "create":
    case "update": {
      const fields = {
        content: plan.content,
        description: plan.description,
        dueUtcISO: localToUtcISO(plan.dueLocal, POST_TZ),
        timezone: POST_TZ,
      };
      let taskId: string;
      let reminderId: string | undefined;

      if (plan.kind === "create") {
        const task = await createTask(fields, projectId);
        taskId = task.id;
        reminderId = await addReminder(taskId, fields.dueUtcISO, POST_TZ);
        console.log(`✓ Reminder raised: "${plan.content}" due ${plan.dueLocal} (task ${taskId})`);
      } else {
        taskId = plan.taskId;
        await updateTask(taskId, fields);
        reminderId = state.reminderId;
        if (reminderId) {
          await updateReminder(reminderId, fields.dueUtcISO, POST_TZ);
        } else {
          reminderId = await addReminder(taskId, fields.dueUtcISO, POST_TZ);
        }
        console.log(`✓ Reminder re-dated: "${plan.content}" due ${plan.dueLocal} (task ${taskId})`);
      }

      writeState({ taskId, reminderId, lastCount: names.length, lastRun: today });
      return names.length;
    }
  }
}
