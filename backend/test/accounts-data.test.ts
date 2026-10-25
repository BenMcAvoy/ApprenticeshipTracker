import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { after, before, beforeEach, describe, test } from "node:test";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { appRouter } from "../src/router.ts";
import { listingKey } from "../src/listing-key.ts";
import { bootstrapUsers, LEGACY_MIGRATION_KEY } from "../src/bootstrap-users.ts";
import { Document, Packer, Paragraph } from "docx";

const require = createRequire(import.meta.url);
const backendDir = path.resolve(import.meta.dirname, "..");
const schemaPath = path.join(backendDir, "prisma/schema.prisma");

async function fixture(legacy = false) {
  const directory = await mkdtemp(path.join(tmpdir(), "scanner-accounts-"));
  const filename = path.join(directory, "test.db");
  const url = `file:${filename.replaceAll("\\", "/")}`;
  if (legacy) {
    const sqlite = new DatabaseSync(filename);
    sqlite.exec(`
      CREATE TABLE "Profile" ("id" INTEGER NOT NULL PRIMARY KEY, "cvText" TEXT NOT NULL DEFAULT '', "updatedAt" DATETIME NOT NULL);
      CREATE TABLE "Application" (
        "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "companyId" INTEGER NOT NULL,
        "listingUrl" TEXT NOT NULL, "listingTitle" TEXT NOT NULL, "fitSummary" TEXT NOT NULL,
        "tailoredCv" TEXT NOT NULL, "coverLetter" TEXT NOT NULL,
        "changes" TEXT NOT NULL DEFAULT '[]', "gaps" TEXT NOT NULL DEFAULT '[]', "audit" TEXT NOT NULL DEFAULT '[]',
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE UNIQUE INDEX "Application_companyId_listingUrl_key" ON "Application"("companyId", "listingUrl");
      INSERT INTO "Profile" VALUES (1, 'Legacy private CV', '2026-01-01T10:00:00.000Z');
      INSERT INTO "Application" ("companyId", "listingUrl", "listingTitle", "fitSummary", "tailoredCv", "coverLetter")
        VALUES (77, 'https://jobs.example/legacy', 'Legacy role', 'Legacy fit', 'Legacy tailored CV', 'Legacy letter');
    `);
    sqlite.close();
  }
  // Always override DATABASE_URL; these checks never target the development or deployed database.
  execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "db", "push", "--schema", schemaPath], {
    cwd: backendDir, env: { ...process.env, DATABASE_URL: url }, encoding: "utf8", stdio: "pipe",
  });
  const db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
  return { db, cleanup: async () => {
    await db.$disconnect();
    assert.equal(path.dirname(directory), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith("scanner-accounts-"));
    await rm(directory, { recursive: true, force: true });
  } };
}

const code = (expected: string) => (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === expected);

async function docxBase64(text: string): Promise<string> {
  const document = new Document({ sections: [{ children: [new Paragraph(text)] }] });
  return (await Packer.toBuffer(document)).toString("base64");
}

describe("account data and permissions", () => {
  let data: Awaited<ReturnType<typeof fixture>>;
  before(async () => { data = await fixture(); });
  after(async () => { await data?.cleanup(); });
  beforeEach(async () => {
    await data.db.user.deleteMany();
    await data.db.company.deleteMany();
  });

  async function accounts() {
    const alice = await data.db.user.create({ data: { email: "alice@example.com" } });
    const bob = await data.db.user.create({ data: { email: "bob@example.com" } });
    return {
      alice, bob,
      a: appRouter.createCaller({ prisma: data.db, user: alice }),
      b: appRouter.createCaller({ prisma: data.db, user: bob }),
      guest: appRouter.createCaller({ prisma: data.db, user: null }),
    };
  }

  test("two users have independent CVs and private saved generated applications", async () => {
    const { alice, bob, a, b } = await accounts();
    assert.deepEqual(await a.profile.get(), { cvText: "", updatedAt: null });
    assert.deepEqual(await b.profile.get(), { cvText: "", updatedAt: null });
    const forgedProfile = { cvText: "Alice private CV", userId: bob.id };
    await a.profile.save(forgedProfile);
    await b.profile.save({ cvText: "Bob private CV" });
    assert.equal((await a.profile.get()).cvText, "Alice private CV");
    assert.equal((await b.profile.get()).cvText, "Bob private CV");

    const input = { companyId: 11, listingUrl: "https://jobs.example/same-role" };
    const application = { ...input, listingTitle: "Engineer", fitSummary: "Fit", tailoredCv: "Alice tailored CV", coverLetter: "Alice letter" };
    await data.db.userApplication.create({ data: { userId: alice.id, ...application } });
    assert.equal(await b.applications.get(input), null);
    await data.db.userApplication.create({ data: { userId: bob.id, ...application, tailoredCv: "Bob tailored CV", coverLetter: "Bob letter" } });
    assert.equal((await a.applications.get(input))?.tailoredCv, "Alice tailored CV");
    assert.equal((await b.applications.get(input))?.tailoredCv, "Bob tailored CV");
    assert.equal(await data.db.profile.count(), 0);
    assert.equal(await data.db.application.count(), 0);
  });

  test("DOCX upload extracts, saves only to the signed-in account, and returns updatedAt", async () => {
    const { alice, a, b } = await accounts();
    const cv = "Experienced apprentice candidate with strong communication, teamwork, customer service, organisation, problem solving, and practical technical skills.";
    const result = await a.profile.upload({ fileName: "Alice-CV.DOCX", base64: await docxBase64(cv) });
    assert.equal(result.cvText, cv);
    assert.ok(result.updatedAt instanceof Date);
    assert.equal((await a.profile.get()).cvText, cv);
    assert.deepEqual(await b.profile.get(), { cvText: "", updatedAt: null });
    assert.equal((await data.db.userProfile.findUniqueOrThrow({ where: { userId: alice.id } })).cvText, cv);
  });

  test("invalid and unreadable DOCX uploads preserve the existing CV", async () => {
    const { a, guest } = await accounts();
    const previous = "Previously saved CV text";
    await a.profile.save({ cvText: previous });
    const tooShort = await docxBase64("short text");
    const tooLargeRawFile = Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64");
    const tooMuchText = await docxBase64("A".repeat(60_001));
    for (const input of [
      { fileName: "cv.pdf", base64: await docxBase64("A valid-looking document with enough text to pass the parser's minimum threshold.") },
      { fileName: "cv.docx", base64: "not base64!" },
      { fileName: "cv.docx", base64: Buffer.from("not a DOCX archive").toString("base64") },
      { fileName: "cv.docx", base64: tooShort },
      { fileName: "cv.docx", base64: tooLargeRawFile },
      { fileName: "cv.docx", base64: tooMuchText },
      { fileName: `x${"a".repeat(255)}.docx`, base64: tooShort },
      { fileName: "cv.docx", base64: "A".repeat(7_000_000) },
    ]) await assert.rejects(() => a.profile.upload(input), code("BAD_REQUEST"));
    await assert.rejects(() => guest.profile.upload({ fileName: "cv.docx", base64: tooShort }), code("UNAUTHORIZED"));
    assert.equal((await a.profile.get()).cvText, previous);
  });

  test("applied state is isolated, server-validated and removable after a listing disappears", async () => {
    const { a, b } = await accounts();
    const listing = { title: "Software apprentice", url: "https://jobs.example/123" };
    const company = await data.db.company.create({ data: { name: "Example", listings: JSON.stringify([listing]) } });
    const identity = { companyId: company.id, listingKey: listingKey(listing) };
    await assert.rejects(() => a.applied.set({ ...identity, listingKey: "url:https://attacker.example/", applied: true }), code("NOT_FOUND"));
    const forgedApplied = { ...identity, applied: true, userId: (await data.db.user.findUniqueOrThrow({ where: { email: "bob@example.com" } })).id };
    await a.applied.set(forgedApplied);
    const first = (await a.applied.list())[0];
    assert.deepEqual(Object.keys(first).sort(), ["appliedAt", "companyId", "listingKey", "listingTitle", "listingUrl"]);
    assert.equal(first.listingTitle, listing.title);
    assert.equal(first.listingUrl, listing.url);
    assert.deepEqual(await b.applied.list(), []);
    await b.applied.set({ ...identity, applied: false });
    assert.equal((await a.applied.list()).length, 1);
    await a.applied.set({ ...identity, applied: true });
    assert.equal((await a.applied.list())[0].appliedAt.getTime(), first.appliedAt.getTime());
    await data.db.company.delete({ where: { id: company.id } });
    assert.equal((await a.applied.list()).length, 1);
    await a.applied.set({ ...identity, applied: false });
    assert.deepEqual(await a.applied.list(), []);
  });

  test("saved listings with null or missing URLs can be marked using normalized titles", async () => {
    const { a } = await accounts();
    const listings = [{ title: "  Software   Apprentice  ", url: null }, { title: "Engineering apprentice" }];
    const company = await data.db.company.create({ data: { name: "No URL", listings: JSON.stringify(listings) } });
    for (const listing of listings) await a.applied.set({ companyId: company.id, listingKey: listingKey(listing), applied: true });
    const applied = await a.applied.list();
    assert.equal(applied.length, 2);
    assert.ok(applied.every((row) => row.listingUrl === null));
    assert.ok(applied.some((row) => row.listingKey === "title:software apprentice"));
  });

  test("guest reads and member admin operations fail before AI, notifications or database writes", async () => {
    const { a, guest } = await accounts();
    for (const action of [
      () => guest.companies.list(), () => guest.profile.get(), () => guest.profile.save({ cvText: "No" }),
      () => guest.profile.extract({ fileName: "cv.txt", base64: "eA==" }),
      () => guest.applications.get({ companyId: 1, listingUrl: "" }),
      () => guest.applications.generate({ companyId: 1, listingUrl: "" }),
      () => guest.applied.list(), () => guest.applied.set({ companyId: 1, listingKey: "x", applied: false }),
      () => guest.manualScan.status(),
    ]) await assert.rejects(action, code("UNAUTHORIZED"));

    for (const [caller, expected] of [[guest, "UNAUTHORIZED"], [a, "FORBIDDEN"]] as const) {
      for (const action of [
        () => caller.companies.import({ companies: [] }),
        () => caller.scan.setUrl({ id: 1, careersUrl: null }), () => caller.scan.run({ id: 1 }),
        () => caller.settings.get(), () => caller.settings.runNow(), () => caller.settings.recheckLegacy(),
        () => caller.settings.save({ dailyScanEnabled: true, dailyScanTime: "07:00", ntfyTopic: "test", closingRemindersEnabled: true, closingReminderDays: 7 }),
        () => caller.settings.testNotification(), () => caller.settings.sendRemindersNow(),
        () => caller.ai.status(), () => caller.ai.login(), () => caller.ai.logout(), () => caller.ai.check(),
        () => caller.ai.describeImage({ image: "eA==", mediaType: "image/png" }),
        () => caller.admin.users(), () => caller.admin.setRole({ userId: "unknown", role: "ADMIN" }),
      ]) await assert.rejects(action, code(expected));
    }
    assert.equal((await a.companies.list()).length, 0);
    assert.deepEqual(await a.manualScan.status(), { required: true, authorized: false });
    assert.equal((await guest.auth.me()).user, null);
    assert.equal((await guest.ping()).ok, true);
  });

  test("admins can manage roles but the final admin cannot be demoted", async () => {
    const { alice, bob } = await accounts();
    const admin = await data.db.user.update({ where: { id: alice.id }, data: { role: "ADMIN" } });
    const caller = appRouter.createCaller({ prisma: data.db, user: admin });
    assert.equal((await caller.admin.users()).length, 2);
    await assert.rejects(() => caller.admin.setRole({ userId: alice.id, role: "MEMBER" }), code("CONFLICT"));
    await caller.admin.setRole({ userId: bob.id, role: "ADMIN" });
    await caller.admin.setRole({ userId: alice.id, role: "MEMBER" });
    assert.equal(await data.db.user.count({ where: { role: "ADMIN" } }), 1);
    const bobAdmin = await data.db.user.findUniqueOrThrow({ where: { id: bob.id } });
    const bobCaller = appRouter.createCaller({ prisma: data.db, user: bobAdmin });
    await assert.rejects(() => bobCaller.admin.setRole({ userId: bob.id, role: "MEMBER" }), code("CONFLICT"));
    await assert.rejects(() => bobCaller.admin.setRole({ userId: "unknown", role: "ADMIN" }), code("NOT_FOUND"));
  });
});

test("listing keys normalize URLs without merging different job IDs", () => {
  assert.equal(listingKey({ title: "a", url: "https://JOBS.example/role/?b=2&a=1&utm_source=x#details" }), listingKey({ title: "changed", url: "https://jobs.example/role?a=1&b=2" }));
  assert.notEqual(listingKey({ title: "same", url: "https://jobs.example/?job=1" }), listingKey({ title: "same", url: "https://jobs.example/?job=2" }));
  assert.equal(listingKey({ title: "  Ｓoftware\nAPPRENTICE", url: null }), "title:software apprentice");
  assert.equal(listingKey({ title: "Role", url: "javascript:alert(1)" }), "title:role");
});

test("additive migration preserves legacy sources, claims one explicit owner and is idempotent", async () => {
  const { db, cleanup } = await fixture(true);
  try {
    const oldProfile = await db.profile.findMany();
    const oldApps = await db.application.findMany();
    const member = await db.user.create({ data: { email: "new-member@example.com" } });
    assert.equal((await bootstrapUsers(db, {})).reason, "owner-not-configured");
    assert.equal(await db.userProfile.count(), 0);
    assert.equal(await db.migrationMetadata.count(), 0);

    const environment = { INITIAL_ADMIN_EMAIL: "ADMIN@example.com", LEGACY_OWNER_EMAIL: "OWNER@example.com" };
    assert.equal((await bootstrapUsers(db, environment)).migrated, true);
    const owner = await db.user.findUniqueOrThrow({ where: { email: "owner@example.com" } });
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    assert.equal(admin.role, "ADMIN");
    assert.equal(owner.role, "MEMBER");
    assert.equal(owner.authSubject, null);
    assert.equal((await db.userProfile.findUniqueOrThrow({ where: { userId: owner.id } })).cvText, oldProfile[0].cvText);
    assert.equal((await db.userApplication.findFirstOrThrow({ where: { userId: owner.id } })).tailoredCv, oldApps[0].tailoredCv);
    assert.equal(await db.userProfile.count({ where: { userId: member.id } }), 0);
    assert.equal(await db.userApplication.count({ where: { userId: member.id } }), 0);
    assert.equal(await db.userProfile.count({ where: { userId: admin.id } }), 0);

    await db.userProfile.update({ where: { userId: owner.id }, data: { cvText: "Owner edited CV" } });
    await db.user.update({ where: { id: admin.id }, data: { role: "MEMBER" } });
    assert.equal((await bootstrapUsers(db, environment)).reason, "already-migrated");
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: admin.id } })).role, "MEMBER");
    assert.equal((await db.userProfile.findUniqueOrThrow({ where: { userId: owner.id } })).cvText, "Owner edited CV");
    assert.equal(await db.userApplication.count(), oldApps.length);
    await bootstrapUsers(db, { ...environment, LEGACY_OWNER_EMAIL: "changed@example.com" });
    assert.equal(await db.user.findUnique({ where: { email: "changed@example.com" } }), null);
    assert.deepEqual(await db.profile.findMany(), oldProfile);
    assert.deepEqual(await db.application.findMany(), oldApps);
    const marker = await db.migrationMetadata.findUniqueOrThrow({ where: { key: LEGACY_MIGRATION_KEY } });
    assert.equal(JSON.parse(marker.value).userId, owner.id);
  } finally { await cleanup(); }
});

test("initial admin is the fallback legacy owner; existing personal data is preserved", async () => {
  const { db, cleanup } = await fixture(true);
  try {
    const user = await db.user.create({ data: { email: "owner@example.com" } });
    await db.userProfile.create({ data: { userId: user.id, cvText: "Already saved" } });
    await bootstrapUsers(db, { INITIAL_ADMIN_EMAIL: "owner@example.com" });
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).role, "ADMIN");
    assert.equal((await db.userProfile.findUniqueOrThrow({ where: { userId: user.id } })).cvText, "Already saved");
    assert.equal(await db.userApplication.count({ where: { userId: user.id } }), 1);
  } finally { await cleanup(); }
});

test("a copy failure rolls back owner/bootstrap creation and migration metadata", async () => {
  const { db, cleanup } = await fixture(true);
  try {
    await db.$executeRawUnsafe(`CREATE TRIGGER "reject_copy" BEFORE INSERT ON "UserApplication" BEGIN SELECT RAISE(ABORT, 'Simulated migration failure'); END`);
    await assert.rejects(() => bootstrapUsers(db, { INITIAL_ADMIN_EMAIL: "owner@example.com" }));
    assert.equal(await db.user.count(), 0);
    assert.equal(await db.userProfile.count(), 0);
    assert.equal(await db.migrationMetadata.count(), 0);
    assert.equal(await db.profile.count(), 1);
    assert.equal(await db.application.count(), 1);
    await db.$executeRawUnsafe('DROP TRIGGER "reject_copy"');
    assert.equal((await bootstrapUsers(db, { INITIAL_ADMIN_EMAIL: "owner@example.com" })).migrated, true);
  } finally { await cleanup(); }
});
