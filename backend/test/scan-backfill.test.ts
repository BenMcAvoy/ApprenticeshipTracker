import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { getLegacyRecheckState, prepareLegacyRecheck, runLegacyRecheck } from "../src/scan-backfill.ts";

const require = createRequire(import.meta.url);
let db: PrismaClient;
let directory: string;
const KEY = "scanner-legacy-recheck-v2";
const targetVersion = 4;

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "scanner-backfill-"));
  const url = `file:${path.join(directory, "test.db").replaceAll("\\", "/")}`;
  execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "db", "push", "--schema", "prisma/schema.prisma"], {
    cwd: path.resolve(import.meta.dirname, ".."), env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
  });
  db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
});
after(async () => {
  await db?.$disconnect();
  assert.equal(path.dirname(directory), path.resolve(tmpdir()));
  assert.ok(path.basename(directory).startsWith("scanner-backfill-"));
  await rm(directory, { recursive: true, force: true });
});

async function reset() {
  await db.migrationMetadata.deleteMany();
  await db.company.deleteMany();
}
async function company(name: string, status: string, scanVersion = 0) {
  return db.company.create({ data: { name, status, scanVersion } });
}
const markConfirmed = async (id: number) => db.company.update({ where: { id }, data: { scanVersion: targetVersion, lastAttemptStatus: "none" } });

test("checkpoint failure drains active workers before releasing the batch", async () => {
  await reset();
  await company("Drain A", "none");
  await company("Drain B", "none");
  let writes = 0;
  let activeScanFinished = false;
  const failingDb = {
    company: db.company,
    migrationMetadata: new Proxy(db.migrationMetadata, { get(target, property) {
      if (property === "update") return async (...args: Parameters<typeof db.migrationMetadata.update>) => {
        if (++writes === 3) throw new Error("Checkpoint unavailable");
        return target.update(...args);
      };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    } }),
  };
  await assert.rejects(() => runLegacyRecheck(failingDb, async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    activeScanFinished = true;
  }, { targetVersion, concurrency: 2 }), /Checkpoint unavailable/);
  assert.equal(activeScanFinished, true);
});

test("prepare snapshots legacy negatives once and exposes no company identifiers", async () => {
  await reset();
  const included = await company("Old none", "none");
  await company("Old closed", "closed", 1);
  await company("Already current", "none", targetVersion);
  await company("Other status", "open");

  assert.equal(await getLegacyRecheckState(db), null);
  const first = await prepareLegacyRecheck(db, targetVersion);
  await company("Added later", "none");
  const second = await prepareLegacyRecheck(db, targetVersion + 1);
  assert.deepEqual(first, second);
  assert.equal(first.total, 2);
  assert.equal("ids" in first, false);
  assert.equal("targetVersion" in first, false);
  assert.equal((await db.migrationMetadata.findUniqueOrThrow({ where: { key: KEY } })).value.includes(String(included.id)), true);
});

test("concurrent workers process each snapshot ID once and serialize durable progress", async () => {
  await reset();
  await company("Batch A", "none");
  await company("Batch B", "closed");
  await company("Batch C", "none");
  const calls = new Map<number, number>();
  let active = 0;
  let peak = 0;
  const result = await runLegacyRecheck(db, async (record) => {
    calls.set(record.id, (calls.get(record.id) ?? 0) + 1);
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await markConfirmed(record.id);
    active--;
  }, { targetVersion, concurrency: 2 });
  assert.equal(result.done, true);
  assert.equal(result.confirmed, 3);
  assert.equal(peak, 2);
  assert.deepEqual([...calls.values()], [1, 1, 1]);
});

test("resume retries in-flight work, skips deleted or upgraded rows, and counts errors without looping", async () => {
  await reset();
  const retry = await company("Retry", "none");
  const deleted = await company("Deleted", "closed");
  const upgraded = await company("Upgraded elsewhere", "none");
  await prepareLegacyRecheck(db, targetVersion);
  await db.company.delete({ where: { id: deleted.id } });
  await markConfirmed(upgraded.id);

  // Model a process crash after one company was reserved but before it was completed.
  const row = await db.migrationMetadata.findUniqueOrThrow({ where: { key: KEY } });
  const checkpoint = JSON.parse(row.value);
  checkpoint.running = true;
  checkpoint.currentIds = [retry.id];
  await db.migrationMetadata.update({ where: { key: KEY }, data: { value: JSON.stringify(checkpoint) } });
  assert.equal((await getLegacyRecheckState(db))?.running, true);

  const calls: number[] = [];
  const result = await runLegacyRecheck(db, async (record) => {
    calls.push(record.id);
    if (record.id === retry.id) await db.company.update({ where: { id: record.id }, data: { lastAttemptStatus: "error" } });
    throw new Error("scan failure persisted by scan wrapper");
  }, { targetVersion, concurrency: 1 });
  assert.deepEqual(calls, [retry.id]);
  assert.equal(result.done, true);
  assert.equal(result.errors, 1);
  assert.equal(result.confirmed, 1);
  assert.equal(result.total, 3);
});

test("an interrupted scan retries if its write did not reach the checkpoint", async () => {
  await reset();
  const record = await company("Checkpoint gap", "none");
  await prepareLegacyRecheck(db, targetVersion);
  await db.migrationMetadata.update({
    where: { key: KEY },
    data: { value: JSON.stringify({
      ...(JSON.parse((await db.migrationMetadata.findUniqueOrThrow({ where: { key: KEY } })).value)),
      running: true, currentIds: [record.id], completedIds: [],
    }) },
  });
  let calls = 0;
  const result = await runLegacyRecheck(db, async (fresh) => { calls++; await markConfirmed(fresh.id); }, { targetVersion });
  assert.equal(calls, 1);
  assert.equal(result.done, true);
  assert.equal(result.confirmed, 1);
});
