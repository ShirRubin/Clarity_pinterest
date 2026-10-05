// src/season.ts — when a seasonal list may go live. Pure.
//
// Growth review, Oct 5 2026 (plan §1): the scheduler was season-blind FIFO,
// so Halloween Movies was booked for Nov 19 to Dec 3 and the Thanksgiving
// episode for Dec 13 to Jan 3. Pinterest users plan 45-60 days ahead and
// the platform stops surfacing a seasonal pin once the day has passed, so a
// seasonal pack has a window: it opens `lead` days before the peak and
// closes `cutoff` days before it. Inside the window it goes first, ordered
// by its deadline; after the deadline it waits for next year's window.
//
// The season is read off the list's title / slug with a keyword table —
// good enough for the vocabulary this account uses; a list that matches
// nothing is evergreen and keeps its place in the queue.

export interface Season {
  name: string;
  /** The peak day, YYYY-MM-DD, next occurrence relative to today. */
  peak: string;
  /** First day a pin may go live: peak minus lead. */
  open: string;
  /** Last day a pin should go live: peak minus cutoff. */
  deadline: string;
}

interface Rule {
  name: string;
  match: RegExp;
  /** MM-DD of the peak (or a YYYY-MM-DD list for movable feasts). */
  peak: string | string[];
  lead?: number;
  cutoff?: number;
}

export const DEFAULT_LEAD_DAYS = 60;
export const DEFAULT_CUTOFF_DAYS = 7;

// Order matters: the first rule that matches wins, so the specific ones
// come before the broad ones (advent before christmas, friendsgiving
// before thanksgiving, winter arc before winter).
export const SEASON_RULES: Rule[] = [
  { name: "Halloween", match: /halloween|spooky|trick.or.treat/i, peak: "10-31" },
  { name: "Scorpio season", match: /scorpio/i, peak: "11-21", lead: 45 },
  { name: "Thanksgiving", match: /thanksgiving|friendsgiving/i, peak: ["2026-11-26", "2027-11-25", "2028-11-23"] },
  { name: "Advent", match: /advent/i, peak: "12-01" },
  { name: "Sagittarius season", match: /sagittarius/i, peak: "12-21", lead: 45 },
  { name: "Christmas", match: /christmas|xmas|handmade.gift|gift.guide|stocking/i, peak: "12-25" },
  { name: "New Year", match: /new.year|nye|2027|vision.board/i, peak: "01-01" },
  { name: "Lunar New Year", match: /lunar.new.year|chinese.new.year/i, peak: ["2027-02-17", "2028-01-26"] },
  { name: "Valentine's", match: /valentine|galentine/i, peak: "02-14" },
  { name: "Winter arc", match: /winter.arc/i, peak: "12-21", lead: 90 },
  { name: "Winter", match: /winter|hibernation|soup.season|snow|cozy.season|hot.springs|northern.lights|aurora/i, peak: "12-21" },
  { name: "Fall", match: /fall|autumn|october|pumpkin|cottage.witch|apple.picking|sweater|dark.academia|semester/i, peak: "10-15", lead: 60, cutoff: -30 },
  { name: "Back to school", match: /back.to.school/i, peak: "09-01" },
  { name: "Summer", match: /summer|beach|july/i, peak: "07-01", cutoff: -45 },
  { name: "Spring", match: /spring|easter|cherry.blossom/i, peak: "04-15", cutoff: -30 },
];

const DAY = 86_400_000;
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** The next occurrence of the peak whose deadline has not passed by `today`. */
function nextPeak(rule: Rule, today: string): string {
  const cutoff = rule.cutoff ?? DEFAULT_CUTOFF_DAYS;
  const candidates = Array.isArray(rule.peak)
    ? rule.peak
    : [0, 1, 2].map((y) => `${parseInt(today.slice(0, 4), 10) + y}-${rule.peak}`);
  for (const peak of candidates) if (addDays(peak, -cutoff) >= today) return peak;
  return candidates[candidates.length - 1];
}

/** The season a list belongs to, or undefined for evergreen. */
export function seasonFor(text: string, today: string): Season | undefined {
  const rule = SEASON_RULES.find((r) => r.match.test(text));
  if (!rule) return undefined;
  const peak = nextPeak(rule, today);
  return {
    name: rule.name,
    peak,
    open: addDays(peak, -(rule.lead ?? DEFAULT_LEAD_DAYS)),
    deadline: addDays(peak, -(rule.cutoff ?? DEFAULT_CUTOFF_DAYS)),
  };
}

/** Where `today` sits relative to a season's window. */
export function seasonState(s: Season, today: string): "early" | "open" | "late" {
  if (today < s.open) return "early";
  if (today > s.deadline) return "late";
  return "open";
}
