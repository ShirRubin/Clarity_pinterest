import { test } from "node:test";
import assert from "node:assert/strict";
import { planPullForward } from "../src/pullForward.js";
import { toUtcStamp } from "../src/csv.js";
import { localParts } from "../src/schedule.js";

const ts = (date: string, time: string) => Date.parse(`${toUtcStamp(date, time)}Z`) / 1000;
const pin = (id: string, date: string, time: string, link = `https://x/${id}`) => ({ id, link, ts: ts(date, time) });

test("the latest pins fill the earliest short day, into its free slot times", () => {
  const scheduled = [
    pin("a", "2026-10-01", "09:00 AM"),
    pin("b", "2026-10-01", "11:00 AM"),
    pin("c", "2026-10-01", "01:00 PM"),
    pin("d", "2026-10-01", "04:00 PM"),
    pin("late1", "2026-11-10", "09:00 AM"),
    pin("late2", "2026-11-12", "09:00 AM"),
  ];
  const moves = planPullForward(scheduled, [], "2026-10-01");
  assert.deepEqual(moves.map((m) => [m.id, m.toDate, m.toTime]), [
    ["late2", "2026-10-01", "06:00 PM"],
    ["late1", "2026-10-02", "09:00 AM"],
  ]);
  assert.equal(moves[0].toTs, ts("2026-10-01", "06:00 PM"));
});

test("stops once no scheduled pin sits later than the day being filled", () => {
  const scheduled = [pin("x", "2026-10-01", "09:00 AM"), pin("y", "2026-10-02", "09:00 AM")];
  const moves = planPullForward(scheduled, [], "2026-10-01");
  assert.deepEqual(moves.map((m) => [m.id, m.toDate]), [["y", "2026-10-01"]]);
});

test("never puts a URL within 7 days of the same URL, scheduled or already published", () => {
  const scheduled = [
    pin("same-sched", "2026-10-03", "09:00 AM", "https://x/shared"),
    pin("late", "2026-11-10", "09:00 AM", "https://x/shared"),
    pin("pub-clash", "2026-11-09", "09:00 AM", "https://x/published"),
  ];
  const created = [{ id: "p", link: "https://x/published", ts: ts("2026-09-28", "09:00 AM") }];
  const moves = planPullForward(scheduled, created, "2026-10-01");
  const final = scheduled.map((p) => ({ ...p, date: moves.find((m) => m.id === p.id)?.toDate ?? localParts(p.ts).date }));
  const all = [...final, { id: "p", link: "https://x/published", date: "2026-09-28" }];
  for (const a of all)
    for (const b of all)
      if (a.id < b.id && a.link === b.link)
        assert.ok(Math.abs(Date.parse(a.date) - Date.parse(b.date)) >= 7 * 86_400_000, `${a.id} ${a.date} vs ${b.id} ${b.date}`);
  assert.ok(moves.length > 0);
});

test("respects Israel's DST change when computing the new timestamp", () => {
  const scheduled = [pin("late", "2026-12-01", "09:00 AM")];
  const [m] = planPullForward(scheduled, [], "2026-10-30");
  assert.equal(m.toDate, "2026-10-30");
  assert.equal(m.toTs, ts("2026-10-30", "09:00 AM"));
});
