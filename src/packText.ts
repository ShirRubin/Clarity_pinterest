// src/packText.ts — the post.txt inside every pack. Writer and reader live
// together so a field added to one cannot be forgotten by the other. The file
// is also read by a human during a manual posting session, hence the prose.
export interface PackText {
  date: string;
  time?: string;
  pageId?: string;
  image: string;
  title: string;
  description: string;
  alt: string;
  board: string;
  link: string;
  posted?: { at: string; pinId: string };
}

const TOPICS_HELP = [
  `TAGGED TOPICS: always add 10 (the max) in the pin builder. The taxonomy has no`,
  `"bucket list"/"self care" topics — search concrete nouns from the list items`,
  `(tea, baking, candles, movie night...) plus vibe topics (Cozy Living, Autumn Day).`,
];

export function postText(t: Omit<PackText, "posted">): string {
  return [
    `POST ON: ${t.date}   (native scheduler: toggle "Publish at a later date")`,
    ...(t.time ? [`POST AT: ${t.time}`] : []),
    ...(t.pageId ? [`PAGE: ${t.pageId}`] : []),
    ``,
    `IMAGE: ${t.image}`,
    ``,
    `TITLE (paste as pin title):`,
    t.title,
    ``,
    `DESCRIPTION (paste as pin description):`,
    t.description,
    ``,
    `ALT TEXT (paste into the pin's alt-text field):`,
    t.alt,
    ``,
    `BOARD: ${t.board}`,
    `DESTINATION LINK: ${t.link}`,
    ``,
    ...TOPICS_HELP,
    ``,
    `After posting: paste the live pin's URL into the row's "Pin URL" in Notion.`,
  ].join("\n");
}

/** Text from a section header until the next recognized section marker, with trailing blank lines stripped. */
function block(lines: string[], header: string): string {
  const i = lines.findIndex((l) => l.startsWith(header));
  if (i < 0) return "";

  const markers = [
    "TITLE", "DESCRIPTION", "ALT TEXT", "BOARD:", "DESTINATION LINK:",
    "TAGGED TOPICS:", "After posting:", "POSTED:"
  ];

  const out: string[] = [];
  for (let j = i + 1; j < lines.length; j++) {
    // Check if this line starts with a recognized marker
    if (markers.some(m => lines[j].startsWith(m))) {
      break;
    }
    out.push(lines[j]);
  }

  // Strip trailing blank lines
  while (out.length > 0 && out[out.length - 1] === "") {
    out.pop();
  }

  return out.join("\n");
}

const field = (txt: string, key: string) => new RegExp(`^${key}: (.+?)\\s*(?:\\(|$)`, "m").exec(txt)?.[1]?.trim();

export function parsePostText(txt: string): PackText {
  const lines = txt.split(/\r?\n/);
  const posted = /^POSTED: (\S+) pin (\d+)/m.exec(txt);
  const time = field(txt, "POST AT");
  const pageId = field(txt, "PAGE");
  return {
    date: field(txt, "POST ON") ?? "",
    ...(time ? { time } : {}),
    ...(pageId ? { pageId } : {}),
    image: field(txt, "IMAGE") ?? "",
    title: block(lines, "TITLE"),
    description: block(lines, "DESCRIPTION"),
    alt: block(lines, "ALT TEXT"),
    board: field(txt, "BOARD") ?? "",
    link: /^DESTINATION LINK: (\S+)/m.exec(txt)?.[1] ?? "",
    ...(posted ? { posted: { at: posted[1], pinId: posted[2] } } : {}),
  };
}
