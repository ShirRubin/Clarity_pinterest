// Re-date every pending pack to the current cadence, new lists first.
// The logic lives in src/stages/redate.ts (also run by `clarity pack`).
// Dry run by default, `--apply` writes.
//
//   npx tsx scripts/redate-packs.ts            # report
//   npx tsx scripts/redate-packs.ts --apply    # move
import "dotenv/config";
import { redatePending } from "../src/stages/redate.js";

await redatePending({ apply: process.argv.includes("--apply") });
