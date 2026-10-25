import type { Company, PrismaClient } from "./generated/prisma/client.ts";

const CHECKPOINT_KEY = "scanner-legacy-recheck-v2";

export type LegacyRecheckState = {
  running: boolean;
  done: boolean;
  total: number;
  confirmed: number;
  inconclusive: number;
  errors: number;
  startedAt: string;
  completedAt: string | null;
  /** Stable company identifiers selected when this batch was first prepared. */
  ids: number[];
  /** Finished identifiers are retained so recovery never schedules them again. */
  completedIds: number[];
  /** Informational only; these are returned to pending on process restart. */
  currentIds: number[];
  targetVersion: number;
};

export type LegacyRecheckPublicState = Omit<LegacyRecheckState, "ids" | "completedIds" | "currentIds" | "targetVersion"> & {
  remaining: number;
};

type CheckpointDb = Pick<PrismaClient, "company" | "migrationMetadata">;

function publicState(state: LegacyRecheckState): LegacyRecheckPublicState {
  const { ids: _ids, completedIds, currentIds: _currentIds, targetVersion: _targetVersion, ...visible } = state;
  return { ...visible, remaining: Math.max(0, state.total - completedIds.length) };
}

function parseState(value: string): LegacyRecheckState {
  const state = JSON.parse(value) as LegacyRecheckState;
  if (!state || !Array.isArray(state.ids) || !Array.isArray(state.completedIds) || !Array.isArray(state.currentIds)) {
    throw new Error("Invalid legacy recheck checkpoint");
  }
  // In-flight IDs remain visible as running for status readers, but runLegacyRecheck
  // always clears them before claiming work so an interrupted item is retried.
  return { ...state, done: state.completedIds.length >= state.total };
}

export async function getLegacyRecheckState(db: CheckpointDb): Promise<LegacyRecheckPublicState | null> {
  const record = await db.migrationMetadata.findUnique({ where: { key: CHECKPOINT_KEY } });
  return record ? publicState(parseState(record.value)) : null;
}

export async function prepareLegacyRecheck(db: CheckpointDb, targetVersion: number): Promise<LegacyRecheckPublicState> {
  const existing = await db.migrationMetadata.findUnique({ where: { key: CHECKPOINT_KEY } });
  if (existing) return publicState(parseState(existing.value));

  const companies = await db.company.findMany({
    where: { status: { in: ["none", "closed"] }, scanVersion: { lt: targetVersion } },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  const now = new Date().toISOString();
  const state: LegacyRecheckState = {
    running: false, done: companies.length === 0, total: companies.length,
    confirmed: 0, inconclusive: 0, errors: 0, startedAt: now,
    completedAt: companies.length === 0 ? now : null,
    ids: companies.map(({ id }) => id), completedIds: [], currentIds: [], targetVersion,
  };
  try {
    await db.migrationMetadata.create({ data: { key: CHECKPOINT_KEY, value: JSON.stringify(state) } });
    return publicState(state);
  } catch (error) {
    // A concurrent preparer may have won the unique-key race. Never replace its snapshot.
    const winner = await db.migrationMetadata.findUnique({ where: { key: CHECKPOINT_KEY } });
    if (winner) return publicState(parseState(winner.value));
    throw error;
  }
}

export async function runLegacyRecheck(
  db: CheckpointDb,
  scan: (company: Company) => Promise<void>,
  options: { targetVersion: number; concurrency?: number; onProgress?: (state: LegacyRecheckPublicState) => void | Promise<void> },
): Promise<LegacyRecheckPublicState> {
  await prepareLegacyRecheck(db, options.targetVersion);
  const row = await db.migrationMetadata.findUnique({ where: { key: CHECKPOINT_KEY } });
  if (!row) throw new Error("Legacy recheck checkpoint disappeared");
  let state = parseState(row.value);
  if (state.done) return publicState(state);

  state.running = true;
  state.currentIds = [];
  const finished = new Set(state.completedIds);
  let cursor = 0;
  let writeQueue = Promise.resolve();
  const checkpoint = (): Promise<void> => {
    const snapshot = JSON.stringify(state);
    writeQueue = writeQueue.then(() => db.migrationMetadata.update({ where: { key: CHECKPOINT_KEY }, data: { value: snapshot } }).then(() => undefined));
    return writeQueue;
  };
  const notify = async () => options.onProgress?.(publicState(state));
  await checkpoint();
  await notify();

  const worker = async () => {
    while (true) {
      const id = state.ids[cursor++];
      if (id === undefined) return;
      if (finished.has(id)) continue;
      state.currentIds.push(id);
      await checkpoint();

      try {
        const company = await db.company.findUnique({ where: { id } });
        if (company && company.scanVersion < options.targetVersion) await scan(company);
        // Deleted rows and rows upgraded by another scan are terminal skips.
      } catch {
        // Failures are counted below from the persisted attempt record when possible.
      }

      const fresh = await db.company.findUnique({ where: { id } }).catch(() => null);
      if (!fresh || fresh.scanVersion >= options.targetVersion) {
        if (fresh?.lastAttemptStatus === "unclear") state.inconclusive++;
        else if (fresh?.lastAttemptStatus === "error") state.errors++;
        else if (fresh) state.confirmed++;
        // A deleted company is simply skipped, not an error.
      } else if (fresh.lastAttemptStatus === "unclear") state.inconclusive++;
      else state.errors++;

      finished.add(id);
      state.completedIds.push(id);
      state.currentIds = state.currentIds.filter((currentId) => currentId !== id);
      state.done = state.completedIds.length >= state.total;
      state.running = !state.done;
      if (state.done) state.completedAt = new Date().toISOString();
      await checkpoint();
      await notify();
    }
  };

  const concurrency = Math.max(1, Math.min(32, Math.floor(options.concurrency ?? 1)));
  // A checkpoint failure must not release the scheduler lock while other workers
  // are still scanning. Drain them before the wrapper reports interruption.
  const workers = await Promise.allSettled(Array.from({ length: concurrency }, () => worker()));
  const failed = workers.find((result) => result.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
  state.running = false;
  state.currentIds = [];
  if (state.done) state.completedAt ??= new Date().toISOString();
  await checkpoint();
  await notify();
  return publicState(state);
}
