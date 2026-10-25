import assert from "node:assert/strict";
import path from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import type { Context } from "../src/trpc.ts";

// A deliberately absent connection prevents consulting real ChatGPT credentials.
process.env.OPENAI_AUTH_FILE = path.join(tmpdir(), `scanner-no-ai-${process.pid}.json`);
const { router, publicProcedure, userProcedure, adminProcedure, aiProcedure, adminAIProcedure, manualScanProcedure, manualScanAIProcedure } = await import("../src/trpc.ts");

const forbiddenDatabase = new Proxy({} as Context["prisma"], { get() { throw new Error("Database touched before authorization"); } });
const user = (role: string): NonNullable<Context["user"]> => ({ id: "member-id", email: "member@example.com", authSubject: "firebase-uid", name: null, role, createdAt: new Date(), lastLoginAt: null });
const permissions = router({
  public: publicProcedure.query(() => "public"),
  member: userProcedure.query(({ ctx }) => ctx.user.id),
  admin: adminProcedure.query(({ ctx }) => ctx.user.id),
  ai: aiProcedure.query(() => "must not run"),
  adminAI: adminAIProcedure.query(() => "must not run"),
  scan: manualScanProcedure.mutation(() => "must not run"),
  scanAI: manualScanAIProcedure.mutation(() => "must not run"),
});
const caller = (row: Context["user"]) => permissions.createCaller({ prisma: forbiddenDatabase, user: row });
const code = (expected: string) => (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === expected);

test("anonymous protected procedures fail before database or AI work, even without configuration", async () => {
  const anonymous = caller(null);
  assert.equal(await anonymous.public(), "public");
  for (const call of [() => anonymous.member(), () => anonymous.admin(), () => anonymous.ai(), () => anonymous.adminAI(), () => anonymous.scan(), () => anonymous.scanAI()]) await assert.rejects(call, code("UNAUTHORIZED"));
});

test("MEMBER accesses account procedures but cannot mutate global state or start manual scans", async () => {
  const member = caller(user("MEMBER"));
  assert.equal(await member.member(), "member-id");
  for (const call of [() => member.admin(), () => member.adminAI(), () => member.scan(), () => member.scanAI()]) await assert.rejects(call, code("FORBIDDEN"));
  await assert.rejects(() => caller(user("admin")).admin(), code("FORBIDDEN"));
});

test("ADMIN inherits account access; manual scan compatibility aliases preserve admin authorization", async () => {
  const admin = caller(user("ADMIN"));
  assert.equal(await admin.member(), "member-id");
  assert.equal(await admin.admin(), "member-id");
  assert.equal(manualScanProcedure, adminProcedure);
  assert.equal(manualScanAIProcedure, adminAIProcedure);
});

test("both member and admin AI require the shared ChatGPT connection", async () => {
  for (const call of [() => caller(user("MEMBER")).ai(), () => caller(user("ADMIN")).adminAI(), () => caller(user("ADMIN")).scanAI()]) {
    await assert.rejects(call, (error: unknown) => code("UNAUTHORIZED")(error) && (error as Error).message.includes("ChatGPT"));
  }
});
