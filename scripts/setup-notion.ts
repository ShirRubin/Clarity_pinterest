// Creates the "Clarity Pins" database under NOTION_PARENT_PAGE_ID and
// writes the resulting NOTION_DB_ID back into .env.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import "dotenv/config";
import { notionClient } from "../src/notion.js";
import { DB_PROPERTIES, DB_TITLE } from "../src/schema.js";

const parent = process.env.NOTION_PARENT_PAGE_ID;
if (!parent) {
  console.error("NOTION_PARENT_PAGE_ID missing. Copy .env.example to .env, fill NOTION_TOKEN and NOTION_PARENT_PAGE_ID, then re-run.");
  process.exit(1);
}
if (process.env.NOTION_DB_ID) {
  console.log(`Database already exists (NOTION_DB_ID=${process.env.NOTION_DB_ID}). Nothing to do.`);
  process.exit(0);
}

const notion = notionClient();
const db = await notion.databases.create({
  parent: { type: "page_id", page_id: parent.replace(/-/g, "") },
  title: [{ type: "text", text: { content: DB_TITLE } }],
  properties: DB_PROPERTIES as never,
});

console.log(`Created database "${DB_TITLE}": ${db.id}`);

const envPath = new URL("../.env", import.meta.url);
if (existsSync(envPath)) {
  const env = readFileSync(envPath, "utf8");
  const updated = env.match(/^NOTION_DB_ID=/m)
    ? env.replace(/^NOTION_DB_ID=.*$/m, `NOTION_DB_ID=${db.id}`)
    : env + `\nNOTION_DB_ID=${db.id}\n`;
  writeFileSync(envPath, updated);
  console.log("Wrote NOTION_DB_ID to .env");
} else {
  console.log(`Add to .env manually: NOTION_DB_ID=${db.id}`);
}
