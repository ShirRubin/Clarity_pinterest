// src/packs.ts — the pack directories are the posting calendar of record.
// exports/packs/ = still to hand to Pinterest; exports/posted/ = already in its
// scheduler. This is the one place that knows the directory-name format.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parsePostText, type PackText } from "./packText.js";

export interface PackInfo {
  where: "packs" | "posted";
  dir: string;
  path: string;
  date: string;
  slug: string;
  template: string;
  text: PackText;
}

const NAME = /^(\d{4}-\d{2}-\d{2})--(.+)--([a-z-]+)$/;

export function splitPackName(dir: string): { date: string; slug: string; template: string } | undefined {
  const m = NAME.exec(dir);
  return m ? { date: m[1], slug: m[2], template: m[3] } : undefined;
}

export async function readPacks(where: "packs" | "posted"): Promise<PackInfo[]> {
  const base = path.join("exports", where);
  let names: string[] = [];
  try {
    names = await readdir(base);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return [];
  }
  const out: PackInfo[] = [];
  for (const dir of names.sort()) {
    const parts = splitPackName(dir);
    if (!parts) continue;
    let txt: string;
    try {
      txt = await readFile(path.join(base, dir, "post.txt"), "utf8");
    } catch {
      continue; // a pack without post.txt is not a pack
    }
    out.push({ where, dir, path: path.join(base, dir), ...parts, text: parsePostText(txt) });
  }
  return out;
}
