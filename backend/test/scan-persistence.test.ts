import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { persistFailure, persistVerdict, SCAN_VERSION } from "../src/scan-job.ts";
import { buildSummary } from "../src/scheduler.ts";
import { closingReminders } from "../src/closing.ts";
import type { Verdict } from "../src/scan.ts";

const require = createRequire(import.meta.url);
let db: PrismaClient;
let directory: string;
const oldDate = new Date("2026-10-20T12:00:00Z");
const role = { title: "Software Degree Apprentice", url: "https://jobs.example/roles/one", closes: "31 December 2026" };
const verdict = (status: Verdict["status"], listings: Verdict["listings"] = []): Verdict => ({
  status, summary: `New ${status} result`, listings, evidence: [], checked: 5, careersUrl: null,
});

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "scanner-persistence-"));
  const url = `file:${path.join(directory, "test.db").replaceAll("\\", "/")}`;
  execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "db", "push", "--schema", "prisma/schema.prisma"], {
    cwd: path.resolve(import.meta.dirname, ".."), env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
  });
  db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
});
after(async () => {
  await db?.$disconnect();
  assert.equal(path.dirname(directory), path.resolve(tmpdir()));
  assert.ok(path.basename(directory).startsWith("scanner-persistence-"));
  await rm(directory, { recursive: true, force: true });
});

async function company(name: string, status = "open") {
  return db.company.create({ data: {
    name, status, summary: "Previously verified", lastScannedAt: oldDate,
    listings: status === "open" ? JSON.stringify([role]) : "[]",
    evidence: JSON.stringify([{ url: role.url, quote: "Apply now for this role" }]), checked: 9,
  } });
}

test("an inconclusive recheck preserves the confirmed result and its original time", async () => {
  const previous = await company("Retained open");
  const saved = await persistVerdict(db, previous, verdict("unclear"));
  for (const field of ["status", "summary", "listings", "evidence", "checked", "scanVersion"] as const) assert.equal(saved[field], previous[field]);
  assert.equal(saved.lastConfirmedAt?.toISOString(), oldDate.toISOString());
  assert.equal(saved.lastAttemptStatus, "unclear");
  assert.equal(saved.lastAttemptSummary, "New unclear result");
  assert.ok(saved.lastScannedAt!.getTime() > oldDate.getTime());
});

test("exceptions retain confirmed closed and none results, and first attempts remain uncertain", async () => {
  for (const status of ["closed", "none"]) {
    const previous = await company(`Retained ${status}`, status);
    const saved = await persistFailure(db, previous, new Error("Browser unavailable"));
    assert.equal(saved.status, status);
    assert.equal(saved.lastAttemptStatus, "error");
    assert.equal(saved.lastAttemptSummary, "Browser unavailable");
    assert.equal(saved.summary, previous.summary);
  }
  const first = await company("First attempt", "unscanned");
  const saved = await persistVerdict(db, first, verdict("unclear"));
  assert.equal(saved.status, "unclear");
  assert.equal(saved.lastConfirmedAt, null);
});

test("partial discovery keeps older roles flagged; complete coverage can remove them", async () => {
  const previous = await company("Partial discovery");
  const freshRole = { title: "Cyber Degree Apprentice", url: "https://jobs.example/roles/two" };
  const partial = { ...verdict("open", [freshRole]), coverage: { complete: false, pendingCandidates: 1 } };
  const saved = await persistVerdict(db, previous, partial);
  const roles = JSON.parse(saved.listings);
  assert.equal(roles.length, 2);
  assert.equal(roles.find((item: typeof role) => item.url === role.url).needsRecheck, true);
  assert.equal(roles.find((item: typeof role) => item.url === role.url).lastVerifiedAt, oldDate.toISOString());
  assert.equal(roles.find((item: typeof role) => item.url === freshRole.url).needsRecheck, false);
  assert.equal(saved.scanVersion, SCAN_VERSION);
  assert.equal(saved.coverageComplete, false);
  const full = await persistVerdict(db, saved, { ...verdict("open", [freshRole]), coverage: { complete: true, pendingCandidates: 0 } });
  assert.equal(JSON.parse(full.listings).length, 1);
  assert.equal(full.coverageComplete, true);
});

test("a stale scan starting snapshot cannot restore an older confirmed result", async () => {
  const previous = await company("Concurrent completion");
  const newer = await db.company.update({ where: { id: previous.id }, data: { summary: "A newer confirmed result", lastConfirmedAt: new Date("2026-10-22T12:00:00Z") } });
  const saved = await persistVerdict(db, previous, verdict("unclear"));
  assert.equal(saved.summary, newer.summary);
  assert.equal(saved.lastConfirmedAt?.toISOString(), newer.lastConfirmedAt?.toISOString());
});

test("an overlapping older confirmed scan cannot replace a newer confirmed result", async () => {
  const previous = await company("Old confirmed overlap");
  const newer = await persistVerdict(db, previous, { ...verdict("open", [role]), coverage: { complete: true, pendingCandidates: 0 } });
  const saved = await persistVerdict(db, previous, { ...verdict("closed"), coverage: { complete: true, pendingCandidates: 0 } });
  assert.equal(saved.status, "open");
  assert.equal(saved.lastConfirmedAt?.toISOString(), newer.lastConfirmedAt?.toISOString());
  assert.equal(saved.lastAttemptStatus, "open");
  assert.equal(saved.listings, newer.listings);
});

test("failed verification never announces closure or fresh opportunities", async () => {
  const previous = await company("Notification retention");
  const saved = await persistVerdict(db, previous, verdict("unclear"));
  const before = new Map([[previous.id, { name: previous.name, status: previous.status, listings: [role] }]]);
  const summary = buildSummary(before, [saved], 2);
  assert.doesNotMatch(summary.message, /NO LONGER OPEN|NEWLY OPEN|NEW LISTINGS/);
  assert.match(summary.message, /NEEDS RECHECK/);
  assert.match(summary.message, /last confirmed open/);
  assert.match(summary.title, /need recheck/);
  assert.deepEqual(closingReminders([saved], 7, new Date("2026-12-28T12:00:00Z")), []);
});

test("partial discovery reminders exclude older unverified roles", () => {
  const listings = [{ ...role, needsRecheck: true }, { ...role, url: "https://jobs.example/new", needsRecheck: false }];
  const reminders = closingReminders([{ name: "Partial", status: "open", listings: JSON.stringify(listings) }], 7, new Date("2026-12-28T12:00:00Z"));
  assert.deepEqual(reminders.map((item) => item.listing.url), ["https://jobs.example/new"]);
});

test("confirmed closure replaces the old open result and can announce closure", async () => {
  const previous = await company("Confirmed closure");
  const saved = await persistVerdict(db, previous, { ...verdict("closed"), coverage: { complete: true, pendingCandidates: 0 } });
  assert.equal(saved.status, "closed");
  assert.equal(saved.lastAttemptStatus, "closed");
  assert.deepEqual(JSON.parse(saved.listings), []);
  assert.equal(saved.scanVersion, SCAN_VERSION);
  const summary = buildSummary(new Map([[previous.id, { name: previous.name, status: previous.status, listings: [role] }]]), [saved], 2);
  assert.match(summary.message, /NO LONGER OPEN/);
  assert.doesNotMatch(summary.message, /NEEDS RECHECK/);
});

test("partial discovery deduplicates the Siemens query and path vacancy forms", async () => {
  const previous = await company("Siemens URL forms");
  await db.company.update({ where: { id: previous.id }, data: { listings: JSON.stringify([{ ...role, url: "https://jobs.siemens.com/en_US/externaljobs/JobDetail?folderId=518834&source=Gradcracker" }]) } });
  const saved = await persistVerdict(db, previous, {
    ...verdict("open", [{ ...role, url: "https://jobs.siemens.com/en_US/externaljobs/JobDetail/518834" }]),
    coverage: { complete: false, pendingCandidates: 1 },
  });
  assert.equal(JSON.parse(saved.listings).length, 1);
});
