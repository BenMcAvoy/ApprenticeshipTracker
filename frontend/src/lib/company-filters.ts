import { parseCloseDate as parseDate } from "backend/closing";
import { listingKey } from "backend/listing-key";
import type { CompanyRow } from "@/components/company-card";

export const STATUSES = ["open"] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABEL: Record<Status, string> = {
  open: "Open",
};

export const SORTS = ["recent", "closing", "name"] as const;
export type Sort = (typeof SORTS)[number];

export const SORT_LABEL: Record<Sort, string> = {
  recent: "Recently posted",
  closing: "Closing soonest",
  name: "Name (A–Z)",
};

export type Filters = {
  q: string;
  sort: Sort;
  /** Only companies with a listing closing within CLOSING_SOON_DAYS. */
  soon: boolean;
  showApplied: boolean;
};

export const CLOSING_SOON_DAYS = 14;
export const DEFAULT_FILTERS: Filters = { q: "", sort: "recent", soon: false, showApplied: false };

export type Listing = {
  title: string;
  url?: string | null;
  closes?: string;
  location?: string;
  postedAt?: string;
  startDate?: string;
  salary?: string;
  courseRoute?: string;
  courseLevel?: number;
  apprenticeshipLevel?: string;
  hoursPerWeek?: string;
  positions?: number;
  remoteType?: string;
  postcode?: string;
  description?: string;
  companyLogo?: string;
  sourceId?: string;
};

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
      // Prefer current catalogue data, but retain the saved snapshot when a role has disappeared.
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

const mostRecentPost = (c: CompanyRow) => Math.max(0, ...listingsOf(c).map((l) => l.postedAt ? new Date(l.postedAt).getTime() : 0));

export function applyFilters(companies: CompanyRow[], f: Filters, now = Date.now()): CompanyRow[] {
  const q = f.q.trim().toLowerCase();
  const soonLimit = now + CLOSING_SOON_DAYS * 24 * 60 * 60 * 1000;

  const matches = companies.filter((c) => {
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
      default:
        return mostRecentPost(b) - mostRecentPost(a) || byName(a, b);
    }
  });
}

export const isFiltered = (f: Filters) => f.q.trim() !== "" || f.soon || f.showApplied || f.sort !== DEFAULT_FILTERS.sort;

// URL <-> filters
export type FilterSearch = { q?: string; sort?: string; soon?: boolean; showApplied?: boolean };

export function filtersFromSearch(s: FilterSearch): Filters {
  return {
    q: s.q ?? "",
    sort: (SORTS as readonly string[]).includes(s.sort ?? "") ? (s.sort as Sort) : DEFAULT_FILTERS.sort,
    soon: s.soon === true,
    showApplied: s.showApplied === true,
  };
}

/** Omits defaults so the URL stays clean. */
export function searchFromFilters(f: Filters): FilterSearch {
  return {
    q: f.q || undefined,
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
