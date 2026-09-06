import "dotenv/config";
import { listAllPins } from "../src/notion.js";
const rows = await listAllPins();
for (const r of rows.filter((r) => /^Pin [A-Za-z0-9]{8}$/.test(r.name)))
  console.log(r.name, "|", r.status, "|", r.source, "|", r.pinUrl, "| imgs", r.imageUrls.length, "| dest", r.destinationLink ?? "-", "| notes", (r.notes ?? "").slice(0, 60));
console.log("total rows", rows.length, "| backfill", rows.filter((r) => r.source === "backfill").length);
