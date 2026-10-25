/** Source-bound evidence and conservative verdict checks for an apprenticeship scan. */
import { parseCloseDate } from "./closing.ts";

export type ScanEvidenceStatus = "open" | "upcoming" | "closed" | "none_found" | "blocked";
export type SearchResult = { title: string; url: string; snippet: string };
export type ReadPage = { url: string; text: string; title: string; links: { text: string; url: string }[]; status: number };
export type ScanVerdict = {
  status: ScanEvidenceStatus;
  summary: string;
  listings: { title: string; url: string; quote: string }[];
  evidence: { url: string; quote: string }[];
};

type SearchRecord = { query: string; results: SearchResult[] };
type PageRecord = {
  requestedUrl: string;
  page: ReadPage;
  aliases: string[];
  successful: boolean;
};

const normalText = (value: string) => value.toLocaleLowerCase().replace(/[‘’“”]/g, "'").replace(/\s+/g, " ").trim();
const trackingParam = (key: string) => /^(?:utm_.+|gclid|dclid|fbclid|msclkid|mc_cid|mc_eid|_ga|vero_id|source|src)$/i.test(key);

/** Remove only fragments and known tracking parameters. Job ids and search filters stay intact. */
export function canonicalUrl(input: string): string {
  try {
    const url = new URL(input);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (trackingParam(key)) url.searchParams.delete(key);
    url.hostname = url.hostname.toLowerCase();
    if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
    url.searchParams.sort();
    return url.toString().replace(/\/$/, url.pathname === "/" ? "/" : "");
  } catch {
    return input.trim().replace(/#.*$/, "");
  }
}

const techPattern = /\b(?:tech(?:nology)?|software|digital|data|cyber|it|information technology|computer science|cloud)\b/i;
const degreePattern = /\b(?:degree|level\s*[67]|level\s*six|level\s*seven)\b/i;
const apprenticePattern = /apprentic/i;
function isPromisingCandidate(value: string): boolean {
  return apprenticePattern.test(value) && techPattern.test(value) && degreePattern.test(value);
}

const isBlocked = (p: ReadPage) => !p.text.trim() || p.status < 200 || p.status >= 300 ||
  (p.text.length < 800 && /access denied|forbidden|captcha|verify you are human|unusual traffic|just a moment/i.test(p.text));
const noResultsPattern = /\b(?:no (?:matching )?(?:jobs?|vacancies|results|opportunities)(?: were)? found|0 (?:jobs?|results|vacancies)|your search returned no|there are no (?:matching )?(?:jobs?|vacancies))\b/i;
const genericCountPattern = /\b(?:1\s*[-–]\s*\d+\s+of\s+\d{2,}|\d{2,}\+?\s+results?)\b/i;
const explicitClosedPattern = /\b(?:applications? (?:are|is|have been|has been|remain|now|currently)?\s*(?:now\s+|currently\s+)?closed|no longer accepting applications?|not accepting applications?|recruitment (?:is|has been|has) closed|scheme is full|intake is full|vacancies are closed)\b/i;
const explicitUpcomingPattern = /\b(?:applications? (?:will )?(?:open|reopen|start|launch)(?:ing)?|(?:open|reopen|opening) for applications?)\b/i;
const statedWhenPattern = /\b(?:on\s+\d{1,2}(?:st|nd|rd|th)?\s+[a-z]+|in\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+\d{4})?|(?:spring|summer|autumn|fall|winter)(?:\s+\d{4})?|\d{4})\b/i;
const activePattern = /\b(?:apply now|apply today|apply for this (?:job|role)|applications? (?:are )?open|accepting applications?|currently recruiting|vacancy is open|role is open)\b/i;
const closedVacancyPattern = /\b(?:applications? (?:are |have been |has been )?(?:now |currently )?closed|no longer accepting applications?|not accepting applications?|vacancy is closed|position is closed|role is closed|recruitment (?:is|has been) closed|scheme is full|intake is full)\b/i;

function companyTokens(companyName: string): string[] {
  const stripped = normalText(companyName).replace(/\b(?:limited|ltd|plc|group|incorporated|inc|corp|corporation|company|co|ag|nv|n\.v\.|sa|s\.a\.|llc|llp)\b/g, " ");
  const nonDistinctive = new Set(["systems", "mobility", "energy", "technologies", "technology", "services", "solutions", "holdings", "international", "global"]);
  return stripped.split(/[^a-z0-9]+/).filter((token) => token.length >= 2 && !nonDistinctive.has(token));
}

const countrySecondLevelSuffixes = new Set(["co.uk", "org.uk", "gov.uk", "ac.uk", "com.au", "net.au", "org.au", "co.nz", "com.br", "co.jp", "co.in", "com.sg", "com.mx", "co.za"]);

function registrableDomain(hostname: string): string {
  const labels = hostname.toLowerCase().replace(/\.$/, "").split(".").filter(Boolean);
  if (labels.length < 2) return hostname.toLowerCase();
  const lastTwo = labels.slice(-2).join(".");
  return labels.slice(-(countrySecondLevelSuffixes.has(lastTwo) ? 3 : 2)).join(".");
}

function brandMatchesDomain(hostname: string, companyName: string): boolean {
  const root = registrableDomain(hostname);
  const labels = root.split(".");
  const tokens = companyTokens(companyName);
  const compact = normalText(companyName).replace(/\b(?:limited|ltd|plc|group|incorporated|inc|corp|corporation|company|co|ag|nv|sa|llc|llp)\b/g, "").replace(/[^a-z0-9]/g, "");
  return labels.some((label) => tokens.includes(label) || (compact.length >= 2 && label === compact));
}

function isOfficialCompanyUrl(input: string, companyName: string): boolean {
  try { return brandMatchesDomain(new URL(input).hostname, companyName); } catch { return false; }
}

function isSpecificEmployerRoute(input: string): boolean {
  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase();
    const parts = url.pathname.split("/").filter(Boolean);
    if (/(?:^|\.)(?:myworkdayjobs\.com|oraclecloud\.com)$/.test(host)) return parts.length > 0;
    if (/^(?:boards|job-boards)\.greenhouse\.io$|^jobs\.smartrecruiters\.com$|^jobs\.lever\.co$/.test(host)) return parts.length > 0 && !/^(?:jobs?|search|careers)$/i.test(parts[0]);
    // Custom boards must point to an individual route, never a generic jobs hub.
    return /\/(?:jobs?|vacanc(?:y|ies)|positions?|roles?|JobDetail)\/[^/?]+/i.test(url.pathname) ||
      /\/JobDetail$/i.test(url.pathname) && [...url.searchParams.keys()].some((key) => /^(?:jobId|folderId|reqId)$/i.test(key));
  } catch { return false; }
}

function hasListingEmployer(page: PageRecord, companyName: string): boolean {
  const tokens = companyTokens(companyName).map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!tokens.length) return false;
  const employer = `(?:${tokens.join("|")})`;
  return new RegExp(`\\b${employer}\\b`, "i").test(page.page.title) ||
    new RegExp(`\\b(?:employer|company|organisation|organization|legal entity)\\s*[:–—-]?\\s*${employer}\\b`, "i").test(page.page.text);
}

function urlHasCompanyScope(input: string, companyName: string): boolean {
  try {
    const url = new URL(input);
    const tokens = companyTokens(companyName);
    const compact = normalText(companyName).replace(/\b(?:limited|ltd|plc|group|incorporated|inc|corp|corporation|company|co|ag|nv|sa|llc|llp)\b/g, "").replace(/[^a-z0-9]/g, "");
    const pieces = url.pathname.toLowerCase().split(/[^a-z0-9]+/);
    return pieces.some((piece) => tokens.includes(piece) || (compact.length >= 2 && piece === compact));
  } catch { return false; }
}

function closingDates(text: string): Date[] {
  const values: Date[] = [];
  const months = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
  const patterns = [
    new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${months})\\.?[,]?\\s+(\\d{4})\\b`, "gi"),
    new RegExp(`\\b(${months})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?[,]?\\s+(\\d{4})\\b`, "gi"),
    /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g,
  ];
  for (let i = 0; i < patterns.length; i++) {
    for (const match of text.matchAll(patterns[i])) {
      const at = match.index ?? 0;
      if (!/\b(?:closing date|deadline|closes? on|apply by|applications? close)\b/i.test(text.slice(Math.max(0, at - 100), Math.min(text.length, at + match[0].length + 30)))) continue;
      const date = parseCloseDate(match[0]);
      if (date) values.push(date);
    }
  }
  return values;
}

function isExpiredVacancy(page: PageRecord, now: Date): boolean {
  const dates = closingDates(`${page.page.title}\n${page.page.text}`);
  if (!dates.length) return false;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return dates.every((date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() < today);
}

function isIndividualVacancyUrl(input: string): boolean {
  let url: URL;
  try { url = new URL(input); } catch { return false; }
  if (/\/(?:search|search-and-apply|jobsearch|searchjobs)(?:\/|$)/i.test(url.pathname)) return false;
  const smartRecruitersDetail = url.hostname === "jobs.smartrecruiters.com" && /^\/[^/]+\/\d+(?:[-/]|$)/.test(url.pathname);
  const detailPath = /\/(?:jobs?|vacancies|vacancy|positions?|roles?|requisitions?)\/(?!search(?:\/|$))[^/]+/i.test(url.pathname) ||
    /\/JobDetail(?:\/[^/]+|$)/i.test(url.pathname) && (url.pathname.match(/\/JobDetail\/[^/]+/i) !== null || [...url.searchParams.keys()].some((key) => /^(?:folderId|jobId|reqId)$/i.test(key))) ||
    /\/(?:degree-apprenticeship|graduate-job)\/\d+\/[^/]+/i.test(url.pathname) ||
    /\/graduate-jobs\/[^/]+\/[^/]+/i.test(url.pathname);
  return detailPath || smartRecruitersDetail;
}

function isIndividualVacancy(page: PageRecord, listingTitle: string): boolean {
  const titleIsRole = /apprentic/i.test(listingTitle) && techPattern.test(listingTitle) && degreePattern.test(listingTitle);
  return isIndividualVacancyUrl(page.page.url) && titleIsRole;
}

function hasScopedApplyLink(page: PageRecord): boolean {
  let source: URL;
  try { source = new URL(page.page.url); } catch { return false; }
  const sourceId = source.searchParams.get("folderId") ?? source.searchParams.get("jobId") ?? source.searchParams.get("reqId");
  return page.page.links.some((link) => {
    if (!/^apply(?:\s+now)?$/i.test(link.text.trim())) return false;
    try {
      const target = new URL(link.url, source);
      if (!/applicationmethods|application|apply/i.test(target.pathname)) return false;
      if (target.hostname !== source.hostname) return false;
      const targetId = target.searchParams.get("folderId") ?? target.searchParams.get("jobId") ?? target.searchParams.get("reqId");
      return !sourceId || targetId === sourceId;
    } catch { return false; }
  });
}

function includesQuote(source: string, quote: string): boolean {
  const q = normalText(quote);
  return q.length >= 8 && normalText(source).includes(q);
}

function statusConcernsApprenticeship(page: PageRecord, quote: string): boolean {
  return isPromisingCandidate(quote) || isPromisingCandidate(page.page.title) ||
    /\ball\s+(?:our\s+)?(?:[a-z]+\s+){0,3}apprenticeship\b/i.test(quote);
}

function isScopedApprenticeshipQuery(query: string, companyName: string): boolean {
  const companyScoped = companyTokens(companyName).some((token) => new RegExp(`\\b${token}\\b`, "i").test(query));
  return companyScoped && /apprentic/i.test(query) && /\b(?:tech|technology|software|digital|data|cyber|it|degree|level\s*[67])\b/i.test(query);
}

function isScopedEmptySearch(record: PageRecord): boolean {
  if (!record.successful || !noResultsPattern.test(record.page.text) || genericCountPattern.test(record.page.text)) return false;
  const url = `${record.requestedUrl} ${record.page.url}`;
  const urlParts = (() => { try { const u = new URL(record.page.url); return `${u.pathname} ${[...u.searchParams.entries()].flat().join(" ")}`; } catch { return url; } })();
  const hasApprenticeshipFilter = /apprentic/i.test(urlParts);
  const hasJobSearchContext = /(?:search|filter|jobs?|vacanc|opportunit)/i.test(`${url} ${record.page.title}`);
  return hasApprenticeshipFilter && hasJobSearchContext;
}

export class ScanEvidence {
  private readonly searches: SearchRecord[] = [];
  private readonly pages: PageRecord[] = [];
  private readonly candidates = new Map<string, { url: string; sources: string[]; resolved: boolean }>();
  /** Exact third-party vacancy URLs discovered on a company-owned domain or company-scoped hub. */
  private readonly verifiedEmployerRoutes = new Set<string>();

  private readonly companyName: string;
  private readonly now: Date;

  constructor(companyName: string, now: Date = new Date()) {
    this.companyName = companyName;
    this.now = now;
  }

  recordSearch(query: string, results: SearchResult[]): void {
    this.searches.push({ query, results: results.map((r) => ({ ...r })) });
    for (const result of results) {
      const resultRelevant = isOfficialCompanyUrl(result.url, this.companyName) || urlHasCompanyScope(result.url, this.companyName) || companyTokens(this.companyName).some((token) => new RegExp(`\\b${token}\\b`, "i").test(result.title));
      if (resultRelevant && isPromisingCandidate(`${result.title} ${result.snippet} ${result.url}`)) this.addCandidate(result.url, `search:${query}`);
    }
    this.refreshCandidates();
  }

  recordPage(requestedUrl: string, page: ReadPage): void {
    let resolvedLinks: { text: string; url: string }[] = [];
    try {
      resolvedLinks = page.links.map((link) => ({ ...link, url: new URL(link.url, page.url || requestedUrl).toString() }));
    } catch {
      resolvedLinks = page.links.map((link) => ({ ...link }));
    }
    const stored: ReadPage = { ...page, links: resolvedLinks.map((l) => ({ ...l })) };
    const successful = !isBlocked(stored);
    const aliases = [...new Set([requestedUrl, page.url].map(canonicalUrl))];
    const sourceIsTrusted = isOfficialCompanyUrl(page.url, this.companyName) || aliases.some((alias) => this.verifiedEmployerRoutes.has(alias));
    const sourceIsCompanyScoped = sourceIsTrusted || urlHasCompanyScope(page.url, this.companyName);
    if (sourceIsCompanyScoped) {
      for (const link of resolvedLinks) {
        const linkContent = `${link.text} ${link.url}`;
        const candidate = isPromisingCandidate(linkContent);
        const externalJobRoute = !isOfficialCompanyUrl(link.url, this.companyName) && /(?:career|jobs?|vacanc|workday|greenhouse|smartrecruiters|lever|oracle|eightfold)/i.test(linkContent);
        if (!candidate && !externalJobRoute) continue;
        if (candidate) this.addCandidate(link.url, `page:${page.url}`);
        // Aggregators can discover candidates but cannot grant employer authority.
        if (successful && sourceIsTrusted && !isOfficialCompanyUrl(link.url, this.companyName) && isSpecificEmployerRoute(link.url)) this.verifiedEmployerRoutes.add(canonicalUrl(link.url));
      }
    }
    this.pages.push({ requestedUrl, page: stored, aliases, successful });
    this.refreshCandidates();
  }

  private addCandidate(url: string, source: string): void {
    const key = canonicalUrl(url);
    const found = this.candidates.get(key);
    if (found) {
      if (!found.sources.includes(source)) found.sources.push(source);
    } else this.candidates.set(key, { url, sources: [source], resolved: false });
  }

  private pageFor(url: string): PageRecord | undefined {
    const key = canonicalUrl(url);
    return [...this.pages].reverse().find((p) => p.successful && p.aliases.includes(key));
  }

  private isTrustedEmployerPage(page: PageRecord): boolean {
    return isOfficialCompanyUrl(page.page.url, this.companyName) || isOfficialCompanyUrl(page.requestedUrl, this.companyName) ||
      page.aliases.some((alias) => this.verifiedEmployerRoutes.has(alias)) && hasListingEmployer(page, this.companyName);
  }

  private refreshCandidates(): void {
    for (const candidate of this.candidates.values()) {
      const read = this.pageFor(candidate.url);
      if (!read) { candidate.resolved = false; continue; }
      const lead = `${read.page.title}\n${read.page.text.slice(0, 1800)}`;
      const inactive = closedVacancyPattern.test(lead) || isExpiredVacancy(read, this.now) ||
        /\b(?:talent pool|register(?: your)? interest|no longer available|job not found|vacancy no longer exists)\b/i.test(lead);
      const readDiscoveryHub = !isIndividualVacancyUrl(read.page.url);
      const irrelevant = read.page.text.length >= 200 && !isPromisingCandidate(`${read.page.title} ${read.page.text}`);
      candidate.resolved = this.isTrustedEmployerPage(read) || inactive || irrelevant || readDiscoveryHub || read.page.links.some((link) => {
        const employerPage = this.pageFor(link.url);
        return !!employerPage && this.isTrustedEmployerPage(employerPage) &&
          isIndividualVacancy(employerPage, `${employerPage.page.title} ${employerPage.page.text.slice(0, 2000)}`);
      });
    }
  }

  potentialLiveVacancies(): { url: string; title: string }[] {
    return this.pages.filter((page) => page.successful && this.isTrustedEmployerPage(page) &&
      isIndividualVacancy(page, page.page.title) && isPromisingCandidate(page.page.title) &&
      !closedVacancyPattern.test(page.page.text) && !isExpiredVacancy(page, this.now) &&
      !/talent pool|register(?: your)? interest/i.test(`${page.page.title} ${page.page.text.slice(0, 700)}`) &&
      (hasScopedApplyLink(page) || activePattern.test(page.page.text) || closingDates(page.page.text).some((date) => date.getTime() >= new Date(this.now.getFullYear(), this.now.getMonth(), this.now.getDate()).getTime()))
    ).map(({ page }) => ({ url: page.url, title: page.title }));
  }

  validate(verdict: ScanVerdict): string[] {
    const problems: string[] = [];
    const allQuotes = [
      ...verdict.evidence.map((item) => ({ ...item, kind: "evidence" })),
      ...verdict.listings.map((item) => ({ ...item, kind: "listing" })),
    ];
    for (const item of allQuotes) {
      const page = this.pageFor(item.url);
      if (!page) problems.push(`${item.kind} quote URL has not been successfully read: ${item.url}`);
      else if (!includesQuote(`${page.page.title}\n${page.page.text}`, item.quote)) problems.push(`${item.kind} quote does not occur on its cited page: ${item.url}`);
    }

    const pending = [...this.candidates.values()].filter((c) => !c.resolved);
    if (pending.length && ["none_found", "closed", "upcoming", "blocked"].includes(verdict.status)) {
      problems.push(`Promising apprenticeship candidates remain unread or blocked: ${pending.map((c) => c.url).join(", ")}`);
    }
    if (["none_found", "closed", "upcoming", "blocked"].includes(verdict.status)) {
      const live = this.pages.filter((page) => page.successful && this.isTrustedEmployerPage(page) &&
        isIndividualVacancy(page, `${page.page.title} ${page.page.text.slice(0, 2000)}`) &&
        !closedVacancyPattern.test(page.page.text) && !isExpiredVacancy(page, this.now) &&
        !/talent pool|register(?: your)? interest/i.test(`${page.page.title} ${page.page.text.slice(0, 700)}`) &&
        (hasScopedApplyLink(page) || activePattern.test(page.page.text)));
      if (live.length) problems.push(`Read employer pages still advertise a potentially live tech degree apprenticeship: ${live.map((page) => page.page.url).join(", ")}. Resolve these vacancies before a negative verdict.`);
    }

    if (verdict.status === "open") {
      if (!verdict.listings.length) problems.push("open requires at least one individually read technology degree apprenticeship vacancy.");
      for (const listing of verdict.listings) {
        const page = this.pageFor(listing.url);
        if (!page) continue;
        const body = `${page.page.title}\n${page.page.text}`;
        if (!normalText(body).includes(normalText(listing.title))) problems.push(`Listing title is not present on its cited vacancy page: ${listing.title}`);
        if (!isPromisingCandidate(`${listing.title} ${body}`)) problems.push(`Listing is not evidenced as a technology/software/digital/data/cyber/IT degree apprenticeship: ${listing.title}`);
        if (!isIndividualVacancy(page, listing.title)) problems.push(`Listing URL and title do not identify an individual apprenticeship vacancy: ${listing.url}`);
        if (!this.isTrustedEmployerPage(page)) problems.push(`Vacancy page is not on the requested company's official domain or an exact employer-linked ATS route.`);
        if (/\b(?:talent pool|register(?: your)? interest|register for updates|expression of interest)\b/i.test(`${page.page.title} ${listing.title} ${page.page.text.slice(0, 700)}`)) {
          problems.push(`Page is a talent pool or register-interest page rather than a current vacancy: ${listing.url}`);
        }
        if (closedVacancyPattern.test(body)) problems.push(`Vacancy page explicitly says this role or its applications are closed: ${listing.url}`);
        if (isExpiredVacancy(page, this.now)) problems.push(`Vacancy deadline has passed: ${listing.url}`);
        if (!activePattern.test(body) && !hasScopedApplyLink(page) && !closingDates(body).some((date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() >= new Date(this.now.getFullYear(), this.now.getMonth(), this.now.getDate()).getTime())) {
          problems.push(`Vacancy page lacks a scoped Apply link or an active future deadline: ${listing.url}`);
        }
      }
    }

    if (verdict.status === "closed") {
      const explicit = verdict.evidence.some((e) => {
        const p = this.pageFor(e.url);
        return !!p && this.isTrustedEmployerPage(p) && isPromisingCandidate(`${p.page.title} ${p.page.text}`) && statusConcernsApprenticeship(p, e.quote) && explicitClosedPattern.test(e.quote) && !/closing date|deadline|closes? on|apply by/i.test(e.quote);
      });
      if (!explicit) problems.push("closed requires a source-bound statement that apprenticeship applications are closed or the scheme is full; a deadline or typical calendar is not enough.");
    }

    if (verdict.status === "upcoming") {
      const explicit = verdict.evidence.some((e) => {
        const p = this.pageFor(e.url);
        return !!p && this.isTrustedEmployerPage(p) && isPromisingCandidate(`${p.page.title} ${p.page.text}`) && statusConcernsApprenticeship(p, e.quote) && explicitUpcomingPattern.test(e.quote) && statedWhenPattern.test(e.quote) && !/register your interest|register for updates/i.test(e.quote);
      });
      if (!explicit) problems.push("upcoming requires a source-bound apprenticeship application opening statement with a stated date or season; register-interest text alone is not enough.");
    }

    if (verdict.status === "none_found") {
      const scopedQueries = new Set(this.searches.filter((s) => isScopedApprenticeshipQuery(s.query, this.companyName)).map((s) => normalText(s.query)));
      if (scopedQueries.size < 2) problems.push("none_found requires at least two distinct company-scoped technology apprenticeship search queries.");
      const emptyPages = this.pages.filter((p) => this.isTrustedEmployerPage(p) && isScopedEmptySearch(p));
      if (!emptyPages.length) problems.push("none_found requires source-bound no-results evidence from an official company job board or exact employer-linked ATS apprenticeship search; a large result count is not absence evidence.");
      if (!verdict.evidence.some((e) => {
        const page = this.pageFor(e.url);
        return !!page && this.isTrustedEmployerPage(page) && isScopedEmptySearch(page) && includesQuote(page.page.text, e.quote);
      })) problems.push("none_found evidence must quote an official company job-board or exact employer-linked ATS no-results page.");
    }

    if (verdict.status === "blocked" && !this.pages.some((p) => !p.successful)) problems.push("blocked requires at least one recorded page access failure or blocked page.");
    return [...new Set(problems)];
  }

  snapshot(): {
    companyName: string;
    pendingCandidates: { url: string; sources: string[] }[];
    searches: SearchRecord[];
    pages: { requestedUrl: string; page: ReadPage; aliases: string[]; successful: boolean }[];
  } {
    return {
      companyName: this.companyName,
      pendingCandidates: [...this.candidates.values()].filter((c) => !c.resolved).map(({ url, sources }) => ({ url, sources: [...sources] })),
      searches: this.searches.map((s) => ({ query: s.query, results: s.results.map((r) => ({ ...r })) })),
      pages: this.pages.map((p) => ({ ...p, aliases: [...p.aliases], page: { ...p.page, links: p.page.links.map((l) => ({ ...l })) } })),
    };
  }
}
