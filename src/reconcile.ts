// src/reconcile.ts — Pinterest's own pin lists are the truth; packs on disk are
// what we *think* happened. Diff them before and after every posting session.
// Pure; the stage reads the JSON files and can apply the "already live" fixes.
import { localParts } from "./schedule.js";
import type { PackInfo } from "./packs.js";

/** One pin as the skill's browser snippet normalises it from Pinterest's resources. */
export interface PinterestPin {
  id: string;
  title: string;
  link?: string;
  ts: number; // unix seconds
  kind: "scheduled" | "published";
}

export interface Reconciliation {
  alreadyLive: { pack: PackInfo; pin: PinterestPin }[]; // in packs/ but Pinterest already has it
  noon: PinterestPin[]; // scheduled at 12:00 local — duplicates
  sameDay: { date: string; title: string; ids: string[] }[];
  missing: PackInfo[]; // in posted/, dated today or later, not on Pinterest
}

const norm = (s: string) => s.trim().toLowerCase();
const key = (title: string, date: string) => `${norm(title)}@${date}`;

export function reconcile(pins: PinterestPin[], pending: PackInfo[], posted: PackInfo[], today: string): Reconciliation {
  const byKey = new Map<string, PinterestPin>();
  const sameDayGroups = new Map<string, PinterestPin[]>();
  const noon: PinterestPin[] = [];
  for (const pin of pins) {
    const { date, hour } = localParts(pin.ts);
    const k = key(pin.title, date);
    if (!byKey.has(k)) byKey.set(k, pin);
    sameDayGroups.set(k, [...(sameDayGroups.get(k) ?? []), pin]);
    if (pin.kind === "scheduled" && hour === 12) noon.push(pin);
  }

  const alreadyLive = pending.flatMap((pack) => {
    const pin = byKey.get(key(pack.text.title, pack.date));
    return pin ? [{ pack, pin }] : [];
  });

  const sameDay = [...sameDayGroups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([k, group]) => ({ date: k.slice(k.lastIndexOf("@") + 1), title: group[0].title, ids: group.map((p) => p.id) }));

  const missing = posted.filter((pack) => pack.date >= today && !byKey.has(key(pack.text.title, pack.date)));

  return { alreadyLive, noon, sameDay, missing };
}

const schedUrl = (id: string) => `https://www.pinterest.com/ClarityBucketLists/scheduled-pin/${id}/`;

export function formatReconcile(r: Reconciliation): string {
  const L: string[] = [];
  for (const { pack, pin } of r.alreadyLive) L.push(`already on Pinterest  ${pack.dir}  → pin ${pin.id}  (run: clarity posted ${pack.dir} ${pin.id})`);
  for (const pin of r.noon) L.push(`12:00 PM duplicate    "${pin.title}"  delete at ${schedUrl(pin.id)}`);
  for (const g of r.sameDay) L.push(`same title twice      ${g.date}  "${g.title}"  ids ${g.ids.join(", ")}`);
  for (const pack of r.missing) L.push(`missing on Pinterest  ${pack.dir}  ("${pack.text.title}") — repost`);
  if (!L.length) L.push("Pinterest and the packs agree — nothing to fix.");
  return L.join("\n");
}
