import type { Notification } from "./ntfy.ts";

const DAY = 24 * 60 * 60 * 1000;

type Listing = { title: string; url: string; location?: string; closes?: string; needsRecheck?: boolean };
type CompanyLike = { name: string; status: string; listings: string; lastAttemptStatus?: string | null };

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthIndex = (name: string) => MONTHS.indexOf(name.slice(0, 3).toLowerCase());

/** Builds a local date, rejecting impossible ones like 31 February instead of letting them roll over. */
function makeDate(year: number, month: number, day: number): Date | null {
  if (month < 0 || month > 11 || day < 1 || day > 31 || year < 2000 || year > 2100) return null;
  const d = new Date(year, month, day);
  return d.getMonth() === month ? d : null;
}

/**
 * Parses closing dates to local midnight of that day. Understands:
 *   "17 February 2027", "Wednesday 8th December 2026", "31 Jan 2027"
 *   "October 26, 2026", "Oct 26th 2026"
 *   "2026/10/26 23:00 GMT", "2026-10-26"
 *   "26/10/2026"  (UK day-first)
 * Requires a full day + month + year. Vague text like "by October 2026" or "when the role is filled" gives null,
 * because guessing would invent a deadline. (The frontend uses this same function via "backend/closing".)
 */
export function parseCloseDate(text: string | undefined): Date | null {
  if (!text) return null;
  // "17 February 2027", "8th December 2026"
  let m = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/);
  if (m && monthIndex(m[2]) >= 0) return makeDate(+m[3], monthIndex(m[2]), +m[1]);
  // "October 26, 2026"
  m = text.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/);
  if (m && monthIndex(m[1]) >= 0) return makeDate(+m[3], monthIndex(m[1]), +m[2]);
  // "2026/10/26", "2026-10-26"
  m = text.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (m) return makeDate(+m[1], +m[2] - 1, +m[3]);
  // "26/10/2026" (UK day-first)
  m = text.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/);
  if (m) return makeDate(+m[3], +m[2] - 1, +m[1]);
  return null;
}

export type Reminder = { company: string; listing: Listing; daysLeft: number; notification: Notification };

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

function when(daysLeft: number) {
  if (daysLeft <= 0) return "TODAY";
  if (daysLeft === 1) return "TOMORROW";
  return `in ${daysLeft} days`;
}

/** One reminder per open listing that closes within `withinDays` days (including today), most urgent first. */
export function closingReminders(companies: CompanyLike[], withinDays: number, now = new Date()): Reminder[] {
  const today = startOfDay(now).getTime();
  const reminders: Reminder[] = [];

  for (const c of companies) {
    if (c.status !== "open") continue;
    if (["unclear", "error"].includes(c.lastAttemptStatus ?? "")) continue;
    let listings: Listing[];
    try {
      listings = JSON.parse(c.listings);
    } catch {
      continue;
    }
    for (const listing of listings) {
      if (listing.needsRecheck) continue;
      const closes = parseCloseDate(listing.closes);
      if (!closes) continue;
      const daysLeft = Math.round((startOfDay(closes).getTime() - today) / DAY);
      if (daysLeft < 0 || daysLeft > withinDays) continue;

      reminders.push({
        company: c.name,
        listing,
        daysLeft,
        notification: {
          title: `${daysLeft <= 1 ? "🚨 " : "⏰ "}${c.name} apprenticeship closes ${when(daysLeft)}`,
          message: `${[listing.title, listing.location && `📍 ${listing.location}`, `Closes: ${listing.closes}`].filter(Boolean).join("\n")}\n\n${
            daysLeft <= 1 ? "Apply now. This is about to expire!" : "Don't leave it to the last minute."
          }`,
          priority: daysLeft <= 3 ? 5 : 4,
          tags: [daysLeft <= 1 ? "rotating_light" : "hourglass_flowing_sand"],
          click: listing.url,
        },
      });
    }
  }
  return reminders.sort((a, b) => a.daysLeft - b.daysLeft || a.company.localeCompare(b.company));
}
