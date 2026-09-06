// Match Pinterest's own pin list (exports/pinterest-pins.txt, dumped from the
// browser: "S id scheduled_ts link title" / "P id link title") to blog URLs via
// exports/relink.json (Notion rows). Writes exports/relink-pins.json =
// [{kind, id, sched, title, to, via}] for the browser relink step.
import { readFileSync, writeFileSync } from "node:fs";

const rows = JSON.parse(readFileSync("exports/relink.json", "utf8"));
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const byPinId = new Map();
const byTitle = new Map();
const byName = new Map();
for (const r of rows) {
  const id = r.pinUrl && /\/pin\/(\d+)/.exec(r.pinUrl)?.[1];
  if (id) byPinId.set(id, r);
  if (r.pinTitle) byTitle.set(norm(r.pinTitle), r);
  byName.set(norm(r.name), r);
}

const out = [];
const miss = [];
for (const line of readFileSync("exports/pinterest-pins.txt", "utf8").split("\n").filter(Boolean)) {
  const m = /^([SP]) (\d+) (?:(\d+) )?(\S+) (.*)$/.exec(line);
  if (!m) continue;
  const [, kind, id, sched, link, title] = m;
  if (link.includes("clarity-lists.com")) continue;
  const t = norm(title);
  let r = byPinId.get(id) ?? byTitle.get(t) ?? byName.get(t);
  if (!r) {
    // pipeline pin titles are shortened Notion names — prefix-match on the part before "bucket list"
    const head = t.split(/ bucket list/)[0];
    r = [...byName.entries()].find(([n]) => n.replace(/^the /, "").startsWith(head))?.[1];
  }
  if (r) out.push({ kind, id, sched: sched ? +sched : null, title, to: r.to, via: r.name });
  else miss.push({ kind, id, title });
}
writeFileSync("exports/relink-pins.json", JSON.stringify(out, null, 2));
console.log(
  `matched ${out.length} (${out.filter((x) => x.kind === "S").length} scheduled, ${out.filter((x) => x.kind === "P").length} published) | unmatched ${miss.length}`,
);
for (const x of miss) console.log(`  MISS ${x.kind} ${x.id} ${x.title}`);
