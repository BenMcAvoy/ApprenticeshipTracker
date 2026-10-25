import assert from "node:assert/strict";
import test from "node:test";
import { bingSearchUrl, googleSearchUrl, yahooSearchUrl, isRelevantApprenticeshipResult } from "../src/browser.ts";

test("Yahoo fallback preserves queries and bounded page offsets", () => {
  const query = "Siemens digital degree apprentice Chippenham";
  const url = new URL(yahooSearchUrl(query, 3));
  assert.equal(url.searchParams.get("p"), query);
  assert.equal(url.searchParams.get("b"), "21");
  assert.equal(new URL(yahooSearchUrl(query)).searchParams.get("b"), null);
  for (const page of [0, -1, 1.5, 6, Number.NaN]) assert.throws(() => yahooSearchUrl(query, page), RangeError);
});

test("Bing search pages preserve the query and advance by ten results", () => {
  const first = new URL(bingSearchUrl("Siemens digital degree apprentice"));
  assert.equal(first.searchParams.get("q"), "Siemens digital degree apprentice");
  assert.equal(first.searchParams.get("first"), null);
  assert.equal(first.searchParams.get("setlang"), "en-GB");

  const next = new URL(bingSearchUrl("Siemens digital degree apprentice", 2));
  assert.equal(next.searchParams.get("q"), first.searchParams.get("q"));
  assert.equal(next.searchParams.get("first"), "11");

  const last = new URL(bingSearchUrl("apprentice", 5));
  assert.equal(last.searchParams.get("first"), "41");
});

test("Bing search pagination rejects pages outside the bounded range", () => {
  for (const page of [0, -1, 1.5, 6, Number.NaN]) {
    assert.throws(() => bingSearchUrl("apprentice", page), RangeError);
  }
});

test("Google fallback preserves the search query and uses matching bounded pagination", () => {
  const query = "Siemens digital degree apprentice Chippenham";
  const first = new URL(googleSearchUrl(query));
  assert.equal(first.searchParams.get("q"), query);
  assert.equal(first.searchParams.get("start"), null);

  const next = new URL(googleSearchUrl(query, 3));
  assert.equal(next.searchParams.get("q"), query);
  assert.equal(next.searchParams.get("start"), "20");
  assert.throws(() => googleSearchUrl(query, 6), RangeError);
});

test("apprenticeship relevance rejects employer homepages and keeps specific programme hits", () => {
  const query = "Siemens digital degree apprentice Chippenham";
  assert.equal(isRelevantApprenticeshipResult(query, {
    title: "Siemens | Home appliances and technology",
    url: "https://www.siemens.com/",
    snippet: "Discover Siemens products, services, and innovations.",
  }), false);
  assert.equal(isRelevantApprenticeshipResult(query, {
    title: "Digital Degree Apprentice 2025 at Siemens",
    url: "https://www.gradcracker.com/hub/siemens/graduate-job/518834/digital-degree-apprentice",
    snippet: "Join Siemens as a Digital Degree Apprentice in Chippenham.",
  }), true);
  assert.equal(isRelevantApprenticeshipResult("software engineering roles", {
    title: "Software engineer roles",
    url: "https://example.com/jobs",
    snippet: "Find software engineering roles.",
  }), true);
});
