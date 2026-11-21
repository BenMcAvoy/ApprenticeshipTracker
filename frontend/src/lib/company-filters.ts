import { parseCloseDate as parseDate } from "backend/closing";
import { listingKey } from "backend/listing-key";
import type { CompanyRow } from "@/components/company-card";

export const STATUSES = ["open"] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABEL: Record<Status, string> = {
  open: "Open",
};

export const SORTS = ["recent", "closing", "quality"] as const;
export type Sort = (typeof SORTS)[number];

export const SORT_LABEL: Record<Sort, string> = {
  recent: "Most recent",
  closing: "Closing soonest",
  quality: "Best match",
};

export type Filters = {
  q: string;
  sort: Sort;
  location: string;
  startYear: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  routes: string[];
  levels: number[];
  page: number;
  /** Only companies with a listing closing within CLOSING_SOON_DAYS. */
  soon: boolean;
  showApplied: boolean;
};

export const CLOSING_SOON_DAYS = 14;
export const DEFAULT_FILTERS: Filters = { q: "", sort: "recent", location: "", startYear: 2027, salaryMin: 20000, salaryMax: null, routes: ["Digital"], levels: [6, 7], page: 1, soon: false, showApplied: false };

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

/** Short sector labels used by the UI mapped to TAG's exact route names. */
export const TAG_ROUTE_NAMES: Record<string, string> = {
  Business: "Business and administration",
  Construction: "Construction and the built environment",
  Engineering: "Engineering and manufacturing",
  Hospitality: "Catering and hospitality",
  "Sales and marketing": "Sales, marketing and procurement",
  "Legal and finance": "Legal, finance and accounting",
  Care: "Care services",
  Transport: "Transport and logistics",
  Agriculture: "Agriculture, environmental and animal care",
  Creative: "Creative and design",
  Protective: "Protective services",
};

export const tagRouteName = (route: string) => TAG_ROUTE_NAMES[route] ?? route;

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
  const location = f.location.trim().toLowerCase();
  const soonLimit = now + CLOSING_SOON_DAYS * 24 * 60 * 60 * 1000;

  const matches = companies.flatMap((c) => {
    let listings = listingsOf(c);
    if (f.routes.length) listings = listings.filter((l) => Boolean(l.courseRoute && f.routes.some((route) => tagRouteName(route) === l.courseRoute)));
    if (f.levels.length) listings = listings.filter((l) => typeof l.courseLevel === "number" && f.levels.includes(l.courseLevel));
    if (f.startYear !== null) listings = listings.filter((l) => Boolean(l.startDate && new Date(l.startDate).getFullYear() === f.startYear));
    if (location) listings = listings.filter((l) => `${l.location ?? ""} ${l.postcode ?? ""}`.toLowerCase().includes(location));
    if (f.salaryMin !== null || f.salaryMax !== null) listings = listings.filter((l) => {
      const salaryText = l.salary ?? "";
      const amount = Number(salaryText.match(/[\d,]+(?:\.\d+)?/)?.[0]?.replace(/,/g, "") ?? "");
      if (!Number.isFinite(amount) || amount <= 0) return false;
      const annual = /\b(hour|hr|week|weekly)\b/i.test(salaryText) ? amount * 37.5 * 52 : amount;
      return (f.salaryMin === null || annual >= f.salaryMin) && (f.salaryMax === null || annual <= f.salaryMax);
    });
    if (q) {
      const companyText = `${c.name} ${c.summary ?? ""}`.toLowerCase();
      const companyMatches = q.split(/\s+/).every((word) => companyText.includes(word));
      if (!companyMatches) listings = listings.filter((l) => q.split(/\s+/).every((word) => `${l.title} ${l.location ?? ""}`.toLowerCase().includes(word)));
    }
    if (!listings.length) return [];
    const result = { ...c, listings: JSON.stringify(listings) };
    if (f.soon) {
      const closing = nextClosing(result, now);
      if (closing === null || closing > soonLimit) return [];
    }
    return [result];
  });

  const byName = (a: CompanyRow, b: CompanyRow) => a.name.localeCompare(b.name);
  return matches.sort((a, b) => {
    switch (f.sort) {
      case "quality":
        return 0;
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

export const isFiltered = (f: Filters) => f.q.trim() !== "" || f.location.trim() !== "" || f.startYear !== DEFAULT_FILTERS.startYear || f.salaryMin !== DEFAULT_FILTERS.salaryMin || f.salaryMax !== DEFAULT_FILTERS.salaryMax || f.routes.join("|") !== DEFAULT_FILTERS.routes.join("|") || f.levels.join("|") !== DEFAULT_FILTERS.levels.join("|") || f.page !== DEFAULT_FILTERS.page || f.soon || f.showApplied || f.sort !== DEFAULT_FILTERS.sort;

// URL <-> filters
export type FilterSearch = { q?: string; sort?: string; soon?: boolean; showApplied?: boolean; location?: string; startYear?: number; salaryMin?: number; salaryMax?: number; routes?: string[]; levels?: number[]; page?: number };

export function filtersFromSearch(s: FilterSearch): Filters {
  return {
    q: s.q ?? "",
    sort: (SORTS as readonly string[]).includes(s.sort ?? "") ? (s.sort as Sort) : DEFAULT_FILTERS.sort,
    location: s.location ?? DEFAULT_FILTERS.location,
    startYear: s.startYear ?? DEFAULT_FILTERS.startYear,
    salaryMin: s.salaryMin ?? DEFAULT_FILTERS.salaryMin,
    salaryMax: s.salaryMax ?? DEFAULT_FILTERS.salaryMax,
    routes: s.routes ?? DEFAULT_FILTERS.routes,
    levels: s.levels ?? DEFAULT_FILTERS.levels,
    page: s.page ?? DEFAULT_FILTERS.page,
    soon: s.soon === true,
    showApplied: s.showApplied === true,
  };
}

/** Omits defaults so the URL stays clean. */
export function searchFromFilters(f: Filters): FilterSearch {
  return {
    q: f.q || undefined,
    location: f.location || undefined,
    startYear: f.startYear === DEFAULT_FILTERS.startYear ? undefined : f.startYear ?? undefined,
    salaryMin: f.salaryMin === DEFAULT_FILTERS.salaryMin ? undefined : f.salaryMin ?? undefined,
    salaryMax: f.salaryMax ?? undefined,
    routes: f.routes.join("|") === DEFAULT_FILTERS.routes.join("|") ? undefined : f.routes,
    levels: f.levels.join("|") === DEFAULT_FILTERS.levels.join("|") ? undefined : f.levels,
    page: f.page === DEFAULT_FILTERS.page ? undefined : f.page,
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
