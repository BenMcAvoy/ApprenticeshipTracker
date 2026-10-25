import { closingReminders } from "./closing.ts";
import { prisma } from "./db.ts";
import type { Company } from "./generated/prisma/client.ts";
import { type Notification, sendNtfy } from "./ntfy.ts";
import { isSignedIn } from "./openai-auth.ts";
import { scanAndSave, SCAN_VERSION } from "./scan-job.ts";
import { getLegacyRecheckState, prepareLegacyRecheck, runLegacyRecheck } from "./scan-backfill.ts";

const CONCURRENCY = 3;

type Listing = { title: string; url: string; location?: string; closes?: string; needsRecheck?: boolean };
type Snapshot = { name: string; status: string; listings: Listing[] };

/** In-memory progress of the currently running (or last) daily scan, shown in Settings. */
export const jobState = { running: false, done: 0, total: 0, startedAt: null as Date | null, kind: "daily" as "daily" | "recheck" };

const listingsOf = (c: { listings: string }): Listing[] => {
  try {
    return JSON.parse(c.listings);
  } catch {
    return [];
  }
};

const snapshot = (c: Company): Snapshot => ({ name: c.name, status: c.status, listings: listingsOf(c) });

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const fmt = (l: Listing) => `${l.title}${l.closes ? ` (closes ${l.closes})` : ""}`;

/** Compares before/after results and builds the daily ntfy message. Pure, so it can be tested without scanning. */
export function buildSummary(before: Map<number, Snapshot>, after: Company[], minutes: number): Notification {
  const newOpen: string[] = [];
  const newListings: string[] = [];
  const newUpcoming: string[] = [];
  const noLongerOpen: string[] = [];
  const open: string[] = [];
  const needsRecheck: string[] = [];
  let upcoming = 0;
  let trouble = 0;
  let firstNewUrl: string | undefined;

  for (const c of after) {
    const prev = before.get(c.id);
    const now = snapshot(c);
    const prevUrls = new Set((prev?.listings ?? []).map((l) => l.url));
    const failedRecheck = ["unclear", "error"].includes(c.lastAttemptStatus ?? "");
    if (failedRecheck) {
      trouble++;
      needsRecheck.push(`${c.name}${c.status === "open" ? " (last confirmed open)" : ""}`);
      continue;
    }
    if (c.status === "open") {
      open.push(c.name);
      const fresh = now.listings.filter((l) => !l.needsRecheck && !prevUrls.has(l.url));
      if (prev?.status !== "open") {
        newOpen.push(`${c.name}: ${now.listings.filter((listing) => !listing.needsRecheck).map(fmt).join("; ") || "open"}`);
        firstNewUrl ??= now.listings.find((listing) => !listing.needsRecheck)?.url;
      } else if (fresh.length) {
        newListings.push(`${c.name}: ${fresh.map(fmt).join("; ")}`);
        firstNewUrl ??= fresh[0].url;
      }
    } else if (prev?.status === "open" && ["closed", "none", "upcoming"].includes(c.status)) {
      noLongerOpen.push(`${c.name} (now ${c.status})`);
    }
    if (c.status === "upcoming") {
      upcoming++;
      if (prev?.status !== "upcoming") newUpcoming.push(c.name);
    }
    if (c.status === "error" || c.status === "unclear") trouble++;
  }

  const lines = [`Scanned ${after.length} companies in ${minutes} min.`];
  const section = (heading: string, items: string[]) => {
    if (items.length) lines.push("", `${heading}`, ...items.map((i) => `• ${i}`));
  };
  section(`🎉 NEWLY OPEN (${newOpen.length})`, newOpen);
  section(`🆕 NEW LISTINGS (${newListings.length})`, newListings);
  section(`⏳ NEWLY OPENING SOON (${newUpcoming.length})`, newUpcoming);
  section(`🚪 NO LONGER OPEN (${noLongerOpen.length})`, noLongerOpen);
  section(`⚠️ NEEDS RECHECK (${needsRecheck.length})`, needsRecheck);
  lines.push("", `Open now (${open.length}): ${open.join(", ") || "none"}`);
  if (upcoming) lines.push(`Opening soon: ${upcoming}`);
  if (trouble) lines.push(`Couldn't check: ${trouble}`);

  const fresh = newOpen.length + newListings.length;
  return {
    title: fresh ? `${fresh} new apprenticeship${fresh === 1 ? "" : "s"} open` : `Apprenticeship scan: ${open.length} open${trouble ? `, ${trouble} need recheck` : ", nothing new"}`,
    message: lines.join("\n"),
    priority: fresh ? 4 : 3,
    tags: [fresh ? "tada" : "mortar_board"],
    click: firstNewUrl,
  };
}

// ---------------------------------------------------------------------------
// The daily job
// ---------------------------------------------------------------------------

export async function getSettings() {
  return prisma.settings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
}

export async function runDailyScan(trigger: "schedule" | "manual"): Promise<void> {
  if (jobState.running) return;
  jobState.running = true;
  jobState.kind = "daily";
  jobState.done = 0;
  jobState.startedAt = new Date();
  const started = Date.now();
  const settings = await getSettings();
  // Record the attempt up front so a crash or restart doesn't trigger an endless retry loop.
  await prisma.settings.update({ where: { id: 1 }, data: { lastDailyRunAt: new Date(), lastDailyRunResult: "Running…" } });

  const notify = async (n: Notification) => {
    try {
      await sendNtfy(settings.ntfyServer, settings.ntfyTopic, n);
    } catch (error) {
      console.error("[scheduler] ntfy failed:", (error as Error).message);
      return (error as Error).message;
    }
  };

  try {
    if (!(await isSignedIn())) {
      const message = "The daily scan couldn't run because you're signed out of ChatGPT. Sign in from Settings.";
      await notify({ title: "Daily scan failed", message, priority: 4, tags: ["warning"] });
      await prisma.settings.update({ where: { id: 1 }, data: { lastDailyRunResult: `Failed: ${message}` } });
      return;
    }

    const companies = await prisma.company.findMany({ orderBy: { name: "asc" } });
    jobState.total = companies.length;
    const before = new Map(companies.map((c) => [c.id, snapshot(c)]));
    console.log(`[scheduler] ${trigger} scan of ${companies.length} companies starting`);

    const queue = [...companies];
    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        await scanAndSave(prisma, next);
        jobState.done++;
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, companies.length) }, worker));

    const after = await prisma.company.findMany({ orderBy: { name: "asc" } });
    const summary = buildSummary(before, after, Math.round((Date.now() - started) / 60_000));
    const notifyError = await notify(summary);
    await prisma.settings.update({
      where: { id: 1 },
      data: { lastDailyRunResult: `${summary.title}${notifyError ? ` (notification failed: ${notifyError})` : ""}` },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await notify({ title: "Daily scan failed", message, priority: 4, tags: ["warning"] });
    await prisma.settings.update({ where: { id: 1 }, data: { lastDailyRunResult: `Failed: ${message}` } });
  } finally {
    jobState.running = false;
  }
}

/** A finite, restart-safe recheck of old negative results. No notifications. */
export async function runLegacyRecheckJob(): Promise<void> {
  if (jobState.running) return;
  jobState.running = true;
  jobState.kind = "recheck";
  jobState.startedAt = new Date();
  try {
    if (!(await isSignedIn())) return;
    await prepareLegacyRecheck(prisma, SCAN_VERSION);
    await runLegacyRecheck(prisma, (company) => scanAndSave(prisma, company), {
      targetVersion: SCAN_VERSION, concurrency: CONCURRENCY,
      onProgress: (state) => { jobState.done = state.total - state.remaining; jobState.total = state.total; },
    });
  } catch (error) {
    console.error("[scanner] Legacy recheck interrupted; checkpoint retained:", error instanceof Error ? error.message : "unknown error");
  } finally {
    jobState.running = false;
  }
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

const todayAt = (time: string, from = new Date()) => {
  const [h, m] = time.split(":").map(Number);
  const d = new Date(from);
  d.setHours(h, m, 0, 0);
  return d;
};

/**
 * The next daily slot, or "now" if one has been missed (e.g. the server was off at 07:00).
 * Slots before the schedule was last configured, or before the last run, never count.
 */
function nextSlot(enabled: boolean, time: string, lastAt: Date | null, scheduleSetAt: Date, now: Date): Date | null {
  if (!enabled) return null;
  const after = Math.max(lastAt?.getTime() ?? 0, scheduleSetAt.getTime());
  let slot = todayAt(time, now);
  if (slot.getTime() <= after) slot = new Date(slot.getTime() + 24 * 60 * 60 * 1000);
  return slot <= now ? now : slot;
}

type ScheduleSettings = {
  dailyScanEnabled: boolean;
  dailyScanTime: string;
  lastDailyRunAt: Date | null;
  scheduleSetAt: Date;
  closingRemindersEnabled: boolean;
  lastRemindersAt: Date | null;
};

export const nextRunAt = (s: ScheduleSettings, now = new Date()) =>
  nextSlot(s.dailyScanEnabled, s.dailyScanTime, s.lastDailyRunAt, s.scheduleSetAt, now);

/** Reminders go out at the same time of day as the scan, but don't depend on it. */
export const nextReminderAt = (s: ScheduleSettings, now = new Date()) =>
  nextSlot(s.closingRemindersEnabled, s.dailyScanTime, s.lastRemindersAt, s.scheduleSetAt, now);

// ---------------------------------------------------------------------------
// Closing-date reminders
// ---------------------------------------------------------------------------

const MAX_REMINDERS = 25;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let remindersRunning = false;

/** Sends one notification per open listing closing soon, based on the results already saved. */
export async function runClosingReminders(): Promise<{ sent: number; result: string }> {
  if (remindersRunning) return { sent: 0, result: "Already running" };
  remindersRunning = true;
  try {
    const settings = await getSettings();
    // Record the attempt up front so a failure can't cause a resend loop within the same day.
    await prisma.settings.update({ where: { id: 1 }, data: { lastRemindersAt: new Date() } });

    const companies = await prisma.company.findMany({ where: { status: "open" } });
    const reminders = closingReminders(companies, settings.closingReminderDays);
    let sent = 0;
    let failure: string | undefined;

    for (const r of reminders.slice(0, MAX_REMINDERS)) {
      try {
        await sendNtfy(settings.ntfyServer, settings.ntfyTopic, r.notification);
        sent++;
        await sleep(700); // stay well within ntfy's rate limits and keep the phone buzzing in order
      } catch (error) {
        failure = (error as Error).message;
        console.error("[reminders] ntfy failed:", failure);
        break;
      }
    }
    if (reminders.length > MAX_REMINDERS && !failure) {
      try {
        await sendNtfy(settings.ntfyServer, settings.ntfyTopic, {
          title: `…and ${reminders.length - MAX_REMINDERS} more closing soon`,
          message: "Open the app and sort by “Closing soonest” to see them all.",
          priority: 4,
          tags: ["hourglass_flowing_sand"],
        });
      } catch {
        // best effort
      }
    }

    const result = failure
      ? `Sent ${sent} of ${reminders.length}; stopped: ${failure}`
      : reminders.length
        ? `Sent ${sent} reminder${sent === 1 ? "" : "s"} (closing within ${settings.closingReminderDays} days)`
        : `Nothing closing within ${settings.closingReminderDays} days`;
    await prisma.settings.update({ where: { id: 1 }, data: { lastRemindersResult: result } });
    return { sent, result };
  } finally {
    remindersRunning = false;
  }
}

async function tick() {
  try {
    const settings = await getSettings();
    // Reminders first and independently: they must still go out while an hour-long scan is running.
    const reminderAt = nextReminderAt(settings);
    if (reminderAt && reminderAt <= new Date()) await runClosingReminders();
    if (jobState.running) return;
    const recheck = await getLegacyRecheckState(prisma);
    if (recheck && !recheck.done) { await runLegacyRecheckJob(); return; }
    const next = nextRunAt(settings);
    if (next && next <= new Date()) await runDailyScan("schedule");
  } catch (error) {
    console.error("[scheduler] tick failed:", error);
  }
}

export async function startScheduler() {
  // A previous run that was cut off (server restart) shouldn't consume today's slot.
  await prisma.settings.updateMany({
    where: { lastDailyRunResult: "Running…" },
    data: { lastDailyRunAt: null, lastDailyRunResult: "Interrupted by a restart; will run again" },
  });
  setInterval(tick, 60_000);
  // Catch up shortly after startup if today's run was missed.
  setTimeout(tick, 15_000);
  console.log("Daily scan scheduler started");
}
