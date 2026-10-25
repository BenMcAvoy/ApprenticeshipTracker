import assert from "node:assert/strict";
import test from "node:test";
import { ScanEvidence } from "../src/scan-evidence.ts";

const company = "Siemens";
const emptyVerdict = (status: "none_found" | "closed" | "upcoming" | "blocked") => ({ status, summary: "Checked the company sources.", listings: [], evidence: [] });
const page = (url: string, text: string, title = "Careers", status = 200, links: { text: string; url: string }[] = []) => ({ url, text, title, status, links });
const scopedQueries = (e: ScanEvidence) => {
  e.recordSearch("Siemens software degree apprenticeship", []);
  e.recordSearch("Siemens technology apprenticeship vacancies", []);
};

test("reading a discovery hub resolves the hub but leaves its individual role pending", () => {
  const e = new ScanEvidence(company);
  const hub = "https://sprout.careers/apprenticeships/siemens";
  const role = "https://sprout.careers/jobs/software-degree-apprentice";
  e.recordSearch("Siemens software degree apprenticeship", [{ title: "Siemens software degree apprenticeships", url: hub, snippet: "Digital degree apprenticeships" }]);
  e.recordPage(hub, page(hub, "Siemens software degree apprenticeship roles", "Siemens apprenticeships", 200, [{ text: "Software degree apprentice", url: role }]));
  assert.deepEqual(e.snapshot().pendingCandidates.map(({ url }) => url), [role]);
  e.recordPage(role, page(role, "Software degree apprentice. Siemens. Apply now.", "Software degree apprentice"));
  assert.deepEqual(e.snapshot().pendingCandidates.map(({ url }) => url), [role]);
});

test("a job search page cannot stand in for an individual open vacancy", () => {
  const e = new ScanEvidence(company);
  const url = "https://jobs.siemens.com/en_US/externaljobs/SearchJobs?query=apprenticeship";
  const title = "Software Degree Apprentice";
  e.recordPage(url, page(url, `${title}. Level 6. Apply now.`, "Siemens search"));
  assert.match(e.validate({ status: "open", summary: "Open", listings: [{ title, url, quote: "Apply now." }], evidence: [] }).join("\n"), /individual apprenticeship vacancy/);
});

test("an empty rendered shell does not resolve a promising vacancy", () => {
  const e = new ScanEvidence(company);
  const url = "https://jobs.siemens.com/job/987";
  e.recordSearch("Siemens software degree apprenticeship", [{ title: "Software Degree Apprentice", url, snippet: "Level 6 digital" }]);
  e.recordPage(url, page(url, "", "Siemens jobs"));
  assert.equal(e.snapshot().pendingCandidates.length, 1);
});

test("a generic external jobs hub cannot establish employer authority", () => {
  const e = new ScanEvidence(company);
  const official = "https://careers.siemens.com/early-careers";
  const hub = "https://aggregator.example/jobs";
  const title = "Software Degree Apprentice";
  e.recordPage(official, page(official, "Siemens careers", "Siemens", 200, [{ text: "Find jobs", url: hub }]));
  e.recordPage(hub, page(hub, `${title}. Employer: Other Company. Level 6. Apply now.`, title));
  assert.match(e.validate({ status: "open", summary: "Open", listings: [{ title, url: hub, quote: "Apply now." }], evidence: [] }).join("\n"), /not on the requested company's official domain/);
});

test("an employer-linked ATS listing must identify the requested employer", () => {
  const e = new ScanEvidence(company);
  const official = "https://careers.siemens.com/early-careers";
  const url = "https://boards.greenhouse.io/siemens/jobs/98765";
  const title = "Software Degree Apprentice";
  e.recordPage(official, page(official, "Siemens careers", "Siemens", 200, [{ text: title, url }]));
  e.recordPage(url, page(url, `${title}. Employer: Other Company. Level 6 technology apprenticeship. Apply now.`, title));
  assert.match(e.validate({ status: "open", summary: "Open", listings: [{ title, url, quote: "Apply now." }], evidence: [] }).join("\n"), /not on the requested company's official domain/);
});

test("graduate status on a mixed careers page cannot establish apprenticeship status", () => {
  for (const [status, quote] of [
    ["closed", "Graduate applications are currently closed."],
    ["upcoming", "Graduate applications open in January 2027."],
  ] as const) {
    const e = new ScanEvidence(company);
    const url = "https://careers.siemens.com/early-careers";
    e.recordPage(url, page(url, `Our software degree apprenticeship programme. ${quote}`, "Siemens Early Careers"));
    assert.ok(e.validate({ ...emptyVerdict(status), evidence: [{ url, quote }] }).some((problem) => problem.startsWith(`${status} requires`)));
  }
});

test("a read third-party live candidate blocks absence until its employer route is checked", () => {
  const e = new ScanEvidence(company);
  scopedQueries(e);
  const url = "https://www.gradcracker.com/hub/57/siemens/jobs/digital-degree-apprentice";
  const employer = "https://jobs.siemens.com/job/987";
  const title = "Siemens Digital Degree Apprentice";
  e.recordSearch("Siemens digital degree apprenticeship", [{ title, url, snippet: "Level 6. Apply now." }]);
  const homepage = "https://www.siemens.com/";
  e.recordPage(url, page(url, `${title}. Level 6. Apply now.`, title, 200, [{ text: "Apply", url: employer }, { text: "Employer homepage", url: homepage }]));
  e.recordPage(homepage, page(homepage, "Siemens products and services.", "Siemens"));
  const emptyUrl = "https://jobs.siemens.com/search?q=apprenticeship";
  const quote = "No matching vacancies found.";
  e.recordPage(emptyUrl, page(emptyUrl, quote, "Siemens job search"));
  const verdict = { ...emptyVerdict("none_found"), evidence: [{ url: emptyUrl, quote }] };
  assert.match(e.validate(verdict).join("\n"), /candidates remain unread or blocked/);
  e.recordPage(employer, page(employer, "This vacancy is closed. Applications are closed.", title));
  assert.deepEqual(e.snapshot().pendingCandidates, []);
  assert.deepEqual(e.validate(verdict), []);
});

test("a read live official role still prevents a negative verdict", () => {
  const e = new ScanEvidence(company);
  scopedQueries(e);
  const url = "https://jobs.siemens.com/job/987";
  const title = "Software Degree Apprentice";
  e.recordPage(url, page(url, `${title}. Level 6. Apply now.`, title));
  const emptyUrl = "https://jobs.siemens.com/search?q=apprenticeship";
  const quote = "No matching vacancies found.";
  e.recordPage(emptyUrl, page(emptyUrl, quote, "Siemens job search"));
  assert.ok(e.validate({ ...emptyVerdict("none_found"), evidence: [{ url: emptyUrl, quote }] }).length > 0);
});

test("a company-named aggregator cannot grant authority to another arbitrary vacancy site", () => {
  const e = new ScanEvidence(company);
  const hub = "https://aggregator.example/companies/siemens";
  const role = "https://jobs.example/jobs/digital-degree-apprentice";
  const title = "Digital Degree Apprentice";
  e.recordPage(hub, page(hub, "Siemens apprenticeship links", "Siemens", 200, [{ text: title, url: role }]));
  e.recordPage(role, page(role, `${title}. Siemens. Level 6 software apprenticeship. Apply now.`, title));
  assert.match(e.validate({ status: "open", summary: "Open", listings: [{ title, url: role, quote: "Apply now." }], evidence: [] }).join("\n"), /not on the requested company's official domain/);
});

test("a generic 1-6 of 999+ count cannot prove none_found", () => {
  const e = new ScanEvidence(company);
  scopedQueries(e);
  const url = "https://jobs.siemens.com/search?query=degree+apprenticeship&employer=Siemens";
  e.recordPage(url, page(url, "1-6 of 999+ results", "Siemens job search"));
  assert.match(e.validate(emptyVerdict("none_found")).join("\n"), /no-results evidence/);
});

test("an unread candidate blocks a negative verdict even after other pages were checked", () => {
  const e = new ScanEvidence(company);
  scopedQueries(e);
  e.recordSearch("Siemens careers", [{ title: "Software Degree Apprentice", url: "https://jobs.siemens.com/job/123", snippet: "Technology degree apprenticeship" }]);
  for (let i = 0; i < 6; i++) {
    const url = `https://careers.siemens.com/page/${i}`;
    e.recordPage(url, page(url, "Siemens early careers information."));
  }
  assert.match(e.validate(emptyVerdict("none_found")).join("\n"), /candidates remain unread or blocked/);
});

test("a quote found on another page or in search snippets cannot verify the cited URL", () => {
  const e = new ScanEvidence(company);
  e.recordSearch("Siemens tech apprenticeship", [{ title: "Result", url: "https://example.com/one", snippet: "Applications are currently closed for the technology degree apprenticeship." }]);
  e.recordPage("https://example.com/source", page("https://example.com/source", "Applications are currently closed for the technology degree apprenticeship."));
  const verdict = { ...emptyVerdict("closed"), evidence: [{ url: "https://example.com/one", quote: "Applications are currently closed for the technology degree apprenticeship." }] };
  assert.match(e.validate(verdict).join("\n"), /not been successfully read/);
});

test("a filtered zero-results apprenticeship search can support none_found", () => {
  const e = new ScanEvidence(company);
  scopedQueries(e);
  const url = "https://jobs.siemens.com/search?query=technology+degree+apprenticeship&employer=Siemens";
  const quote = "No matching jobs found.";
  e.recordPage(url, page(url, `Siemens job search. ${quote}`, "Siemens apprenticeship job search"));
  const result = e.validate({ ...emptyVerdict("none_found"), evidence: [{ url, quote }] });
  assert.deepEqual(result, []);
});

test("a generic apprenticeship page with no results is not a scoped company job search", () => {
  const e = new ScanEvidence(company);
  scopedQueries(e);
  const url = "https://careers.siemens.com/early-careers/apprenticeships";
  const quote = "No matching vacancies found.";
  e.recordPage(url, page(url, `Siemens apprenticeship information. ${quote}`, "Siemens Apprenticeships"));
  assert.match(e.validate({ ...emptyVerdict("none_found"), evidence: [{ url, quote }] }).join("\n"), /official company job-board or exact employer-linked ATS/);
});

test("an arbitrary third-party zero-results URL cannot prove company absence from query parameters", () => {
  const e = new ScanEvidence(company);
  scopedQueries(e);
  const url = "https://jobs.example/search?company=Siemens&query=apprenticeship";
  const quote = "No matching jobs found.";
  e.recordPage(url, page(url, quote, "Job search"));
  const problems = e.validate({ ...emptyVerdict("none_found"), evidence: [{ url, quote }] });
  assert.match(problems.join("\n"), /official company job-board or exact employer-linked ATS/);
});

test("an official company job-board apprenticeship query needs no redundant company filter", () => {
  const e = new ScanEvidence(company);
  scopedQueries(e);
  const url = "https://jobs.siemens.com/search?q=apprenticeship";
  const quote = "No matching vacancies found.";
  e.recordPage(url, page(url, quote, "Siemens job search"));
  assert.deepEqual(e.validate({ ...emptyVerdict("none_found"), evidence: [{ url, quote }] }), []);
});

test("an unrelated employer's apprenticeship result with a Siemens sidebar does not become a pending candidate", () => {
  const e = new ScanEvidence(company);
  scopedQueries(e);
  e.recordSearch("apprenticeship jobs", [{
    title: "Digital Degree Apprentice - BT",
    url: "https://www.gradcracker.com/hub/22/bt/digital-degree-apprentice",
    snippet: "BT vacancy. Related employer: Siemens.",
  }]);
  const url = "https://jobs.siemens.com/search?q=apprenticeship";
  const quote = "No matching vacancies found.";
  e.recordPage(url, page(url, quote, "Siemens job search"));
  assert.deepEqual(e.validate({ ...emptyVerdict("none_found"), evidence: [{ url, quote }] }), []);
});

test("an individually read active technology degree apprenticeship is accepted", () => {
  const e = new ScanEvidence(company);
  const url = "https://jobs.siemens.com/job/48291?source=careers";
  const title = "Software Engineering Degree Apprentice";
  const quote = "Apply now for this Software Engineering Degree Apprentice role.";
  e.recordPage(url, page(url, `The ${title} is a Level 6 technology apprenticeship in software engineering. ${quote}`, title));
  const result = e.validate({ status: "open", summary: "Applications are open.", listings: [{ title, url, quote }], evidence: [] });
  assert.deepEqual(result, []);
});

test("a third-party role page with Siemens in a sidebar is not trusted as Siemens employer evidence", () => {
  const e = new ScanEvidence("Siemens");
  const url = "https://careers.example.com/jobs/48291";
  const title = "Software Engineering Degree Apprentice";
  const quote = "Apply now for this Software Engineering Degree Apprentice role.";
  e.recordPage(url, page(url, `The ${title} is a Level 6 technology apprenticeship in software engineering. ${quote} Sidebar: Siemens roles.`, title));
  const problems = e.validate({ status: "open", summary: "Applications are open.", listings: [{ title, url, quote }], evidence: [] });
  assert.match(problems.join("\n"), /not on the requested company's official domain or an exact employer-linked ATS route/);
});

test("an exact vacancy route linked from the official company page can verify an ATS role", () => {
  const e = new ScanEvidence("Siemens");
  const companyPage = "https://careers.siemens.com/early-careers";
  const atsJob = "https://boards.greenhouse.io/siemens/jobs/98765";
  const title = "Software Engineering Degree Apprentice";
  e.recordPage(companyPage, page(companyPage, "Siemens early careers.", "Siemens Early Careers", 200, [{ text: title, url: atsJob }]));
  e.recordPage(atsJob, page(atsJob, `${title}. Employer: Siemens. Level 6 technology apprenticeship. Apply now.`, title));
  assert.deepEqual(e.validate({ status: "open", summary: "Open.", listings: [{ title, url: atsJob, quote: "Apply now." }], evidence: [] }), []);
});

test("a Siemens-looking subdomain under an unrelated registrable domain is not official", () => {
  const e = new ScanEvidence("Siemens");
  const url = "https://siemens.example.com/jobs/123";
  const title = "Software Engineering Degree Apprentice";
  e.recordPage(url, page(url, `Siemens. ${title}. Level 6 technology apprenticeship. Apply now.`, title));
  assert.match(e.validate({ status: "open", summary: "Open.", listings: [{ title, url, quote: "Apply now." }], evidence: [] }).join("\n"), /not on the requested company's official domain/);
});

test("Siemens Digital Degree Apprentice detail with a folder-scoped Apply link and future deadline is accepted", () => {
  const e = new ScanEvidence("Siemens", new Date("2026-10-25T12:00:00Z"));
  const url = "https://jobs.siemens.com/en_US/externaljobs/JobDetail?folderId=518834";
  const applyUrl = "https://jobs.siemens.com/en_US/externaljobs/ApplicationMethods?folderId=518834";
  const title = "Digital Degree Apprentice - (Level 6)";
  const quote = "Closing date: 31 December 2026";
  e.recordPage(url, page(url,
    `Digital Degree Apprentice - (Level 6). Siemens Mobility Limited. UK Chippenham. ${quote}.`,
    title, 200, [{ text: "Apply", url: applyUrl }]));
  const result = e.validate({ status: "open", summary: "Applications are open.", listings: [{ title, url, quote }], evidence: [] });
  assert.deepEqual(result, []);
});

test("closed or expired individual vacancies are rejected even if an Apply link remains", () => {
  const now = new Date("2026-10-25T12:00:00Z");
  for (const [text, expected] of [
    ["Applications are now closed. Closing date: 31 December 2026.", /explicitly says this role or its applications are closed/],
    ["Closing date: 31 August 2026.", /deadline has passed/],
  ] as const) {
    const e = new ScanEvidence("Siemens", now);
    const url = "https://jobs.siemens.com/en_US/externaljobs/JobDetail?folderId=518834";
    const applyUrl = "https://jobs.siemens.com/en_US/externaljobs/ApplicationMethods?folderId=518834";
    const title = "Digital Degree Apprentice - (Level 6)";
    const quote = "Digital Degree Apprentice - (Level 6)";
    e.recordPage(url, page(url, `${title}. Siemens Mobility Limited. ${text}`, title, 200, [{ text: "Apply", url: applyUrl }]));
    const problems = e.validate({ status: "open", summary: "Applications are open.", listings: [{ title, url, quote }], evidence: [] });
    assert.match(problems.join("\n"), expected);
  }
});

test("a generic programme Apply footer and a talent pool are not open role evidence", () => {
  const program = new ScanEvidence("Siemens");
  const programUrl = "https://careers.siemens.com/early-careers/technology-degree-apprenticeships";
  const programTitle = "Technology Degree Apprenticeship";
  program.recordPage(programUrl, page(programUrl, `Siemens technology degree apprenticeship programme. Apply here to register interest.`, programTitle, 200,
    [{ text: "Apply", url: "https://careers.siemens.com/application" }]));
  assert.match(program.validate({ status: "open", summary: "Open.", listings: [{ title: programTitle, url: programUrl, quote: "Siemens technology degree apprenticeship programme." }], evidence: [] }).join("\n"), /individual apprenticeship vacancy/);

  const pool = new ScanEvidence("Siemens");
  const poolUrl = "https://jobs.siemens.com/en_US/externaljobs/JobDetail?folderId=518834";
  pool.recordPage(poolUrl, page(poolUrl, "Digital Degree Apprentice. Siemens technology talent pool. Apply now to join our register of interest.", "Digital Degree Apprentice - Talent Pool", 200,
    [{ text: "Apply", url: "https://jobs.siemens.com/en_US/externaljobs/ApplicationMethods?folderId=518834" }]));
  assert.match(pool.validate({ status: "open", summary: "Open.", listings: [{ title: "Digital Degree Apprentice", url: poolUrl, quote: "Digital Degree Apprentice." }], evidence: [] }).join("\n"), /talent pool or register-interest page/);
});

test("engineering alone is not enough to establish a tech apprenticeship", () => {
  const e = new ScanEvidence("Siemens");
  const url = "https://jobs.siemens.com/en_US/externaljobs/JobDetail?folderId=77";
  const title = "Mechanical Engineering Degree Apprentice";
  e.recordPage(url, page(url, `${title}. Siemens. Apply now.`, title, 200,
    [{ text: "Apply", url: "https://jobs.siemens.com/en_US/externaljobs/ApplicationMethods?folderId=77" }]));
  assert.match(e.validate({ status: "open", summary: "Open.", listings: [{ title, url, quote: title }], evidence: [] }).join("\n"), /not evidenced as a technology/);
});

test("a closing date or deadline does not establish that applications are closed", () => {
  const e = new ScanEvidence(company);
  const url = "https://careers.siemens.com/apprenticeships/software-degree";
  const quote = "The closing date for this technology degree apprenticeship is 31 October 2026.";
  e.recordPage(url, page(url, `Software technology degree apprenticeship. ${quote}`, "Software Degree Apprenticeship"));
  const problems = e.validate({ ...emptyVerdict("closed"), evidence: [{ url, quote }] });
  assert.match(problems.join("\n"), /applications are closed or the scheme is full/);
});

test("register-interest text does not establish open apprenticeship applications", () => {
  const e = new ScanEvidence(company);
  const url = "https://careers.siemens.com/early-careers";
  const title = "Siemens Early Careers";
  const quote = "Register your interest today.";
  e.recordPage(url, page(url, `Technology degree apprenticeship opportunities. ${quote} We will contact you about future programmes.`, title));
  const problems = e.validate({ status: "open", summary: "Open.", listings: [{ title: "Technology Degree Apprenticeship", url, quote }], evidence: [] });
  assert.match(problems.join("\n"), /individual apprenticeship vacancy|title is not present|lacks a scoped Apply link/);
});

test("requested and redirect URLs bind to the same page while retaining job filters", () => {
  const e = new ScanEvidence(company);
  const requested = "https://jobs.siemens.com/search?jobId=42&level=6&utm_source=mail#results";
  const finalUrl = "https://careers.siemens.com/search?level=6&jobId=42";
  e.recordPage(requested, page(finalUrl, "This page contains a sufficient source-bound phrase."));
  const result = e.validate({ ...emptyVerdict("upcoming"), evidence: [{ url: requested.replace("#results", ""), quote: "This page contains a sufficient source-bound phrase." }] });
  assert.ok(!result.some((p) => /not been successfully read/.test(p)));
});

test("source and src are stripped as tracking while job identifiers and filters remain", () => {
  const e = new ScanEvidence(company);
  const requested = "https://jobs.siemens.com/en_US/externaljobs/JobDetail?folderId=518834&source=Gradcracker&level=6";
  const finalUrl = "https://jobs.siemens.com/en_US/externaljobs/JobDetail?folderId=518834&level=6&src=mail";
  const quote = "The Digital Degree Apprentice role is open.";
  e.recordPage(requested, page(finalUrl, quote, "Digital Degree Apprentice - Level 6"));
  const result = e.validate({ ...emptyVerdict("upcoming"), evidence: [{ url: "https://jobs.siemens.com/en_US/externaljobs/JobDetail?level=6&folderId=518834", quote }] });
  assert.ok(!result.some((problem) => /not been successfully read/.test(problem)));
});
