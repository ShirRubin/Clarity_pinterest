// Writes exports/RELINK_TODO.md — the human-readable list of Pinterest pins whose
// destination link still has to be changed by hand (or by Claude with the browser
// JS tool allowed). Input: exports/relink-pins.json from match-pins.mjs, minus the
// pins already relinked (DONE below, verified on Pinterest 2026-09-06).
import { readFileSync, writeFileSync } from "node:fs";

const DONE = new Set([
  "1100356121486286731", // Slow October (UI edit)
  "1100356121487464913", // Winter Arc
  "1100356121487452687", // Quiet Ambition
  "1100356121487378020", // Twilight Rewatch
  "1100356121487366273", // Christmas Market
  "1100356121487312799", // Signature Scent
  "1100356121487295763", // Phone-Free
  "1100356121487284703", // Culture Night
  "3828275465745263552", // scheduled Twilight
  "3828267445766334208", // scheduled Bridgerton
]);

const all = JSON.parse(readFileSync("exports/relink-pins.json", "utf8"));
const todo = all.filter((p) => !DONE.has(p.id));
writeFileSync("exports/relink-pins.json", JSON.stringify(todo, null, 2));

const sched = todo.filter((p) => p.kind === "S").sort((a, b) => a.sched - b.sched);
const pub = todo.filter((p) => p.kind === "P");
const day = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);
const lines = [
  "# Pinterest relink TODO",
  "",
  `Generated ${new Date().toISOString().slice(0, 10)}. ${todo.length} pins still send readers to a board URL; each row is the pin's edit page and the link to paste.`,
  "",
  "**Rules learned:** published pins throttle after ~8 edits in a burst (\"hit a block we have in place to combat spam\") — pace ~1/min. Scheduled pins were not throttled. Editing a link resets that pin's link-click stats (fine — the old links were board pages).",
  "",
  `## Scheduled pins (${sched.length}) — do these first, they go live from Sep 7`,
  "",
  "Open the pin's page → Link field → paste → Done.",
  "",
  "| Goes live | Pin | New link |",
  "|---|---|---|",
  ...sched.map((p) => `| ${day(p.sched)} | [${p.title}](https://www.pinterest.com/ClarityBucketLists/scheduled-pin/${p.id}/) | ${p.to} |`),
  "",
  `## Published pins (${pub.length}) — ~1 per minute`,
  "",
  "Open the pin → ··· → Edit Pin → Link → Save → confirm \"Heads up\".",
  "",
  "| Pin | New link |",
  "|---|---|",
  ...pub.map((p) => `| [${p.title}](https://www.pinterest.com/pin/${p.id}/) | ${p.to} |`),
  "",
];
writeFileSync("exports/RELINK_TODO.md", lines.join("\n"));
console.log(`RELINK_TODO.md: ${sched.length} scheduled + ${pub.length} published = ${todo.length} pins`);
