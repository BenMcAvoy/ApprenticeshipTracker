import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { authenticateRequest, bearerToken, createFirebaseAuth, getFirebaseConfig, isAuthConfigured, resolveGoogleUser } from "../src/auth.ts";

const { publicKey, privateKey } = await generateKeyPair("RS256");
const keys = createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: "google-test", alg: "RS256" }] });
const verifier = createFirebaseAuth({ projectId: "scanner-test", keys });
async function token(overrides: JWTPayload = {}, key = privateKey, alg = "RS256") {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    iss: "https://securetoken.google.com/scanner-test", aud: "scanner-test", sub: "firebase-uid",
    iat: now, exp: now + 3600, auth_time: now - 10,
    email: "Owner@Example.com", email_verified: true, name: "Owner",
    firebase: { sign_in_provider: "google.com" }, role: "ADMIN", ...overrides,
  }).setProtectedHeader({ alg, kid: "google-test" }).sign(key);
}

test("accepts a verified Google Firebase ID token and never copies role claims", async () => {
  assert.deepEqual(await verifier.verify(await token()), { uid: "firebase-uid", email: "owner@example.com", name: "Owner" });
});

test("rejects forged, expired, wrong-project and non-Google tokens", async () => {
  const now = Math.floor(Date.now() / 1000);
  const invalidClaims: JWTPayload[] = [
    { exp: now - 1 }, { exp: undefined }, { iss: "https://attacker.example" },
    { aud: "other-project" }, { aud: ["scanner-test", "other-project"] },
    { sub: "" }, { sub: "x".repeat(129) }, { sub: 123 } as unknown as JWTPayload, { iat: now + 60 }, { iat: undefined },
    { auth_time: now + 60 }, { auth_time: undefined }, { email: undefined },
    { email: "invalid" }, { email_verified: false }, { email_verified: "true" },
    { firebase: { sign_in_provider: "password" } }, { firebase: { sign_in_provider: "custom" } },
    { firebase: undefined }, { firebase: "google.com" },
  ];
  for (const claims of invalidClaims) assert.equal(await verifier.verify(await token(claims)), null, JSON.stringify(claims));
  assert.equal(await verifier.verify(undefined), null);
  assert.equal(await verifier.verify("forged"), null);
  const attacker = await generateKeyPair("RS256");
  assert.equal(await verifier.verify(await token({}, attacker.privateKey)), null);
  const rs512 = await generateKeyPair("RS512");
  assert.equal(await verifier.verify(await token({}, rs512.privateKey, "RS512")), null);
  const unsigned = `${btoa(JSON.stringify({ alg: "none" }))}.${btoa(JSON.stringify({ sub: "attacker" }))}.`;
  assert.equal(await verifier.verify(unsigned), null);
});

test("only reads one Authorization bearer token, never Cloudflare headers or query parameters", () => {
  assert.equal(bearerToken("Bearer abc.def.ghi"), "abc.def.ghi");
  assert.equal(bearerToken("bearer abc"), "abc");
  for (const header of [undefined, ["Bearer abc"], "Basic abc", "Bearer abc, Bearer def", "Bearer abc def", "Bearer "]) assert.equal(bearerToken(header), undefined);
});

test("missing or partial configuration fails closed without touching the database", async () => {
  const names = ["FIREBASE_API_KEY", "FIREBASE_AUTH_DOMAIN", "FIREBASE_PROJECT_ID", "FIREBASE_APP_ID"] as const;
  const previous = names.map((name) => process.env[name]);
  try {
    for (const name of names) delete process.env[name];
    assert.equal(isAuthConfigured(), false);
    assert.deepEqual(getFirebaseConfig(), { apiKey: "", authDomain: "", projectId: "", appId: "" });
    process.env.FIREBASE_PROJECT_ID = "scanner-test";
    assert.equal(isAuthConfigured(), false);
    const db = new Proxy({} as PrismaClient, { get() { throw new Error("Database accessed while unconfigured"); } });
    assert.equal(await authenticateRequest(db, `Bearer ${await token()}`), null);
    assert.equal(await createFirebaseAuth({ keys }).verify(await token()), null);
    for (const name of names) process.env[name] = "configured";
    assert.equal(isAuthConfigured(), true);
  } finally {
    names.forEach((name, index) => { if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index]; });
  }
});

async function database(t: { after(fn: () => Promise<void>): void }) {
  const directory = await mkdtemp(path.join(tmpdir(), "scanner-auth-"));
  const db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${path.join(directory, "auth.db")}` }) });
  t.after(async () => { await db.$disconnect(); await rm(directory, { recursive: true, force: true }); });
  await db.$executeRawUnsafe(`CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY, "email" TEXT NOT NULL UNIQUE, "authSubject" TEXT UNIQUE,
    "name" TEXT, "role" TEXT NOT NULL DEFAULT 'MEMBER', "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "lastLoginAt" DATETIME
  )`);
  return db;
}

test("open signup always creates MEMBER, including the very first signup", async (t) => {
  const db = await database(t);
  const identity = await verifier.verify(await token());
  assert.ok(identity);
  const user = await resolveGoogleUser(db, identity);
  assert.equal(user.role, "MEMBER");
  assert.equal(user.authSubject, "firebase-uid");
  assert.ok(user.lastLoginAt);
  const again = await resolveGoogleUser(db, identity);
  assert.equal(again.id, user.id);
  assert.equal(await db.user.count(), 1);
});

test("links an unbound seeded administrator by verified Google email and preserves role/name", async (t) => {
  const db = await database(t);
  const seed = await db.user.create({ data: { email: "owner@example.com", role: "ADMIN", name: "Seeded Owner" } });
  const linked = await resolveGoogleUser(db, { uid: "owner-firebase", email: seed.email, name: "Google Name" });
  assert.equal(linked.id, seed.id);
  assert.equal(linked.role, "ADMIN");
  assert.equal(linked.name, "Seeded Owner");
  assert.equal(linked.authSubject, "owner-firebase");
  assert.equal(await db.user.count(), 1);
});

test("never rebinds an email already associated with a different Firebase uid", async (t) => {
  const db = await database(t);
  const seed = await db.user.create({ data: { email: "owner@example.com", role: "ADMIN", authSubject: "original-owner" } });
  await assert.rejects(() => resolveGoogleUser(db, { uid: "different-uid", email: seed.email, name: null }), /already linked/);
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: seed.id } })).authSubject, "original-owner");
});

test("Firebase uid remains the identity when Google email changes; an existing MEMBER stays MEMBER", async (t) => {
  const db = await database(t);
  const member = await db.user.create({ data: { email: "old@example.com", authSubject: "same-uid", role: "MEMBER" } });
  const admin = await db.user.create({ data: { email: "admin@example.com", role: "ADMIN" } });
  const user = await resolveGoogleUser(db, { uid: "same-uid", email: admin.email, name: "New name" });
  assert.equal(user.id, member.id);
  assert.equal(user.role, "MEMBER");
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: admin.id } })).authSubject, null);
});
