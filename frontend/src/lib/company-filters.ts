import { parseCloseDate as parseDate } from "backend/closing";
import { listingKey } from "backend/listing-key";
import type { CompanyRow } from "@/components/company-card";

export const STATUSES = ["open", "upcoming", "closed", "none", "unclear", "error", "unscanned"] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABEL: Record<Status, string> = {
  open: "Open",
  upcoming: "Opening soon",
  closed: "Closed",
  none: "None found",
  unclear: "Couldn't check",
  error: "Error",
  unscanned: "Not scanned",
};

export const SORTS = ["best", "name", "closing", "recent", "stale"] as const;
export type Sort = (typeof SORTS)[number];

export const SORT_LABEL: Record<Sort, string> = {
  best: "Open roles first",
  name: "Name (A–Z)",
  closing: "Closing soonest",
  recent: "Recently scanned",
  stale: "Least recently scanned",
};

export type Filters = {
  q: string;
  /** Empty means "all statuses". */
  statuses: Status[];
  sort: Sort;
  /** Only companies with a listing closing within CLOSING_SOON_DAYS. */
  soon: boolean;
  showApplied: boolean;
};

export const CLOSING_SOON_DAYS = 14;
export const DEFAULT_FILTERS: Filters = { q: "", statuses: [], sort: "best", soon: false, showApplied: false };

export type Listing = { title: string; url?: string | null; closes?: string; location?: string; lastVerifiedAt?: string; needsRecheck?: boolean };

export const listingsOf = (c: CompanyRow): Listing[] => {
  try {
    const listings: unknown = JSON.parse(c.listings);
    return Array.isArray(listings) ? listings : [];
  } catch {
    return [];
  }
};

export type AppliedListing = {
  companyId: number;
  listingKey: string;
  listingTitle?: string | null;
  listingUrl?: string | null;
  appliedAt?: string | Date;
};

export const appliedId = (companyId: number, key: string) => `${companyId}:${key}`;

/** Trim listings before searching, counting, sorting and exporting the displayed catalogue. */
export function applyAppliedVisibility(companies: CompanyRow[], applied: AppliedListing[], showApplied: boolean): CompanyRow[] {
  const marked = new Set(applied.map((entry) => appliedId(entry.companyId, entry.listingKey)));
  if (showApplied) {
    const byId = new Map(companies.map((company) => [company.id, company]));
    const grouped = new Map<number, Listing[]>();
    for (const entry of applied) {
      const company = byId.get(entry.companyId);
      if (!company) continue;
      const listings = grouped.get(entry.companyId) ?? [];
      // Prefer fresh catalogue data, but retain the saved snapshot when a rescan removed a role.
      const current = listingsOf(company).find((listing) => listingKey(listing) === entry.listingKey);
      const historical = !current && entry.listingTitle
        ? { title: entry.listingTitle, url: entry.listingUrl, appliedAt: entry.appliedAt }
        : undefined;
      const listing = current ?? historical;
      if (listing && !listings.some((item) => listingKey(item) === entry.listingKey)) listings.push(listing);
      grouped.set(entry.companyId, listings);
    }
    return companies.flatMap((company) => {
      const listings = grouped.get(company.id);
      return listings?.length ? [{ ...company, listings: JSON.stringify(listings) }] : [];
    });
  }
  const appliedCompanies = new Set(applied.map((entry) => entry.companyId));
  return companies.flatMap((company) => {
    const listings = listingsOf(company);
    if (!listings.length) return appliedCompanies.has(company.id) ? [] : [company];
    const visible = listings.filter((listing) => !marked.has(appliedId(company.id, listingKey(listing))));
    if (!visible.length) return [];
    return [{ ...company, listings: JSON.stringify(visible) }];
  });
}

/** Closing date text -> timestamp (local midnight), or null. One shared parser with the backend's reminders. */
export const parseCloseDate = (text: string | undefined): number | null => parseDate(text)?.getTime() ?? null;

/** Earliest upcoming closing date among a company's listings (past dates are ignored). */
export function nextClosing(c: CompanyRow, now = Date.now()): number | null {
  const dates = listingsOf(c)
    .map((l) => parseCloseDate(l.closes))
    .filter((t): t is number => t !== null && t >= now - 24 * 60 * 60 * 1000);
  return dates.length ? Math.min(...dates) : null;
}

const RANK: Record<string, number> = { open: 0, upcoming: 1, unclear: 2, none: 3, closed: 4, error: 5, unscanned: 6 };
const scannedAt = (c: CompanyRow) => (c.lastScannedAt ? new Date(c.lastScannedAt).getTime() : 0);

export function applyFilters(companies: CompanyRow[], f: Filters, now = Date.now()): CompanyRow[] {
  const q = f.q.trim().toLowerCase();
  const soonLimit = now + CLOSING_SOON_DAYS * 24 * 60 * 60 * 1000;

  const matches = companies.filter((c) => {
    if (f.statuses.length && !f.statuses.includes(c.status as Status)) return false;
    if (f.soon) {
      const closing = nextClosing(c, now);
      if (closing === null || closing > soonLimit) return false;
    }
    if (q) {
      const haystack = [c.name, c.summary ?? "", ...listingsOf(c).flatMap((l) => [l.title, l.location ?? ""])].join(" ").toLowerCase();
      if (!q.split(/\s+/).every((word) => haystack.includes(word))) return false;
    }
    return true;
  });

  const byName = (a: CompanyRow, b: CompanyRow) => a.name.localeCompare(b.name);
  return matches.sort((a, b) => {
    switch (f.sort) {
      case "name":
        return byName(a, b);
      case "closing": {
        const x = nextClosing(a, now) ?? Infinity;
        const y = nextClosing(b, now) ?? Infinity;
        return x - y || byName(a, b);
      }
      case "recent":
        return scannedAt(b) - scannedAt(a) || byName(a, b);
      case "stale":
        return scannedAt(a) - scannedAt(b) || byName(a, b);
      default:
        return (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9) || (nextClosing(a, now) ?? Infinity) - (nextClosing(b, now) ?? Infinity) || byName(a, b);
    }
  });
}

export const isFiltered = (f: Filters) => f.q.trim() !== "" || f.statuses.length > 0 || f.soon || f.showApplied || f.sort !== DEFAULT_FILTERS.sort;

// URL <-> filters
export type FilterSearch = { q?: string; status?: string; sort?: string; soon?: boolean; showApplied?: boolean };

export function filtersFromSearch(s: FilterSearch): Filters {
  const statuses = (s.status ?? "").split(",").filter((x): x is Status => (STATUSES as readonly string[]).includes(x));
  return {
    q: s.q ?? "",
    statuses,
    sort: (SORTS as readonly string[]).includes(s.sort ?? "") ? (s.sort as Sort) : DEFAULT_FILTERS.sort,
    soon: s.soon === true,
    showApplied: s.showApplied === true,
  };
}

/** Omits defaults so the URL stays clean. */
export function searchFromFilters(f: Filters): FilterSearch {
  return {
    q: f.q || undefined,
    status: f.statuses.length ? f.statuses.join(",") : undefined,
    sort: f.sort !== DEFAULT_FILTERS.sort ? f.sort : undefined,
    soon: f.soon || undefined,
    showApplied: f.showApplied || undefined,
  };
}

// ---------------------------------------------------------------------------
// Closing-date display
// ---------------------------------------------------------------------------

export type Tone = "urgent" | "warn" | "normal" | "muted";
const DAY_MS = 24 * 60 * 60 * 1000;
const startOfDay = (t: number) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

export const formatDate = (t: number) =>
  new Date(t).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "long", year: "numeric" });

export function daysUntil(t: number, now = Date.now()) {
  return Math.round((startOfDay(t) - startOfDay(now)) / DAY_MS);
}

export function countdown(days: number): string {
  if (days < 0) return `closed ${-days} day${days === -1 ? "" : "s"} ago`;
  if (days === 0) return "closes TODAY";
  if (days === 1) return "closes TOMORROW";
  return `closes in ${days} days`;
}

export const toneFor = (days: number): Tone => (days <= 3 ? "urgent" : days <= 7 ? "warn" : "normal");

/** Closing "dates" that say nothing, e.g. "Not stated". */
const NO_INFO_RE = /^(not stated|n\/a|na|none|unknown|tbc|tba|-+)$/i;

export type ClosingInfo = { tone: Tone; headline: string; detail?: string };

/** What a card says about closing, for every status, so the question is always answered explicitly. */
export function closingInfo(c: CompanyRow, now = Date.now()): ClosingInfo {
  switch (c.status) {
    case "open": {
      const listings = listingsOf(c);
      const dated = listings
        .map((l) => parseCloseDate(l.closes))
        .filter((t): t is number => t !== null)
        .map((t) => ({ t, days: daysUntil(t, now) }));
      const live = dated.filter((d) => d.days >= 0).sort((a, b) => a.days - b.days);
      const undated = listings.length - dated.length;
      const note = [
        live.length > 1 ? `${live.length} listings with dates, soonest shown` : "",
        undated > 0 && dated.length > 0 ? `${undated} listing${undated === 1 ? "" : "s"} without a date` : "",
      ]
        .filter(Boolean)
        .join(" · ");

      if (live.length) {
        const next = live[0];
        const text = countdown(next.days);
        return { tone: toneFor(next.days), headline: `${text.charAt(0).toUpperCase()}${text.slice(1)}`, detail: [formatDate(next.t), note].filter(Boolean).join(" · ") };
      }
      if (dated.length) {
        return { tone: "warn", headline: "Listed closing date has passed", detail: "Rescan to check whether it's still open or was extended" };
      }
      const wording = [...new Set(listings.map((l) => l.closes?.trim()).filter((t): t is string => !!t && !NO_INFO_RE.test(t)))];
      if (wording.length) return { tone: "warn", headline: "No exact closing date", detail: wording.join(" · ") };
      return { tone: "warn", headline: "No closing date listed", detail: "Check the listing page for the deadline" };
    }
    case "upcoming":
      return { tone: "muted", headline: "Not open yet", detail: "No closing date until applications open" };
    case "closed":
      return { tone: "muted", headline: "Applications closed" };
    case "none":
      return { tone: "muted", headline: "Nothing open to close", detail: "No tech degree apprenticeship vacancies found" };
    case "unclear":
      return { tone: "muted", headline: "Closing date unknown", detail: "Couldn't check this company" };
    case "error":
      return { tone: "muted", headline: "Closing date unknown", detail: "The last scan failed" };
    default:
      return { tone: "muted", headline: "Not scanned yet" };
  }
}

/** Short per-listing closing text, e.g. "closes in 6 days (31 October 2026)". */
export function listingClosing(l: { closes?: string }, now = Date.now()): { text: string; tone: Tone } {
  const t = parseCloseDate(l.closes);
  if (t !== null) {
    const days = daysUntil(t, now);
    return { text: `${countdown(days)} (${new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })})`, tone: days < 0 ? "muted" : toneFor(days) };
  }
  const wording = l.closes?.trim();
  return wording && !NO_INFO_RE.test(wording) ? { text: `closing: ${wording}`, tone: "muted" } : { text: "no closing date listed", tone: "warn" };
}
