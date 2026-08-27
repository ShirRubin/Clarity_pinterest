// One-shot migration: add the "Scheduled date" property to the live DB.
// The DB predates the field; setup-notion only runs on fresh databases.
import "dotenv/config";
import { notionClient, dbId } from "../src/notion.js";

const notion = notionClient();
await notion.databases.update({
  database_id: dbId(),
  properties: { "Scheduled date": { date: {} } } as never,
});
console.log('✓ "Scheduled date" added to the Clarity Pins database.');
