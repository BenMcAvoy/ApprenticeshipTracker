import assert from "node:assert/strict";
import test from "node:test";
import type { LanguageModel, ModelMessage } from "ai";
import { runScan, type ScanDependencies, type Verdict } from "../src/scan.ts";
import type { ReadPage, SearchResult } from "../src/scan-evidence.ts";

const company = { name: "Siemens", careersUrl: null };
const model = {} as LanguageModel;
const emptyPage = (url: string, text = "Siemens careers information.", title = "Siemens Careers"): ReadPage => ({ url, text, title, status: 200, links: [] });
const drained = async (dependencies: ScanDependencies): Promise<Verdict> => {
  const scan = runScan(company, { model, timeoutMs: 5_000, ...dependencies });
  let item = await scan.next();
  while (!item.done) item = await scan.next();
  return item.value;
};

type ToolBag = Record<string, { execute?: (input: any, options: any) => Promise<any> }>;
type FakeCall = {
  tools: ToolBag;
  messages: ModelMessage[];
  onStepFinish: (step: { text?: string; response: { messages: ModelMessage[] } }) => void;
};
type FakeOptions = {
  tools: ToolBag;
  messages: ModelMessage[];
  onStepFinish: FakeCall["onStepFinish"];
};
const fakeGenerate = (implementation: (call: FakeCall) => Promise<unknown> | unknown) =>
  (async (options: FakeOptions) => implementation(options as FakeCall)) as unknown as NonNullable<ScanDependencies["generateText"]>;

const noSearchResults = async (): Promise<SearchResult[]> => [];
const inertDependencies: ScanDependencies = {
  searchWeb: noSearchResults as NonNullable<ScanDependencies["searchWeb"]>,
  renderPage: async (url) => emptyPage(url),
  searchGovVacancies: async () => ({ total: null, vacancies: [], pageText: "The result count could not be read." }),
};
const step = (call: FakeCall, messages: ModelMessage[] = [], text?: string) => call.onStepFinish({ text, response: { messages } });

test("prose without a verdict does not end the scan before the step budget", async () => {
  let calls = 0;
  const verdict = await drained({
    ...inertDependencies,
    maxSteps: 2,
    generateText: fakeGenerate(async (call) => {
      calls++;
      step(call, [], "I will keep checking the available evidence.");
    }),
  });

  assert.equal(calls, 2);
  assert.equal(verdict.status, "unclear");
  assert.equal(verdict.diagnostics?.complete, false);
  assert.ok(verdict.diagnostics?.events.some((entry) => entry.message.includes("Continuing research")));
});

test("an invalid none_found submission cannot bypass evidence validation", async () => {
  let report: unknown;
  const verdict = await drained({
    ...inertDependencies,
    maxSteps: 1,
    generateText: fakeGenerate(async (call) => {
      report = await call.tools.report_verdict.execute!({ status: "none_found", summary: "No vacancies found.", listings: [], evidence: [] }, {});
      step(call);
    }),
  });

  assert.equal((report as { accepted: boolean }).accepted, false);
  assert.equal(verdict.status, "unclear");
  assert.equal(verdict.diagnostics?.complete, false);
  assert.ok(verdict.diagnostics?.events.some((entry) => entry.message.includes("Verdict rejected")));
});

test("many tool calls still cannot accept none_found while a candidate source is unread", async () => {
  const candidate = "https://jobs.siemens.com/en_US/externaljobs/JobDetail?folderId=518834";
  const roleTitle = "Digital Degree Apprentice - (Level 6)";
  const searchWeb = async (): Promise<SearchResult[]> => [{
    title: roleTitle,
    url: candidate,
    snippet: "Siemens Digital Degree Apprentice technology role, Level 6.",
  }];
  let report: { accepted: boolean; problems?: string[] } | undefined;
  const verdict = await drained({
    ...inertDependencies,
    searchWeb: searchWeb as NonNullable<ScanDependencies["searchWeb"]>,
    renderPage: async (url) => url === candidate
      ? { ...emptyPage(url, "Access denied", roleTitle), status: 403 }
      : emptyPage(url),
    maxSteps: 1,
    generateText: fakeGenerate(async (call) => {
      for (let index = 0; index < 5; index++) {
        await call.tools.search_web.execute!({ query: `Siemens apprenticeship source ${index}`, page: 1 }, {});
      }
      report = await call.tools.report_verdict.execute!({ status: "none_found", summary: "No vacancies found.", listings: [], evidence: [] }, {});
      step(call);
    }),
  });

  assert.equal(verdict.status, "unclear");
  assert.equal(report?.accepted, false);
  assert.ok((verdict.diagnostics?.research.pendingCandidates.length ?? 0) > 0);
  assert.ok(report?.problems?.some((problem) => problem.includes("candidates remain unread or blocked")));
  assert.ok((verdict.checked ?? 0) >= 9, "preflight and model together should exceed eight tool calls");
});

test("response messages from a failed model call are retained for the retry", async () => {
  let calls = 0;
  let retryMessages: ModelMessage[] = [];
  const retained: ModelMessage = { role: "assistant", content: "Prior tool conversation retained." };
  const verdict = await drained({
    ...inertDependencies,
    maxSteps: 2,
    generateText: fakeGenerate(async (call) => {
      calls++;
      if (calls === 1) {
        step(call, [retained]);
        throw new Error("transient model error");
      }
      retryMessages = call.messages;
      step(call);
    }),
  });

  assert.equal(calls, 2);
  assert.ok(retryMessages.includes(retained));
  assert.ok(retryMessages.some((message) => message.role === "user" && message.content.toString().includes("previous request failed")));
  assert.equal(verdict.status, "unclear");
});

test("the Siemens Digital Degree Apprentice vacancy is accepted with its scoped Apply link", async () => {
  const programmeUrl = "https://careers.siemens.com/early-careers/technology-degree-apprenticeships";
  const jobsUrl = "https://jobs.siemens.com/en_US/externaljobs/search?query=apprentice";
  const roleUrl = "https://jobs.siemens.com/en_US/externaljobs/JobDetail?folderId=518834";
  const applyUrl = "https://jobs.siemens.com/en_US/externaljobs/ApplicationMethods?folderId=518834";
  const title = "Digital Degree Apprentice - (Level 6)";
  const quote = "Closing date: 31 December 2099";
  const results: SearchResult[] = [
    { title: "Siemens Technology Degree Apprenticeships", url: programmeUrl, snippet: "Siemens apprenticeships and early careers." },
    { title: "Siemens apprenticeship jobs", url: jobsUrl, snippet: "Search Siemens apprentice vacancies." },
    { title, url: roleUrl, snippet: "Siemens Digital Degree Apprentice technology Level 6. Closing date 31 December 2099." },
  ];
  let report: { accepted: boolean } | undefined;
  const verdict = await drained({
    ...inertDependencies,
    searchWeb: async () => results as SearchResult[] as any,
    renderPage: async (url) => {
      if (url === programmeUrl) return emptyPage(url, "Siemens technology degree apprenticeship programme for early careers.", "Siemens Technology Degree Apprenticeships");
      if (url === jobsUrl) return emptyPage(url, "Search Siemens apprenticeship vacancies.", "Siemens apprenticeship jobs");
      if (url === roleUrl) return {
        ...emptyPage(url, `${title}. Siemens Mobility Limited, UK Chippenham. ${quote}.`, title),
        links: [{ text: "Apply", url: applyUrl }],
      };
      return emptyPage(url);
    },
    maxSteps: 1,
    generateText: fakeGenerate(async (call) => {
      await call.tools.search_gov_vacancies.execute!({ searchTerm: "Siemens", levels: [6, 7], page: 1 }, {});
      report = await call.tools.report_verdict.execute!({
        status: "open",
        summary: "A current Siemens Digital Degree Apprentice vacancy is available.",
        listings: [{ title, url: roleUrl, quote }],
        evidence: [],
      }, {});
      step(call);
    }),
  });

  assert.equal(report?.accepted, true);
  assert.equal(verdict.status, "open");
  assert.equal(verdict.diagnostics?.complete, true);
  assert.deepEqual(verdict.listings.map((listing) => listing.url), [roleUrl]);
  const detail = verdict.diagnostics?.research.pages.find(({ page }) => page.url === roleUrl)?.page;
  assert.deepEqual(detail?.links, [{ text: "Apply", url: applyUrl }]);
});

test("an unknown government result count stays null in the model tool result", async () => {
  let govResult: { totalResults: number | null } | undefined;
  const verdict = await drained({
    ...inertDependencies,
    maxSteps: 1,
    generateText: fakeGenerate(async (call) => {
      govResult = await call.tools.search_gov_vacancies.execute!({ searchTerm: "Siemens", levels: [6, 7], page: 1 }, {});
      step(call);
    }),
  });

  assert.equal(govResult?.totalResults, null);
  assert.equal(verdict.diagnostics?.research.pages.some(({ page }) => page.title === "Siemens apprenticeship search"), false);
});

const roleFixture = (id: string, title: string) => {
  const url = `https://jobs.siemens.com/en_US/externaljobs/JobDetail?jobId=${id}`;
  const quote = `Closing date: 31 December 2099`;
  return {
    url,
    title,
    quote,
    searchResult: { title, url, snippet: `Siemens ${title}, technology degree apprenticeship Level 6.` },
    page: {
      ...emptyPage(url, `${title}. Siemens technology degree apprenticeship Level 6. ${quote}.`, title),
      links: [{ text: "Apply", url: `https://jobs.siemens.com/en_US/externaljobs/ApplicationMethods?jobId=${id}` }],
    },
    listing: { title, url, quote },
  };
};

test("filtered search hits retain the provider's next-page signal", async () => {
  const role = roleFixture("FILTERED-PAGE", "Digital Degree Apprentice");
  let response: any;
  await drained({
    ...inertDependencies,
    searchWeb: async () => Object.assign([role.searchResult], { hasMore: true }),
    renderPage: async () => role.page,
    searchGovVacancies: async () => ({ total: 0, vacancies: [], pageText: "No results found." }),
    maxSteps: 1,
    generateText: fakeGenerate(async (call) => {
      await call.tools.search_gov_vacancies.execute!({ searchTerm: "Siemens", levels: [6, 7], page: 1 }, {});
      response = await call.tools.report_verdict.execute!({ status: "open", summary: "Verified role", listings: [role.listing], evidence: [] }, {});
      step(call);
    }),
  });
  assert.equal(response.provisional, true);
  assert.equal(response.coverage.pendingWebPages.length, 3);
  assert.ok(response.coverage.pendingWebPages.every((page: { page: number }) => page.page === 2));
});

test("open roles are collected across model steps before coverage can complete", async () => {
  const first = roleFixture("ROLE-101", "Digital Degree Apprentice Software Engineer");
  const second = roleFixture("ROLE-202", "Cyber Security Degree Apprentice");
  const programmeUrl = "https://careers.siemens.com/early-careers/technology-degree-apprenticeships";
  const searchResults: SearchResult[] = [
    first.searchResult,
    second.searchResult,
    { title: "Siemens technology degree apprenticeship programme", url: programmeUrl, snippet: "Siemens technology degree apprenticeships." },
  ];
  let calls = 0;
  let firstResult: any;
  let secondResult: any;
  const verdict = await drained({
    ...inertDependencies,
    searchWeb: async () => searchResults,
    renderPage: async (url) => url === first.url ? first.page : url === second.url ? second.page : emptyPage(url, "Siemens technology degree apprenticeship programme."),
    searchGovVacancies: async () => ({ total: 0, vacancies: [], pageText: "No results found." }),
    maxSteps: 2,
    generateText: fakeGenerate(async (call) => {
      calls++;
      if (calls === 1) {
        await call.tools.search_gov_vacancies.execute!({ searchTerm: "Siemens", levels: [6, 7], page: 1 }, {});
        firstResult = await call.tools.report_verdict.execute!({ status: "open", summary: "A Siemens role is open.", listings: [first.listing], evidence: [] }, {});
        step(call);
        return;
      }
      secondResult = await call.tools.report_verdict.execute!({ status: "open", summary: "Two Siemens roles are open.", listings: [second.listing], evidence: [] }, {});
      step(call);
    }),
  });

  assert.equal(calls, 2, "the provisional first role must not end the model loop");
  assert.equal(firstResult?.provisional, true);
  assert.ok(firstResult?.advice?.includes(second.url), "provisional advice must name the omitted live vacancy");
  assert.equal(secondResult?.provisional, false);
  assert.equal(verdict.status, "open");
  assert.equal(verdict.coverage?.complete, true);
  assert.deepEqual(verdict.listings.map(({ url }) => url).sort(), [first.url, second.url].sort());
});

test("a mixed open submission retains only independently verified roles", async () => {
  const valid = roleFixture("ROLE-MIXED-VALID", "Digital Degree Apprentice Software Engineer");
  const invalidUrl = "https://jobs.siemens.com/en_US/externaljobs/JobDetail?jobId=ROLE-MIXED-INVALID";
  const invalidTitle = "Project Planning Apprentice";
  const invalidQuote = "Closing date: 31 December 2099";
  const invalidPage = {
    ...emptyPage(invalidUrl, `${invalidTitle}. Siemens project planning apprenticeship. ${invalidQuote}.`, invalidTitle),
    links: [{ text: "Apply", url: "https://jobs.siemens.com/en_US/externaljobs/ApplicationMethods?jobId=ROLE-MIXED-INVALID" }],
  };
  let report: any;
  const verdict = await drained({
    ...inertDependencies,
    searchWeb: async () => [valid.searchResult, {
      title: invalidTitle,
      url: invalidUrl,
      snippet: "Siemens Project Planning Apprentice role.",
    }],
    renderPage: async (url) => url === valid.url ? valid.page : url === invalidUrl ? invalidPage : emptyPage(url),
    maxSteps: 1,
    generateText: fakeGenerate(async (call) => {
      report = await call.tools.report_verdict.execute!({
        status: "open",
        summary: "Siemens vacancies are available.",
        listings: [valid.listing, { title: invalidTitle, url: invalidUrl, quote: invalidQuote }],
        evidence: [{ url: "https://unread.example.test/vacancy", quote: "This quote was never read from a source." }],
      }, {});
      step(call);
    }),
  });

  assert.equal(report?.accepted, false, "the mixed submission itself must remain rejected");
  assert.equal(report?.provisional, true);
  assert.deepEqual(report?.retainedVerifiedListings?.map(({ url }: { url: string }) => url), [valid.url]);
  assert.ok(report?.problems?.length > 0, "invalid role and extra evidence problems are returned");
  assert.equal(verdict.status, "open");
  assert.deepEqual(verdict.listings.map(({ url }) => url), [valid.url]);
  assert.equal(verdict.coverage?.complete, false);
  assert.equal(verdict.diagnostics?.complete, true, "the retained role was independently validated");
});

test("a stopped scan forces incomplete coverage even after coverage checks finish", async () => {
  const first = roleFixture("ROLE-505", "Digital Degree Apprentice Software Engineer");
  let calls = 0;
  const verdict = await drained({
    ...inertDependencies,
    searchWeb: async () => [first.searchResult],
    renderPage: async (url) => url === first.url ? first.page : emptyPage(url),
    searchGovVacancies: async () => ({ total: 0, vacancies: [], pageText: "No results found." }),
    maxSteps: 2,
    generateText: fakeGenerate(async (call) => {
      calls++;
      if (calls === 1) {
        await call.tools.report_verdict.execute!({ status: "open", summary: "A Siemens role is open.", listings: [first.listing], evidence: [] }, {});
        step(call);
        return;
      }
      await call.tools.search_gov_vacancies.execute!({ searchTerm: "Siemens", levels: [6, 7], page: 1 }, {});
      step(call);
    }),
  });

  assert.equal(calls, 2);
  assert.equal(verdict.status, "open");
  assert.equal(verdict.coverage?.complete, false);
  assert.equal(verdict.coverage?.reason, "research stopped before final verification", "the underlying coverage checks completed before the model stopped without a final submission");
});

test("a late model failure retains verified open roles with incomplete coverage", async () => {
  const first = roleFixture("ROLE-303", "Digital Degree Apprentice Data Analyst");
  let calls = 0;
  const verdict = await drained({
    ...inertDependencies,
    searchWeb: async () => [first.searchResult],
    renderPage: async (url) => url === first.url ? first.page : emptyPage(url),
    maxSteps: 1,
    generateText: fakeGenerate(async (call) => {
      calls++;
      await call.tools.report_verdict.execute!({ status: "open", summary: "One verified role is open.", listings: [first.listing], evidence: [] }, {});
      step(call);
      throw new Error("late research failure");
    }),
  });

  assert.equal(calls, 1);
  assert.equal(verdict.status, "open");
  assert.deepEqual(verdict.listings.map(({ url }) => url), [first.url]);
  assert.equal(verdict.coverage?.complete, false);
  assert.ok(verdict.coverage?.reason?.includes("government vacancy check"));
  assert.equal(verdict.diagnostics?.complete, true, "diagnostics.complete denotes validated open status, not exhaustive coverage");
});

test("alternate ATS paths with the same job identifier merge into one listing", async () => {
  const first = roleFixture("ROLE-404", "Software Degree Apprentice");
  const alternateUrl = "https://jobs.siemens.com/en_US/externaljobs/jobs/ROLE-404?jobId=ROLE-404";
  let response: any;
  const verdict = await drained({
    ...inertDependencies,
    searchWeb: async () => [first.searchResult, { ...first.searchResult, url: alternateUrl }],
    renderPage: async (url) => url === first.url || url === alternateUrl
      ? { ...first.page, url, links: [{ text: "Apply", url: `https://jobs.siemens.com/en_US/externaljobs/ApplicationMethods?jobId=ROLE-404` }] }
      : emptyPage(url),
    searchGovVacancies: async () => ({ total: 0, vacancies: [], pageText: "No results found." }),
    maxSteps: 1,
    generateText: fakeGenerate(async (call) => {
      await call.tools.search_gov_vacancies.execute!({ searchTerm: "Siemens", levels: [6, 7], page: 1 }, {});
      response = await call.tools.report_verdict.execute!({ status: "open", summary: "A role is open.", listings: [first.listing, { ...first.listing, url: alternateUrl }], evidence: [] }, {});
      step(call);
    }),
  });

  assert.equal(response?.provisional, false);
  assert.equal(verdict.listings.length, 1);
});

test("Siemens folderId and alternate JobDetail path identify one vacancy", async () => {
  const first = roleFixture("ROLE-606", "Software Degree Apprentice");
  const folderUrl = "https://jobs.siemens.com/en_US/externaljobs/JobDetail?folderId=518834";
  const pathUrl = "https://jobs.siemens.com/en_US/externaljobs/JobDetail/518834";
  const alternate = { ...first.listing, url: pathUrl };
  const folderListing = { ...first.listing, url: folderUrl };
  const quote = first.quote;
  const folderPage = { ...first.page, url: folderUrl };
  const pathPage = { ...first.page, url: pathUrl };
  let response: any;
  const verdict = await drained({
    ...inertDependencies,
    searchWeb: async () => [
      { ...first.searchResult, url: folderUrl },
      { ...first.searchResult, url: pathUrl },
    ],
    renderPage: async (url) => url === folderUrl ? folderPage : url === pathUrl ? pathPage : emptyPage(url),
    searchGovVacancies: async () => ({ total: 0, vacancies: [], pageText: "No results found." }),
    maxSteps: 1,
    generateText: fakeGenerate(async (call) => {
      await call.tools.search_gov_vacancies.execute!({ searchTerm: "Siemens", levels: [6, 7], page: 1 }, {});
      response = await call.tools.report_verdict.execute!({ status: "open", summary: "A role is open.", listings: [folderListing, alternate], evidence: [] }, {});
      step(call);
    }),
  });

  assert.equal(quote, first.quote);
  assert.equal(response?.provisional, false);
  assert.equal(verdict.listings.length, 1);
});

test("pagination feedback names exact pages and a full page five stays incomplete", async () => {
  const role = roleFixture("ROLE-707", "Data Degree Apprentice");
  const query = "Siemens technology degree apprenticeship pagination audit";
  const filler: SearchResult[] = Array.from({ length: 10 }, (_, index) => ({
    title: `Result ${index + 1}`,
    url: `https://example.test/results/${index + 1}`,
    snippet: "General result.",
  }));
  let pageOneResult: any;
  let cappedResult: any;
  const verdict = await drained({
    ...inertDependencies,
    searchWeb: async (requestedQuery) => requestedQuery === query ? filler : [role.searchResult],
    renderPage: async (url) => url === role.url ? role.page : emptyPage(url),
    searchGovVacancies: async () => ({ total: 0, vacancies: [], pageText: "No results found." }),
    maxSteps: 1,
    generateText: fakeGenerate(async (call) => {
      await call.tools.search_web.execute!({ query, page: 1 }, {});
      await call.tools.search_gov_vacancies.execute!({ searchTerm: "Siemens", levels: [6, 7], page: 1 }, {});
      pageOneResult = await call.tools.report_verdict.execute!({ status: "open", summary: "A Siemens role is open.", listings: [role.listing], evidence: [] }, {});
      for (let page = 2; page <= 5; page++) await call.tools.search_web.execute!({ query, page }, {});
      cappedResult = await call.tools.report_verdict.execute!({ status: "open", summary: "A Siemens role is open.", listings: [role.listing], evidence: [] }, {});
      step(call);
    }),
  });

  assert.equal(pageOneResult?.provisional, true);
  assert.deepEqual(pageOneResult?.coverage?.pendingWebPages, [{ query, page: 2 }]);
  assert.ok(pageOneResult?.advice?.includes(`query="${query}", page=2`));
  assert.equal(cappedResult?.provisional, true);
  assert.equal(verdict.coverage?.complete, false);
  assert.ok(verdict.coverage?.limitations?.some((item) => item.includes(query) && item.includes("page 5")));
  assert.ok(cappedResult?.advice?.includes("page cap"));
  assert.equal(cappedResult?.coverage?.pendingWebPages?.length ?? 0, 0, "page five is capped, so its limitation is explicit rather than an invented page six request");
});
