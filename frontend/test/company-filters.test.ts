import assert from "node:assert/strict";
import { test } from "node:test";
import { listingKey } from "backend/listing-key";
import type { CompanyRow } from "../src/components/company-card.tsx";
import { applyAppliedVisibility, applyFilters, DEFAULT_FILTERS, filtersFromSearch, listingsOf, nextClosing, searchFromFilters } from "../src/lib/company-filters.ts";
import { buildExport } from "../src/lib/export-list.ts";

const hidden = { title: "Software apprentice", url: "https://careers.example/jobs/1", location: "London", closes: "2026-10-27" };
const fresh = { title: "Data apprentice", url: "https://careers.example/jobs/2", location: "Bristol", closes: "2026-12-01" };
const company = (id: number, listings = [hidden, fresh]): CompanyRow => ({
  id, name: `Company ${id}`, status: "open", careersUrl: "https://careers.example", summary: null,
  listings: JSON.stringify(listings), evidence: "[]", checked: 1, lastScannedAt: "2026-10-25T09:00:00Z",
});
const mark = (companyId: number, listing = hidden) => ({ companyId, listingKey: listingKey(listing), listingTitle: listing.title, listingUrl: listing.url });

test("marks hide an individual listing without hiding other roles or another company's roles", () => {
  const source = [company(1), company(2)];
  const view = applyAppliedVisibility(source, [mark(1)], false);
  assert.deepEqual(listingsOf(view[0]), [fresh]);
  assert.deepEqual(listingsOf(view[1]), [hidden, fresh]);
  assert.deepEqual(listingsOf(source[0]), [hidden, fresh], "shared catalogue stays intact");
});

test("a fully applied company disappears and a new listing at that company makes it reappear", () => {
  const marks = [mark(1), mark(1, fresh)];
  assert.deepEqual(applyAppliedVisibility([company(1)], marks, false), []);
  const newListing = { ...fresh, title: "Cyber security apprentice", url: "https://careers.example/jobs/3" };
  const view = applyAppliedVisibility([company(1, [hidden, fresh, newListing])], marks, false);
  assert.deepEqual(listingsOf(view[0]), [newListing]);
});

test("Applied view contains only marked roles; undo returns a current role to Opportunities", () => {
  const source = [company(1), company(2)];
  const marked = [mark(1), mark(2, fresh)];
  const view = applyAppliedVisibility(source, marked, true);
  assert.deepEqual(view.map((c) => [c.id, listingsOf(c)]), [[1, [hidden]], [2, [fresh]]]);
  const afterUndo = applyAppliedVisibility(source, [mark(2, fresh)], true);
  assert.deepEqual(afterUndo.map((c) => [c.id, listingsOf(c)]), [[2, [fresh]]]);
  assert.deepEqual(listingsOf(applyAppliedVisibility(source, [mark(1)], false)[0]), [fresh]);
});

test("empty Applied view contains no unmarked roles or companies", () => {
  assert.deepEqual(applyAppliedVisibility([company(1), company(2, [])], [], true), []);
});

test("companies without listings and without personal applied history remain browsable", () => {
  const source = [company(1, [])];
  assert.deepEqual(applyAppliedVisibility(source, [], false), source);
});

test("removed applied roles use their saved snapshot in Applied and do not leak into Opportunities", () => {
  const source = [company(1, [])];
  assert.deepEqual(applyAppliedVisibility(source, [mark(1)], false), []);
  const applied = applyAppliedVisibility(source, [mark(1)], true);
  assert.equal(applied.length, 1);
  assert.deepEqual(listingsOf(applied[0]), [{ title: hidden.title, url: hidden.url }]);
  assert.deepEqual(applyAppliedVisibility([company(2)], [mark(1)], true), [], "unmarked companies stay out of Applied");
  const withNewRole = applyAppliedVisibility([company(1, [fresh])], [mark(1)], false);
  assert.deepEqual(listingsOf(withNewRole[0]), [fresh]);
});

test("Applied search and exports use only the marked roles", () => {
  const applied = applyAppliedVisibility([company(1), company(2)], [mark(1)], true);
  assert.deepEqual(applyFilters(applied, { ...DEFAULT_FILTERS, showApplied: true, q: "Bristol" }), []);
  const exported = buildExport(applyFilters(applied, { ...DEFAULT_FILTERS, showApplied: true }), true);
  assert.equal(exported.links, 1);
  assert.ok(exported.text.includes(hidden.url));
  assert.ok(!exported.text.includes(fresh.url));
});

test("hidden listing titles, locations and deadlines cannot affect search or closing-soon filters", () => {
  const now = new Date("2026-10-25T12:00:00Z").getTime();
  const view = applyAppliedVisibility([company(1)], [mark(1)], false);
  assert.equal(applyFilters(view, { ...DEFAULT_FILTERS, q: "London" }, now).length, 0);
  assert.equal(applyFilters(view, { ...DEFAULT_FILTERS, soon: true }, now).length, 0);
  assert.equal(nextClosing(view[0], now), new Date(2026, 11, 1).getTime());
});

test("export and displayed listing count use only visible roles", () => {
  const view = applyAppliedVisibility([company(1)], [mark(1)], false);
  const exported = buildExport(view, true);
  assert.equal(view.reduce((count, c) => count + listingsOf(c).length, 0), 1);
  assert.equal(exported.links, 1);
  assert.equal(exported.companies, 1);
  assert.ok(exported.text.includes(fresh.url));
  assert.ok(!exported.text.includes(hidden.url));
  assert.ok(!exported.csv.includes(hidden.title));
  assert.equal(buildExport(applyAppliedVisibility([company(1)], [mark(1), mark(1, fresh)], false), false).links, 0);
});

test("tracking URL changes and absent URLs use the same listing identity as the server", () => {
  const tracked = { ...hidden, url: `${hidden.url}/?utm_source=email#apply` };
  assert.equal(listingKey(tracked), listingKey(hidden));
  assert.equal(applyAppliedVisibility([company(1, [tracked])], [mark(1)], false).length, 0);
  const noUrl = { ...hidden, url: null };
  assert.equal(listingKey(noUrl), listingKey({ title: "  SOFTWARE   APPRENTICE " }));
});

test("Applied view selection survives a URL round trip and defaults to Opportunities", () => {
  assert.equal(filtersFromSearch({}).showApplied, false);
  assert.equal(searchFromFilters(DEFAULT_FILTERS).showApplied, undefined);
  const selected = { ...DEFAULT_FILTERS, q: "data", showApplied: true };
  assert.deepEqual(filtersFromSearch(searchFromFilters(selected)), selected);
});
