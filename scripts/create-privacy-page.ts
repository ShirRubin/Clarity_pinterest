import { notionClient } from "../src/notion.js";

const notion = notionClient();
const parent = process.env.NOTION_PARENT_PAGE_ID!;

const p = (text: string) => ({
  object: "block" as const,
  type: "paragraph" as const,
  paragraph: { rich_text: [{ type: "text" as const, text: { content: text } }] },
});
const h = (text: string) => ({
  object: "block" as const,
  type: "heading_2" as const,
  heading_2: { rich_text: [{ type: "text" as const, text: { content: text } }] },
});

const page = await notion.pages.create({
  parent: { type: "page_id", page_id: parent.replace(/-/g, "") },
  properties: {
    title: { title: [{ type: "text", text: { content: "Clarity Bucket Lists â€” Privacy Policy" } }] },
  },
  children: [
    p("Last updated: August 20, 2026"),
    p("Clarity Bucket Lists (\"Clarity\", \"we\") publishes curated bucket-list content at clarity-lists.com and on our Pinterest profile @claritybucketlists. This policy describes how our internal publishing tool (\"Clarity Bucket lists pin publisher\") handles data."),
    h("What the app does"),
    p("The app is a private, single-user tool used only by the Clarity team. It publishes our own original pins to our own Pinterest boards and reads analytics about our own pins via the Pinterest API."),
    h("Data we access"),
    p("Through the Pinterest API, the app accesses only data belonging to our own Pinterest business account: our boards, our pins, and analytics for our pins. It does not access, collect, or store data about any other Pinterest user."),
    h("Data we store"),
    p("Content drafts, our own pin metadata, and per-pin analytics for our own account are stored in our private content database. We do not sell or share this data with anyone."),
    h("Website visitors"),
    p("Our website does not collect personal information. If analytics are added in the future, they will be privacy-friendly and cookie-minimal, and this policy will be updated."),
    h("Contact"),
    p("Questions about this policy: shir.rubin6@gmail.com"),
  ],
});
console.log("PAGE_ID=" + page.id);
console.log("URL=https://www.notion.so/" + page.id.replace(/-/g, ""));
