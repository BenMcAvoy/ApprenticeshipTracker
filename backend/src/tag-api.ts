import { readFileSync, writeFileSync } from "node:fs";
import { prisma } from "./db.ts";

const API_ROOT = "https://api.theapprenticeguide.net/api";
const SITE_ORIGIN = "https://www.theapprenticeguide.net";
const PAGE_SIZE = 24;

export type TagSearch = {
  q: string;
  location: string;
  routes: string[];
  courseLevels: number[];
  salaryMin: number | null;
  salaryMax: number | null;
  startYear: number | null;
  sort: "recent" | "closing" | "quality";
  page: number;
};

type TagVacancy = {
  id: string;
  slug: string | null;
  title: string;
  shortDescription: string | null;
  courseRoute: string;
  courseLevel: number;
  apprenticeshipLevel: string;
  city: string | null;
  region: string | null;
  postcode: string | null;
  remoteType: string | null;
  wageText: string | null;
  wageAdditional: string | null;
  hoursPerWeek: string | null;
  positions: number | null;
  postedAt: string | null;
  startDate: string | null;
  closingDate: string | null;
  company: { name: string; websiteUrl: string | null; logoUrl: string | null };
};

type TagPage = { data: TagVacancy[]; total: number; totalPages: number; page: number; limit: number };

let cachedToken: { value: string; expiresAt: number } | undefined;
let activeSessionCookie: string | undefined;

function sessionCookie(): string | undefined {
  if (activeSessionCookie) return activeSessionCookie;
  let value: string | undefined;
  try {
    value = readFileSync(process.env.TAG_SESSION_COOKIE_FILE ?? "/data/tag-session-cookie", "utf8").trim();
  } catch {
    value = process.env.TAG_SESSION_COOKIE?.trim();
  }
  if (!value) return undefined;
  // Accept either the complete name=value pair or just the Better Auth cookie value.
  activeSessionCookie = value.includes("=") ? value : `better-auth.session_token=${value}`;
  return activeSessionCookie;
}

export function isTagConfigured(): boolean {
  return Boolean(sessionCookie());
}

function persistRefreshedSessionCookie(response: Response): void {
  const cookie = sessionCookie();
  if (!cookie) return;
  const cookieName = cookie.split("=", 1)[0];
  const refreshed = response.headers.getSetCookie?.()
    .map((value) => value.split(";", 1)[0]?.trim())
    .find((value) => value?.startsWith(`${cookieName}=`));
  if (!refreshed) return;
  activeSessionCookie = refreshed;
  try {
    const path = process.env.TAG_SESSION_COOKIE_FILE ?? "/data/tag-session-cookie";
    writeFileSync(path, refreshed, { mode: 0o600 });
  } catch {
    // The current request can use the refreshed cookie even if persistent storage is read-only.
  }
}

function tokenExpiry(token: string): number {
  try {
    const payload = token.split(".")[1];
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: number };
    if (typeof claims.exp === "number") return claims.exp * 1000;
  } catch {
    // Some provider token formats may not expose JWT claims.
  }
  return Date.now() + 4 * 60 * 1000;
}

async function getBearerToken(force = false): Promise<string> {
  const cookie = sessionCookie();
  if (!cookie) throw new Error("TAG session cookie is not configured");
  if (!force && cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  const response = await fetch(`${API_ROOT}/auth/token`, {
    headers: { accept: "application/json", cookie, origin: SITE_ORIGIN, referer: `${SITE_ORIGIN}/` },
    signal: AbortSignal.timeout(15_000),
  });
  persistRefreshedSessionCookie(response);
  if (!response.ok) {
    cachedToken = undefined;
    throw new Error(response.status === 401 || response.status === 403
      ? "TAG session has expired; update the TAG session cookie."
      : `TAG token endpoint returned HTTP ${response.status}.`);
  }
  const body: unknown = await response.json();
  const token = body && typeof body === "object" && "token" in body && typeof body.token === "string" ? body.token : undefined;
  if (!token) throw new Error("TAG token endpoint returned an invalid response.");
  cachedToken = { value: token, expiresAt: tokenExpiry(token) };
  return token;
}

function vacanciesUrl(search: TagSearch): URL {
  const url = new URL(`${API_ROOT}/vacancies`);
  const params = url.searchParams;
  if (search.q.trim()) params.set("q", search.q.trim());
  if (search.location.trim()) params.set("location", search.location.trim());
  for (const route of search.routes) params.append("routes", route);
  for (const level of search.courseLevels) params.append("courseLevels", String(level));
  if (search.salaryMin !== null && search.salaryMin > 0) params.set("salaryMin", String(search.salaryMin));
  if (search.salaryMax !== null && search.salaryMax > 0) params.set("salaryMax", String(search.salaryMax));
  if (search.startYear !== null) params.set("startYear", String(search.startYear));
  params.set("sort", search.sort === "recent" ? "recent" : search.sort);
  params.set("page", String(search.page));
  params.set("limit", String(PAGE_SIZE));
  return url;
}

async function fetchPage(search: TagSearch): Promise<TagPage> {
  const url = vacanciesUrl(search);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await getBearerToken(attempt > 0);
    const response = await fetch(url, {
      headers: { accept: "application/json", authorization: `Bearer ${token}`, origin: SITE_ORIGIN, referer: `${SITE_ORIGIN}/` },
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status === 401 && attempt === 0) {
      cachedToken = undefined;
      continue;
    }
    if (!response.ok) throw new Error(`TAG vacancy endpoint returned HTTP ${response.status}.`);
    const body = await response.json() as Partial<TagPage>;
    if (!Array.isArray(body.data) || typeof body.total !== "number") throw new Error("TAG vacancy endpoint returned an invalid response.");
    return {
      data: body.data,
      total: body.total,
      totalPages: typeof body.totalPages === "number" ? body.totalPages : 1,
      page: typeof body.page === "number" ? body.page : search.page,
      limit: typeof body.limit === "number" ? body.limit : PAGE_SIZE,
    };
  }
  throw new Error("TAG rejected the refreshed bearer token.");
}

function listingFromVacancy(vacancy: TagVacancy) {
  return {
    title: vacancy.title.trim(),
    url: `https://www.theapprenticeguide.net/apprenticeships/${encodeURIComponent(vacancy.slug || vacancy.id)}`,
    location: [vacancy.city, vacancy.region].filter(Boolean).join(", "),
    closes: vacancy.closingDate ?? undefined,
    postedAt: vacancy.postedAt ?? undefined,
    startDate: vacancy.startDate ?? undefined,
    salary: [vacancy.wageText, vacancy.wageAdditional].filter(Boolean).join(" · ") || undefined,
    courseRoute: vacancy.courseRoute,
    courseLevel: vacancy.courseLevel,
    apprenticeshipLevel: vacancy.apprenticeshipLevel,
    hoursPerWeek: vacancy.hoursPerWeek ?? undefined,
    positions: vacancy.positions ?? undefined,
    remoteType: vacancy.remoteType ?? undefined,
    postcode: vacancy.postcode ?? undefined,
    description: vacancy.shortDescription ?? undefined,
    companyLogo: vacancy.company.logoUrl ?? undefined,
    sourceId: vacancy.id,
  };
}

function listingIdentity(listing: { sourceId?: string; url?: string; title?: string }): string {
  return listing.sourceId || listing.url || listing.title || "";
}

async function persistAndGroup(vacancies: TagVacancy[]) {
  const grouped = new Map<string, TagVacancy[]>();
  for (const vacancy of vacancies) {
    const name = vacancy.company?.name?.trim();
    if (!name || !vacancy.id || !vacancy.title?.trim()) continue;
    const group = grouped.get(name) ?? [];
    group.push(vacancy);
    grouped.set(name, group);
  }

  const companies = [];
  for (const [name, rows] of grouped) {
    const existing = await prisma.company.findUnique({ where: { name } });
    let oldListings: ReturnType<typeof listingFromVacancy>[] = [];
    try {
      const parsed: unknown = JSON.parse(existing?.listings ?? "[]");
      if (Array.isArray(parsed)) oldListings = parsed;
    } catch {
      oldListings = [];
    }
    const freshListings = rows.map(listingFromVacancy);
    const merged = new Map(oldListings.map((listing) => [listingIdentity(listing), listing]));
    for (const listing of freshListings) merged.set(listingIdentity(listing), listing);
    const first = rows[0];
    const company = await prisma.company.upsert({
      where: { name },
      create: {
        name,
        source: "the-apprentice-guide",
        careersUrl: first.company.websiteUrl,
        status: "open",
        summary: null,
        listings: JSON.stringify([...merged.values()]),
        evidence: "[]",
      },
      update: {
        source: "the-apprentice-guide",
        careersUrl: first.company.websiteUrl,
        status: "open",
        listings: JSON.stringify([...merged.values()]),
      },
    });
    companies.push({ ...company, listings: JSON.stringify(freshListings) });
  }
  return companies;
}

export async function searchTagVacancies(search: TagSearch) {
  const result = await fetchPage(search);
  const companies = await persistAndGroup(result.data);
  return {
    companies,
    fetchedAt: new Date().toISOString(),
    total: result.total,
    page: result.page,
    totalPages: result.totalPages,
    pageSize: result.limit,
    source: `${API_ROOT}/vacancies`,
    query: new URL(vacanciesUrl(search)).searchParams.toString(),
    live: true,
  };
}
