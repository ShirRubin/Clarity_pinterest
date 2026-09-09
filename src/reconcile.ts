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

/** Which of two same-key candidates `byKey` should hold: never the 12:00 PM
 *  duplicate over a legitimate slot, and never depend on input order. */
function preferred(a: { pin: PinterestPin; hour: number }, b: { pin: PinterestPin; hour: number }) {
  const aNoon = a.hour === 12;
  const bNoon = b.hour === 12;
  if (aNoon !== bNoon) return aNoon ? b : a; // prefer the non-noon pin
  return a.pin.ts <= b.pin.ts ? a : b; // among equals, earliest ts wins
}

export function reconcile(pins: PinterestPin[], pending: PackInfo[], posted: PackInfo[], today: string): Reconciliation {
  const byKey = new Map<string, { pin: PinterestPin; hour: number }>();
  const sameDayGroups = new Map<string, PinterestPin[]>();
  const noon: PinterestPin[] = [];
  for (const pin of pins) {
    const { date, hour } = localParts(pin.ts);
    const k = key(pin.title, date);
    const candidate = { pin, hour };
    const existing = byKey.get(k);
    byKey.set(k, existing ? preferred(existing, candidate) : candidate);
    sameDayGroups.set(k, [...(sameDayGroups.get(k) ?? []), pin]);
    if (pin.kind === "scheduled" && hour === 12) noon.push(pin);
  }

  const alreadyLive = pending.flatMap((pack) => {
    const found = byKey.get(key(pack.text.title, pack.date));
    return found ? [{ pack, pin: found.pin }] : [];
  });

  const sameDay = [...sameDayGroups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([k, group]) => ({ date: k.slice(k.lastIndexOf("@") + 1), title: group[0].title, ids: group.map((p) => p.id) }));

  const missing = posted.filter((pack) => pack.date >= today && !byKey.has(key(pack.text.title, pack.date)));

  return { alreadyLive, noon, sameDay, missing };
}

/**
 * Validate + normalize the raw JSON the /clarity-post browser snippet writes,
 * naming the file and index of the first bad entry rather than failing on
 * some later, harder-to-place symptom.
 */
export function parsePinterestPins(
  raw: Partial<PinterestPin>[],
  kind: PinterestPin["kind"],
  label: string,
): PinterestPin[] {
  return raw.map((p, i) => {
    if (!p.id || typeof p.ts !== "number") throw new Error(`${label}[${i}]: needs id and ts (unix seconds)`);
    if (!p.title || !p.title.trim()) throw new Error(`${label}[${i}]: missing title`);
    return { id: String(p.id), title: p.title, link: p.link, ts: p.ts, kind };
  });
}

/**
 * Pinterest's scheduled-pins endpoint can silently return a short page. If
 * we've already posted more packs than the scheduled + created pin counts
 * together contain, the "missing" verdict can't be trusted — the fix is to
 * re-pull in slices, not to repost something that is actually still there.
 *
 * "Due" only counts posted packs dated strictly AFTER today: Pinterest drops
 * a pin from the scheduled list the instant it publishes, so today's 09:00/
 * 13:00/18:00 pins may already be live and gone from `scheduled` — that shows
 * up as `created` growing, not as `scheduled` shrinking, which is why both
 * counts are compared together rather than `scheduled` alone.
 */
export function scheduledLooksTruncated(
  scheduledCount: number,
  createdCount: number,
  posted: PackInfo[],
  today: string,
): boolean {
  const due = posted.filter((p) => p.date > today).length;
  return scheduledCount + createdCount < due;
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
