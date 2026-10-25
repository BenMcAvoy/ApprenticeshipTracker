import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ScanEvidence, type ReadPage, type ScanVerdict } from "../src/scan-evidence.ts";

const fixture = JSON.parse(await readFile(new URL("./fixtures/scan-benchmark-shapes.json", import.meta.url), "utf8")) as {
  notice: string;
  shapes: { id: string; employer: string; url: string; shape: string }[];
};
assert.match(fixture.notice, /synthetic representative examples/);
assert.ok(fixture.shapes.length >= 12);
const shapes = new Map(fixture.shapes.map((shape) => [shape.id, shape]));

const page = (url: string, text: string, title = "Careers", status = 200, links: ReadPage["links"] = []): ReadPage => ({ url, text, title, status, links });
const negative = (status: "none_found" | "closed" | "upcoming" | "blocked", evidence: ScanVerdict["evidence"] = []): ScanVerdict => ({ status, summary: "Synthetic benchmark result.", listings: [], evidence });
function emptySearch(e: ScanEvidence, url: string) {
  e.recordSearch("Siemens software degree apprenticeship", []);
  e.recordSearch("Siemens technology apprenticeship vacancies", []);
  const quote = "No matching vacancies found.";
  e.recordPage(url, page(url, quote, "Siemens job search"));
  return quote;
}

test("fixture covers diverse synthetic employer and platform shapes", () => {
  assert.ok(fixture.shapes.length >= 12);
  assert.deepEqual([...shapes.keys()], ["official-brand", "workday", "oracle", "smartrecruiters", "greenhouse", "legal-entity", "closed", "upcoming", "expired", "talent-pool", "blocked", "conflict-live", "arbitrary-ats", "unknown-alias"]);
});

test("accepts a live individual role on a branded employer domain", () => {
  const { url } = shapes.get("official-brand")!;
  const title = "Software Engineering Degree Apprentice";
  const quote = "Apply now for this role.";
  const e = new ScanEvidence("Siemens");
  e.recordPage(url, page(url, `${title}. Siemens. Level 6 technology apprenticeship. ${quote}`, title));
  assert.deepEqual(e.validate({ status: "open", summary: "Open", listings: [{ title, url, quote }], evidence: [] }), []);
});

test("rejects an impossible closing date instead of treating normalized date as future evidence", () => {
  const url = "https://jobs.siemens.com/jobs/invalid-date";
  const title = "Software Degree Apprentice";
  const quote = "Closing date: 2026-10-32";
  const e = new ScanEvidence("Siemens", new Date("2026-10-25T12:00:00Z"));
  e.recordPage(url, page(url, `${title}. Level 6 technology apprenticeship. ${quote}`, title));
  const problems = e.validate({ status: "open", summary: "Open", listings: [{ title, url, quote }], evidence: [] });
  assert.match(problems.join("\n"), /lacks a scoped Apply link or an active future deadline/);
});

for (const id of ["workday", "oracle", "smartrecruiters", "greenhouse"]) {
  test(`accepts exact employer-linked ${id} vacancy route`, () => {
    const { employer, url } = shapes.get(id)!;
    const official = `https://careers.${employer.toLowerCase().replaceAll(" ", "")}.example/early-careers`;
    const title = "Software Degree Apprentice";
    const quote = "Apply now for this role.";
    const e = new ScanEvidence(employer);
    e.recordPage(official, page(official, `${employer} early careers`, `${employer} careers`, 200, [{ text: title, url }]));
    e.recordPage(url, page(url, `${title}. Employer: ${employer}. Level 6 technology apprenticeship. ${quote}`, title));
    const problems = e.validate({ status: "open", summary: "Open", listings: [{ title, url, quote }], evidence: [] });
    assert.deepEqual(problems, []);
  });
}

test("accepts official role content naming an alternate legal entity", () => {
  const { url } = shapes.get("legal-entity")!;
  const title = "Digital Degree Apprentice";
  const quote = "Apply now for this role.";
  const e = new ScanEvidence("Siemens");
  e.recordPage(url, page(url, `${title}. Siemens Mobility Limited. Level 6 digital technology apprenticeship. ${quote}`, title));
  assert.deepEqual(e.validate({ status: "open", summary: "Open", listings: [{ title, url, quote }], evidence: [] }), []);
});

test("accepts explicit closed and dated upcoming programme evidence", () => {
  const { url } = shapes.get("closed")!;
  const quote = "Applications are now closed for our software technology degree apprenticeship.";
  const e = new ScanEvidence("Siemens");
  e.recordPage(url, page(url, `Software technology degree apprenticeship. ${quote}`, "Software Degree Apprenticeship"));
  assert.deepEqual(e.validate(negative("closed", [{ url, quote }])), []);

  const upcomingUrl = shapes.get("upcoming")!.url;
  const upcomingQuote = "Applications open in September 2027 for the technology degree apprenticeship.";
  const u = new ScanEvidence("Siemens");
  u.recordPage(upcomingUrl, page(upcomingUrl, `Software technology degree apprenticeship. ${upcomingQuote}`, "Software Degree Apprenticeship"));
  assert.deepEqual(u.validate(negative("upcoming", [{ url: upcomingUrl, quote: upcomingQuote }])), []);
});

test("expired applicant role can be resolved while a scoped empty search supports none_found", () => {
  const { url } = shapes.get("expired")!;
  const title = "Software Degree Apprentice";
  const e = new ScanEvidence("Siemens", new Date("2026-10-25T12:00:00Z"));
  e.recordSearch("Siemens software degree apprenticeship", [{ title, url, snippet: "Level 6 technology apprenticeship" }]);
  e.recordPage(url, page(url, `${title}. Closing date: 31 August 2026.`, title));
  const emptyUrl = "https://jobs.siemens.com/search?q=apprenticeship";
  const quote = emptySearch(e, emptyUrl);
  assert.deepEqual(e.validate(negative("none_found", [{ url: emptyUrl, quote }])), []);
});

test("rejects talent pool as an open vacancy", () => {
  const { url } = shapes.get("talent-pool")!;
  const title = "Software Degree Apprentice";
  const e = new ScanEvidence("Siemens");
  e.recordPage(url, page(url, `${title}. Level 6 technology apprenticeship talent pool. Register your interest. Apply now.`, title));
  assert.match(e.validate({ status: "open", summary: "Open", listings: [{ title, url, quote: `${title}.` }], evidence: [] }).join("\n"), /talent pool or register-interest/);
});

test("blocked page is represented as blocked, not as evidence of no vacancies", () => {
  const { url } = shapes.get("blocked")!;
  const e = new ScanEvidence("Siemens");
  e.recordPage(url, page(url, "Access denied. Please try later.", "Careers", 403));
  assert.deepEqual(e.validate(negative("blocked")), []);
  assert.ok(e.validate(negative("none_found")).some((problem) => /no-results evidence/.test(problem)));
});

test("a live role defeats conflicting empty-search evidence", () => {
  const { url } = shapes.get("conflict-live")!;
  const title = "Software Degree Apprentice";
  const e = new ScanEvidence("Siemens");
  e.recordPage(url, page(url, `${title}. Level 6 technology apprenticeship. Apply now.`, title));
  const emptyUrl = "https://jobs.siemens.com/search?q=apprenticeship";
  const quote = emptySearch(e, emptyUrl);
  assert.ok(e.validate(negative("none_found", [{ url: emptyUrl, quote }])).some((problem) => /still advertise a potentially live/.test(problem)));
});

test("unlinked ATS and unverified alias domains do not get employer authority", () => {
  const title = "Software Degree Apprentice";
  const quote = "Apply now for this role.";
  const arbitrary = shapes.get("arbitrary-ats")!.url;
  const a = new ScanEvidence("Siemens");
  a.recordPage(arbitrary, page(arbitrary, `Siemens. ${title}. Level 6 technology apprenticeship. ${quote}`, title));
  assert.match(a.validate({ status: "open", summary: "Open", listings: [{ title, url: arbitrary, quote }], evidence: [] }).join("\n"), /not on the requested company's official domain/);

  const unknown = shapes.get("unknown-alias")!.url;
  const u = new ScanEvidence("Northstar Energy");
  u.recordPage(unknown, page(unknown, `Northstar Energy. ${title}. Level 6 technology apprenticeship. ${quote}`, title));
  assert.match(u.validate({ status: "open", summary: "Open", listings: [{ title, url: unknown, quote }], evidence: [] }).join("\n"), /not on the requested company's official domain/);
});
