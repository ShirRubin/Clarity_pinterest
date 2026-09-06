// One-off (2026-09-06): the RSS backfill left 8 rows named "Pin <shortcode>"
// whose Pin URL is a short link that no longer resolves and that carry no image —
// nothing to transcribe, nothing to link. Archive them so `clarity blogpost`
// stops retrying them every run.
import "dotenv/config";
import { listAllPins, updatePin } from "../src/notion.js";

const apply = process.argv.includes("--apply");
const stubs = (await listAllPins()).filter(
  (r) => /^Pin [A-Za-z0-9]{8}$/.test(r.name) && r.imageUrls.length === 0 && r.status !== "Archived",
);
for (const r of stubs) {
  console.log(`${apply ? "archived" : "would archive"}  ${r.name}  ${r.pinUrl ?? ""}`);
  if (apply) await updatePin(r.pageId, { status: "Archived", notes: "Archived 2026-09-06: short-link RSS stub, no image, pin unresolvable." });
}
console.log(`${stubs.length} stub row(s)${apply ? " archived" : ""}.`);
