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

const TITLE_HEADER = `TITLE (paste as pin title):`;
const DESCRIPTION_HEADER = `DESCRIPTION (paste as pin description):`;
const ALT_HEADER = `ALT TEXT (paste into the pin's alt-text field):`;

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
    TITLE_HEADER,
    t.title,
    ``,
    DESCRIPTION_HEADER,
    t.description,
    ``,
    ALT_HEADER,
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

/** Recognize a section marker only when preceded by a blank line and matching an exact header form. */
function isMarker(line: string, prevBlank: boolean): boolean {
  if (!prevBlank) return false;
  return (
    line === TITLE_HEADER ||
    line === DESCRIPTION_HEADER ||
    line === ALT_HEADER ||
    /^(BOARD|DESTINATION LINK|TAGGED TOPICS|POSTED): /.test(line) ||
    line.startsWith("After posting:")
  );
}

/** Text from a section header until the next recognized section marker, with trailing blank lines stripped. */
function block(lines: string[], header: string): string {
  const i = lines.findIndex((l) => l.startsWith(header));
  if (i < 0) return "";

  const out: string[] = [];
  for (let j = i + 1; j < lines.length; j++) {
    // Only recognize a marker if it's preceded by a blank line (not on the first content line)
    const prevBlank = j > i + 1 && lines[j - 1] === "";
    if (isMarker(lines[j], prevBlank)) {
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

/** Extract a field value. Top-level fields (POST ON, POST AT, PAGE, IMAGE) can start at the beginning or after blank lines. Body fields (BOARD) must be after blank lines. */
function field(txt: string, key: string): string | undefined {
  const lines = txt.split(/\r?\n/);
  const topLevelKeys = ["POST ON", "POST AT", "PAGE", "IMAGE"];
  const isTopLevel = topLevelKeys.includes(key);

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(`${key}: `)) {
      // For top-level fields, allow match at start or after blank line
      // For body fields, require blank line before
      if (isTopLevel || i === 0 || lines[i - 1] === "") {
        const match = /^[^:]+: (.+?)(?:\s*\(|$)/.exec(lines[i]);
        return match?.[1]?.trim();
      }
    }
  }
  return undefined;
}

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
    title: block(lines, TITLE_HEADER),
    description: block(lines, DESCRIPTION_HEADER),
    alt: block(lines, ALT_HEADER),
    board: field(txt, "BOARD") ?? "",
    link: /^DESTINATION LINK: (\S+)/m.exec(txt)?.[1] ?? "",
    ...(posted ? { posted: { at: posted[1], pinId: posted[2] } } : {}),
  };
}
