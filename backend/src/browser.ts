import { type Browser, chromium } from "playwright";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

let browser: Promise<Browser> | undefined;
// Inside a container Chromium runs as root (no user namespace sandbox) and /dev/shm is small.
const containerArgs = process.env.CHROMIUM_NO_SANDBOX === "1" ? ["--no-sandbox", "--disable-dev-shm-usage"] : [];
const getBrowser = () =>
  (browser ??= chromium.launch({ args: ["--disable-blink-features=AutomationControlled", ...containerArgs] }));

export type Link = { text: string; url: string };
export type RenderedPage = { url: string; title: string; text: string; links: Link[]; status: number };

/** Runs `fn` with a fresh page in headless Chromium, closing the context afterwards. */
async function withPage<T>(fn: (page: import("playwright").Page) => Promise<T>): Promise<T> {
  const context = await (await getBrowser()).newContext({ locale: "en-GB", userAgent: USER_AGENT });
  try {
    return await fn(await context.newPage());
  } finally {
    await context.close();
  }
}

/** Waits for client-side job widgets, then scrolls to trigger lazy-loaded lists. */
async function settle(page: import("playwright").Page) {
  await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {});
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    await page.waitForTimeout(500);
  }
  await page.waitForLoadState("networkidle", { timeout: 4_000 }).catch(() => {});
}

const relevantDisclosure = /apprentice|application|recruit|open positions?|vacanc|closing dates?|key dates?|eligib|qualification|entry requirements?|faq|frequently asked/i;
const sensitiveAction = /apply|register|sign[ -]?in|log[ -]?in|cookie|consent|account/i;

/** Opens likely job and apprenticeship disclosures without invoking page event handlers. */
async function expandRelevantContent(page: import("playwright").Page) {
  return page.evaluate(({ relevant, sensitive }) => {
    const relevantPattern = new RegExp(relevant, "i");
    const sensitivePattern = new RegExp(sensitive, "i");
    let expanded = 0;
    const disclosedText: string[] = [];
    for (const details of Array.from(document.querySelectorAll<HTMLDetailsElement>("details:not([open])"))) {
      if (expanded >= 12) break;
      const label = details.querySelector("summary")?.textContent ?? "";
      if (relevantPattern.test(label) && !sensitivePattern.test(label)) {
        details.open = true;
        expanded++;
      }
    }

    for (const trigger of Array.from(document.querySelectorAll<HTMLElement>(
      'button[aria-expanded="false"], [role="button"][aria-expanded="false"]',
    ))) {
      if (expanded >= 12 || trigger.closest("form")) continue;
      const label = [trigger.innerText, trigger.getAttribute("aria-label"), trigger.getAttribute("title")]
        .filter(Boolean).join(" ");
      if (!relevantPattern.test(label) || sensitivePattern.test(label)) continue;
      const controlled = trigger.getAttribute("aria-controls")?.split(/\s+/).filter(Boolean) ?? [];
      if (!controlled.length) continue;
      const panels = controlled.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => !!el);
      if (!panels.length) continue;
      trigger.setAttribute("aria-expanded", "true");
      for (const panel of panels) {
        panel.hidden = false;
        panel.removeAttribute("aria-hidden");
        panel.style.removeProperty("display");
        panel.style.removeProperty("visibility");
        // Many custom accordions stay CSS-hidden until their own event handler
        // runs. Read the associated panel without triggering navigation/forms.
        const copy = panel.cloneNode(true) as HTMLElement;
        for (const element of Array.from(copy.querySelectorAll("script, style, template"))) element.remove();
        if (copy.textContent?.trim()) disclosedText.push(copy.textContent.trim());
      }
      expanded++;
    }
    return disclosedText;
  }, { relevant: relevantDisclosure.source, sensitive: sensitiveAction.source });
}

/** Renders a page (JavaScript executed) and returns its visible text and links. */
export function renderPage(url: string): Promise<RenderedPage> {
  return withPage(async (page) => {
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch((error: Error) => {
      throw new Error(`Couldn't load ${url}: ${error.message.split("\n")[0]}`);
    });
    await settle(page);
    const disclosedText = await expandRelevantContent(page);
    const links = await page.$$eval("a[href]", (els) =>
      els.map((a) => ({ text: (a.textContent ?? "").replace(/\s+/g, " ").trim(), url: (a as HTMLAnchorElement).href })),
    );
    const visibleText = await page.innerText("body").catch(() => "");
    return {
      url: page.url(),
      title: await page.title(),
      text: [visibleText, ...disclosedText.filter((text) => !visibleText.includes(text))].join("\n\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim(),
      links: links.filter((l) => l.url.startsWith("http")),
      status: res?.status() ?? 0,
    };
  });
}

export type SearchResult = { title: string; url: string; snippet: string; source?: "bing" | "yahoo" | "google" };
export type SearchResults = SearchResult[] & { hasMore?: boolean };

function searchPage(results: SearchResult[], unfilteredCount: number): SearchResults {
  // Filtering irrelevant hits must not make a full provider page look exhausted.
  return Object.assign(results, { hasMore: unfilteredCount >= 10 });
}

const MAX_SEARCH_PAGES = 5;

/** Builds a bounded Bing result page URL; Bing's `first` parameter is one-based. */
export function bingSearchUrl(query: string, pageNumber = 1): string {
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > MAX_SEARCH_PAGES) {
    throw new RangeError(`pageNumber must be an integer from 1 to ${MAX_SEARCH_PAGES}`);
  }
  const params = new URLSearchParams({ q: query, setlang: "en-GB", cc: "GB" });
  if (pageNumber > 1) params.set("first", String((pageNumber - 1) * 10 + 1));
  return `https://www.bing.com/search?${params}`;
}

/** Builds a bounded Google HTML search URL using the same query and page number as Bing. */
export function googleSearchUrl(query: string, pageNumber = 1): string {
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > MAX_SEARCH_PAGES) {
    throw new RangeError(`pageNumber must be an integer from 1 to ${MAX_SEARCH_PAGES}`);
  }
  const params = new URLSearchParams({ q: query, num: "10", hl: "en", gl: "gb" });
  if (pageNumber > 1) params.set("start", String((pageNumber - 1) * 10));
  return `https://www.google.com/search?${params}`;
}

export function yahooSearchUrl(query: string, pageNumber = 1): string {
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > MAX_SEARCH_PAGES) {
    throw new RangeError(`pageNumber must be an integer from 1 to ${MAX_SEARCH_PAGES}`);
  }
  const params = new URLSearchParams({ p: query });
  if (pageNumber > 1) params.set("b", String((pageNumber - 1) * 10 + 1));
  return `https://search.yahoo.com/search?${params}`;
}

const apprenticeshipIntent = /\b(apprentice|apprenticeship|apprenticeships)\b/i;
const apprenticeshipContext = /\b(apprentice|apprenticeship|apprenticeships|graduate|early careers?|career|careers|jobs?|vacanc(?:y|ies)|trainee|training|students?)\b/i;
const queryStopWords = new Set(["the", "and", "for", "with", "from", "near", "in", "at", "to", "a", "an", "of"]);

/** Rejects broad employer/homepage hits that only repeat the employer name. */
export function isRelevantApprenticeshipResult(query: string, result: SearchResult): boolean {
  if (!apprenticeshipIntent.test(query)) return true;
  const queryTerms = Array.from(new Set(query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []))
    .filter((term) => term.length > 2 && !queryStopWords.has(term) && !/^apprenticeships?$/.test(term));
  const haystack = `${result.title} ${result.snippet} ${result.url}`.toLowerCase();
  const matched = queryTerms.filter((term) => haystack.includes(term)).length;
  const minimumMatches = Math.min(queryTerms.length, Math.max(1, Math.ceil(queryTerms.length * 0.4)));
  return matched >= minimumMatches && apprenticeshipContext.test(haystack);
}

async function readBingResults(page: import("playwright").Page): Promise<SearchResult[]> {
  const raw = await page.$$eval("li.b_algo", (els) =>
    els.slice(0, 10).map((e) => ({
      title: e.querySelector("h2")?.textContent?.trim() ?? "",
      url: e.querySelector("h2 a")?.getAttribute("href") ?? "",
      snippet: (e.querySelector(".b_caption p, p")?.textContent ?? "").replace(/\s+/g, " ").trim(),
    })),
  );
  return raw.map((r) => ({ ...r, url: unwrapBingUrl(r.url), source: "bing" as const })).filter((r) => r.url.startsWith("http"));
}

async function readGoogleResults(page: import("playwright").Page): Promise<SearchResult[]> {
  const state = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    text: (document.body?.innerText ?? "").slice(0, 12_000),
  }));
  if (!/(^|\.)google\.[a-z.]+$/i.test(new URL(state.url).hostname)) return [];
  // Consent, CAPTCHA, and bot challenge pages are not search results. Do not interact with them.
  if (/\/sorry(?:\/|\?|$)|\/consent(?:\/|\?|$)/i.test(state.url) || /unusual traffic|automated queries|captcha|recaptcha|before you continue to google/i.test(`${state.title} ${state.text}`)) return [];
  const raw = await page.$$eval("a:has(h3)", (anchors) =>
    anchors.slice(0, 20).map((anchor) => {
      const heading = anchor.querySelector("h3");
      const container = anchor.closest("div.MjjYud") ?? anchor.parentElement?.parentElement;
      const wrappedHref = (anchor as HTMLAnchorElement).href;
      return {
        title: heading?.textContent?.trim() ?? "",
        url: wrappedHref,
        snippet: (container?.querySelector(".VwiC3b, [data-sncf], .s3v9rd")?.textContent ?? "").replace(/\s+/g, " ").trim(),
      };
    }),
  );
  return raw.map((r) => ({ ...r, url: unwrapGoogleUrl(r.url), source: "google" as const })).filter((r) => r.url.startsWith("http") && !new URL(r.url).hostname.endsWith("google.com"));
}

async function readYahooResults(page: import("playwright").Page): Promise<SearchResult[]> {
  if (new URL(page.url()).hostname !== "search.yahoo.com") return [];
  // Only organic result anchors: consent UI, navigation and sponsored links are excluded.
  return page.$$eval('a[data-matarget="algo"]:has(h3)', (anchors) =>
    anchors.slice(0, 10).map((anchor) => ({
      title: anchor.querySelector("h3")?.textContent?.trim() ?? "",
      url: (anchor as HTMLAnchorElement).href,
      snippet: (anchor.closest("li")?.querySelector(".compText, p")?.textContent ?? "").replace(/\s+/g, " ").trim(),
      source: "yahoo" as const,
    })).filter((result) => result.url.startsWith("http")),
  );
}

/** Bounded search fallback when a provider returns broad or unusable results. */
export function searchWeb(query: string, pageNumber = 1): Promise<SearchResults> {
  return withPage(async (page) => {
    const bingLoaded = await page.goto(bingSearchUrl(query, pageNumber), {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    }).then(() => true, () => false);
    if (bingLoaded) {
      await page.locator("li.b_algo").first().waitFor({ state: "attached", timeout: 10_000 }).catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
    }
    const bingResults = bingLoaded ? await readBingResults(page) : [];
    if (!apprenticeshipIntent.test(query)) return searchPage(bingResults, bingResults.length);
    const relevantBing = bingResults.filter((result) => isRelevantApprenticeshipResult(query, result));
    if (relevantBing.some((result) => apprenticeshipIntent.test(`${result.title} ${result.snippet} ${result.url}`))) return searchPage(relevantBing, bingResults.length);

    // Bing sometimes ignores multi-term apprenticeship queries and returns generic employer pages.
    const yahooLoaded = await page.goto(yahooSearchUrl(query, pageNumber), { waitUntil: "domcontentloaded", timeout: 20_000 }).then(() => true, () => false);
    if (yahooLoaded) {
      await page.locator('a[data-matarget="algo"] h3').first().waitFor({ state: "attached", timeout: 8_000 }).catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 4_000 }).catch(() => {});
      const yahooResults = await readYahooResults(page);
      const relevantYahoo = yahooResults.filter((result) => isRelevantApprenticeshipResult(query, result));
      if (relevantYahoo.some((result) => apprenticeshipIntent.test(`${result.title} ${result.snippet} ${result.url}`))) return searchPage(relevantYahoo, yahooResults.length);
    }
    await page.goto(googleSearchUrl(query, pageNumber), { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => {});
    await page.locator("a:has(h3)").first().waitFor({ state: "attached", timeout: 8_000 }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 4_000 }).catch(() => {});
    const googleResults = await readGoogleResults(page);
    return searchPage(googleResults.filter((result) => isRelevantApprenticeshipResult(query, result)), googleResults.length);
  });
}

/** Bing wraps result links in a redirect whose `u` param is base64url (prefixed "a1"). */
function unwrapBingUrl(href: string): string {
  try {
    const u = new URL(href);
    if (!u.hostname.endsWith("bing.com")) return href;
    const encoded = u.searchParams.get("u");
    if (encoded?.startsWith("a1")) return Buffer.from(encoded.slice(2), "base64url").toString("utf8");
  } catch {
    // fall through
  }
  return href;
}

/** Google search result links may use a `/url?q=` redirect. */
function unwrapGoogleUrl(href: string): string {
  try {
    const url = new URL(href);
    if (url.hostname.endsWith("google.com")) return url.searchParams.get("q") ?? url.searchParams.get("url") ?? href;
  } catch {
    // fall through
  }
  return href;
}

export type GovVacancy = {
  title: string;
  employer: string;
  url: string;
  /** Full text of the result card: location, start date, wage, closing date, etc. */
  details: string;
};

/** Searches the official Find an Apprenticeship service (England). */
export function searchGovVacancies(searchTerm: string, levels: number[], pageNumber = 1): Promise<{ total: number | null; vacancies: GovVacancy[]; pageText: string }> {
  return withPage(async (page) => {
    const params = new URLSearchParams({ searchTerm, sort: "AgeAsc" });
    if (pageNumber > 1) params.set("pageNumber", String(pageNumber));
    for (const level of levels) params.append("levelIds", String(level));
    await page.goto(`https://www.findapprenticeship.service.gov.uk/apprenticeships?${params}`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    const body = (await page.innerText("body")).replace(/\s+/g, " ");
    const total = body.match(/([\d,]+) results? found/i)?.[1];
    const cards = await page.$$eval(".das-search-results__list-item", (els) =>
      els.slice(0, 25).map((e) => {
        const a = e.querySelector("a");
        const details = (e.textContent ?? "").replace(/\s+/g, " ").trim();
        const title = a?.textContent?.trim() ?? "";
        const afterTitle = details.slice(details.indexOf(title) + title.length).trim();
        return { title, href: a?.getAttribute("href") ?? "", details, afterTitle };
      }),
    );
    return {
      total: total ? Number(total.replace(/,/g, "")) : null,
      pageText: body,
      vacancies: cards.map((c) => ({
        title: c.title,
        // The employer name directly follows the title in the card text.
        employer: c.afterTitle.split(/\s{1,}(?=[A-Z][a-z]+ \(|Start date)/)[0].slice(0, 120),
        url: new URL(c.href, "https://www.findapprenticeship.service.gov.uk").href,
        details: c.details,
      })),
    };
  });
}
