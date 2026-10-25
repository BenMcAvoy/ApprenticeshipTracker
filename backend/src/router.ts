import { generateText } from "ai";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getLoginError, isSignedIn, logout, startLogin } from "./openai-auth.ts";
import { extractCvText, tailorApplication } from "./application.ts";
import { extractUploadedDocx, MAX_CV_BASE64_LENGTH, MAX_CV_FILENAME_LENGTH } from "./cv-upload.ts";
import { getFirebaseConfig, isAuthConfigured } from "./auth.ts";
import { prisma } from "./db.ts";
import { listingKey } from "./listing-key.ts";
import { isValidTopic, sendNtfy } from "./ntfy.ts";
import { getSettings, jobState, nextReminderAt, nextRunAt, runClosingReminders, runDailyScan, runLegacyRecheckJob } from "./scheduler.ts";
import { getLegacyRecheckState } from "./scan-backfill.ts";
import { event, runScan } from "./scan.ts";
import { persistFailure, persistVerdict } from "./scan-job.ts";
import { adminAIProcedure, adminProcedure, aiProcedure, manualScanAIProcedure, manualScanProcedure, publicProcedure, router, userProcedure } from "./trpc.ts";

export const appRouter = router({
  ping: publicProcedure.query(async ({ ctx }) => {
    await ctx.prisma.$queryRaw`SELECT 1`;
    return { ok: true as const, db: "up" as const, time: new Date().toISOString() };
  }),

  auth: router({
    config: publicProcedure.query(() => getFirebaseConfig()),
    me: publicProcedure.query(({ ctx }) => ({
      user: ctx.user ? { id: ctx.user.id, email: ctx.user.email, name: ctx.user.name, role: ctx.user.role } : null,
      configured: isAuthConfigured(),
    })),
  }),

  manualScan: router({
    status: userProcedure.query(({ ctx }) => ({
      required: true,
      authorized: ctx.user.role === "ADMIN",
    })),
  }),

  companies: router({
    list: userProcedure.query(({ ctx }) =>
      ctx.prisma.company.findMany({ orderBy: { name: "asc" } }),
    ),
    import: adminProcedure
      .input(
        z.object({
          companies: z
            .array(z.object({ name: z.string().trim().min(1), careersUrl: z.url().optional() }))
            .max(10_000),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const byName = new Map(input.companies.map((c) => [c.name, c]));
        const names = [...byName.keys()];
        const existing = await ctx.prisma.company.findMany({
          where: { name: { in: names } },
          select: { name: true },
        });
        const known = new Set(existing.map((c) => c.name));
        const { count } = await ctx.prisma.company.createMany({
          data: names.filter((name) => !known.has(name)).map((name) => byName.get(name)!),
        });
        return { received: names.length, added: count };
      }),
  }),

  profile: router({
    get: userProcedure.query(async ({ ctx }) => {
      const profile = await ctx.prisma.userProfile.findUnique({ where: { userId: ctx.user.id } });
      return { cvText: profile?.cvText ?? "", updatedAt: profile?.updatedAt ?? null };
    }),
    save: userProcedure.input(z.object({ cvText: z.string().max(60_000) })).mutation(({ ctx, input }) =>
      ctx.prisma.userProfile.upsert({
        where: { userId: ctx.user.id },
        create: { userId: ctx.user.id, cvText: input.cvText },
        update: { cvText: input.cvText },
        omit: { userId: true },
      }),
    ),
    /** Parse and save a DOCX CV in one operation; existing text is kept if parsing fails. */
    upload: userProcedure
      .input(z.object({
        fileName: z.string().min(1).max(MAX_CV_FILENAME_LENGTH),
        base64: z.string().min(1).max(MAX_CV_BASE64_LENGTH),
      }))
      .mutation(async ({ ctx, input }) => {
        let cvText: string;
        try {
          cvText = await extractUploadedDocx(input.fileName, input.base64);
        } catch (error) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Couldn't read file" });
        }
        return ctx.prisma.userProfile.upsert({
          where: { userId: ctx.user.id },
          create: { userId: ctx.user.id, cvText },
          update: { cvText },
          omit: { userId: true },
        });
      }),
    /** Pulls text out of an uploaded PDF/DOCX/TXT so the user can review it before saving. */
    extract: userProcedure
      .input(z.object({ fileName: z.string(), base64: z.string().min(1) }))
      .mutation(async ({ input }) => {
        try {
          return { text: await extractCvText(input.fileName, input.base64) };
        } catch (error) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Couldn't read file" });
        }
      }),
  }),

  applications: router({
    get: userProcedure
      .input(z.object({ companyId: z.number().int(), listingUrl: z.string() }))
      .query(({ ctx, input }) =>
        ctx.prisma.userApplication.findUnique({
          where: { userId_companyId_listingUrl: { userId: ctx.user.id, companyId: input.companyId, listingUrl: input.listingUrl } },
          omit: { userId: true },
        }),
      ),
    /** Tailors the CV and writes a cover letter. Only allowed for listings of companies whose scan says "open". */
    generate: aiProcedure
      .input(z.object({ companyId: z.number().int(), listingUrl: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const company = await ctx.prisma.company.findUnique({ where: { id: input.companyId } });
        if (!company) throw new TRPCError({ code: "NOT_FOUND", message: "That company no longer exists. Refresh the page." });
        if (company.status !== "open") {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: `${company.name} isn't open for applications (status: ${company.status}). Rescan it first.` });
        }
        if (["unclear", "error"].includes(company.lastAttemptStatus ?? "")) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The latest check was inconclusive. Rescan to verify this role before tailoring." });
        }
        const listings: { title: string; url: string; location?: string; closes?: string; needsRecheck?: boolean }[] = JSON.parse(company.listings);
        const listing = listings.find((l) => l.url === input.listingUrl);
        if (!listing) throw new TRPCError({ code: "NOT_FOUND", message: "That listing isn't in the latest scan. Rescan the company." });
        if (listing.needsRecheck) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This role was kept from an older scan. Rescan to verify it before tailoring." });

        const profile = await ctx.prisma.userProfile.findUnique({ where: { userId: ctx.user.id } });
        if (!profile?.cvText.trim()) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Add your CV in Settings first." });
        }

        const result = await tailorApplication({
          cv: profile.cvText,
          company: company.name,
          listingTitle: listing.title,
          listingUrl: listing.url,
          closes: listing.closes,
          location: listing.location,
          companySummary: company.summary,
        });
        const data = {
          listingTitle: listing.title,
          fitSummary: result.fitSummary,
          tailoredCv: result.tailoredCv,
          coverLetter: result.coverLetter,
          changes: JSON.stringify(result.changes),
          gaps: JSON.stringify(result.gaps),
          audit: JSON.stringify(result.audit),
        };
        return ctx.prisma.userApplication.upsert({
          where: { userId_companyId_listingUrl: { userId: ctx.user.id, companyId: company.id, listingUrl: listing.url } },
          create: { userId: ctx.user.id, companyId: company.id, listingUrl: listing.url, ...data },
          update: { ...data, createdAt: new Date() },
          omit: { userId: true },
        });
      }),
  }),

  applied: router({
    list: userProcedure.query(({ ctx }) => ctx.prisma.appliedListing.findMany({
      where: { userId: ctx.user.id },
      select: { companyId: true, listingKey: true, listingTitle: true, listingUrl: true, appliedAt: true },
      orderBy: { appliedAt: "desc" },
    })),
    set: userProcedure
      .input(z.object({ companyId: z.number().int().positive(), listingKey: z.string().min(1).max(10_000), applied: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const identity = { userId: ctx.user.id, companyId: input.companyId, listingKey: input.listingKey };
        if (!input.applied) {
          // Rescans may remove old listings; their historical applied state must still be removable.
          await ctx.prisma.appliedListing.deleteMany({ where: identity });
          return { applied: false };
        }
        const company = await ctx.prisma.company.findUnique({ where: { id: input.companyId } });
        if (!company) throw new TRPCError({ code: "NOT_FOUND", message: "That company no longer exists. Refresh the page." });
        let listings: { title: string; url?: string | null }[] = [];
        try {
          listings = z.array(z.object({ title: z.string(), url: z.string().nullable().optional() })).parse(JSON.parse(company.listings));
        } catch {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The saved listings couldn't be read. Ask an admin to rescan this company." });
        }
        const listing = listings.find((candidate) => listingKey(candidate) === input.listingKey);
        if (!listing) throw new TRPCError({ code: "NOT_FOUND", message: "That listing isn't in the latest scan. Refresh the page." });
        await ctx.prisma.appliedListing.upsert({
          where: { userId_companyId_listingKey: identity },
          create: { ...identity, listingTitle: listing.title, listingUrl: listing.url ?? null },
          update: { listingTitle: listing.title, listingUrl: listing.url ?? null },
        });
        return { applied: true };
      }),
  }),

  admin: router({
    users: adminProcedure.query(({ ctx }) => ctx.prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true, createdAt: true, lastLoginAt: true },
      orderBy: { createdAt: "asc" },
    })),
    setRole: adminProcedure
      .input(z.object({ userId: z.string().min(1), role: z.enum(["ADMIN", "MEMBER"]) }))
      .mutation(({ ctx, input }) => ctx.prisma.$transaction(async (tx) => {
        if (input.role === "MEMBER") {
          // One SQL statement guards even simultaneous demotions of different admins.
          const changed = await tx.$executeRaw`UPDATE "User" SET "role" = 'MEMBER'
            WHERE "id" = ${input.userId}
            AND ("role" <> 'ADMIN' OR (SELECT COUNT(*) FROM "User" WHERE "role" = 'ADMIN') > 1)`;
          if (!changed) {
            const user = await tx.user.findUnique({ where: { id: input.userId } });
            if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "That account no longer exists." });
            throw new TRPCError({ code: "CONFLICT", message: "The last admin cannot be demoted. Promote another account first." });
          }
        } else {
          const { count } = await tx.user.updateMany({ where: { id: input.userId }, data: { role: input.role } });
          if (!count) throw new TRPCError({ code: "NOT_FOUND", message: "That account no longer exists." });
        }
        return tx.user.findUniqueOrThrow({
          where: { id: input.userId },
          select: { id: true, email: true, name: true, role: true },
        });
      })),
  }),

  settings: router({
    get: adminProcedure.query(async () => {
      const s = await getSettings();
      return {
        dailyScanEnabled: s.dailyScanEnabled,
        dailyScanTime: s.dailyScanTime,
        ntfyServer: s.ntfyServer,
        ntfyTopic: s.ntfyTopic,
        lastDailyRunAt: s.lastDailyRunAt,
        lastDailyRunResult: s.lastDailyRunResult,
        nextRunAt: nextRunAt(s),
        closingRemindersEnabled: s.closingRemindersEnabled,
        closingReminderDays: s.closingReminderDays,
        lastRemindersAt: s.lastRemindersAt,
        lastRemindersResult: s.lastRemindersResult,
        nextReminderAt: nextReminderAt(s),
        job: { running: jobState.running, done: jobState.done, total: jobState.total, kind: jobState.kind },
        legacyRecheck: await getLegacyRecheckState(prisma),
      };
    }),
    save: manualScanProcedure
      .input(
        z.object({
          dailyScanEnabled: z.boolean(),
          dailyScanTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24-hour)"),
          ntfyTopic: z.string().trim().refine(isValidTopic, "Topic may only contain letters, numbers, _ and -"),
          closingRemindersEnabled: z.boolean(),
          closingReminderDays: z.number().int().min(1).max(30),
        }),
      )
      .mutation(async ({ input }) => {
        const current = await getSettings();
        const rescheduled = current.dailyScanEnabled !== input.dailyScanEnabled || current.dailyScanTime !== input.dailyScanTime;
        // Turning reminders on mid-day shouldn't fire an immediate burst; the first one is the next daily slot.
        const remindersTurnedOn = input.closingRemindersEnabled && !current.closingRemindersEnabled;
        await prisma.settings.update({
          where: { id: 1 },
          data: {
            ...input,
            ...(rescheduled ? { scheduleSetAt: new Date() } : {}),
            ...(remindersTurnedOn ? { lastRemindersAt: new Date() } : {}),
          },
        });
      }),
    /** Sends the closing-soon reminders right now, using the results already saved. */
    sendRemindersNow: adminProcedure.mutation(() => runClosingReminders()),
    testNotification: adminProcedure.mutation(async () => {
      const s = await getSettings();
      try {
        await sendNtfy(s.ntfyServer, s.ntfyTopic, {
          title: "Apprentice Scanner test",
          message: "Notifications are working. You'll get a daily summary of open apprenticeships here.",
          tags: ["white_check_mark"],
        });
      } catch (error) {
        throw new TRPCError({ code: "BAD_GATEWAY", message: error instanceof Error ? error.message : "Couldn't send" });
      }
      return { topic: s.ntfyTopic };
    }),
    /** Starts the daily scan immediately in the background (progress shows in `get`). */
    runNow: manualScanAIProcedure.mutation(() => {
      if (jobState.running) throw new TRPCError({ code: "CONFLICT", message: "A scan is already running." });
      void runDailyScan("manual");
      return { started: true };
    }),
    recheckLegacy: manualScanAIProcedure.mutation(() => {
      if (jobState.running) throw new TRPCError({ code: "CONFLICT", message: "A scan is already running." });
      void runLegacyRecheckJob();
      return { started: true };
    }),
  }),

  scan: router({
    setUrl: adminProcedure
      .input(z.object({ id: z.number().int(), careersUrl: z.url().nullable() }))
      .mutation(({ ctx, input }) =>
        ctx.prisma.company.update({ where: { id: input.id }, data: { careersUrl: input.careersUrl } }),
      ),
    /** Streams progress events while scanning; the last event has progress 100. */
    run: manualScanAIProcedure.input(z.object({ id: z.number().int() })).subscription(async function* ({ ctx, input }) {
      const company = await ctx.prisma.company.findUnique({ where: { id: input.id } });
      if (!company) {
        throw new TRPCError({ code: "NOT_FOUND", message: "That company no longer exists. Refresh the page." });
      }
      yield event("search", "step", `Scanning ${company.name}`, 0);
      try {
        const verdict = yield* runScan(company);
        await persistVerdict(ctx.prisma, company, verdict);
        yield {
          ...event("done", verdict.status === "open" ? "success" : "info", verdict.summary, 100),
          result: { status: verdict.status, listings: verdict.listings.length },
        };
      } catch (error) {
        await persistFailure(ctx.prisma, company, error);
        const message = error instanceof Error ? error.message : "Scan failed";
        yield { ...event("done", "error", message, 100), result: { status: "error" as const, listings: 0 } };
      }
    }),
  }),

  ai: router({
    status: adminProcedure.query(async () => ({
      signedIn: await isSignedIn(),
      error: getLoginError(),
    })),
    login: adminProcedure.mutation(async () => ({ url: await startLogin() })),
    logout: adminProcedure.mutation(() => logout()),
    describeImage: adminAIProcedure
      .input(z.object({ image: z.string().min(1), mediaType: z.string().startsWith("image/") }))
      .mutation(async ({ ctx, input }) => {
        const { text } = await generateText({
          model: ctx.openai("gpt-6-luna"),
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "Describe this image in one or two sentences." },
                { type: "image", image: Buffer.from(input.image, "base64"), mediaType: input.mediaType },
              ],
            },
          ],
        });
        return { description: text };
      }),
    check: adminAIProcedure.mutation(async ({ ctx }) => {
      const { text } = await generateText({
        model: ctx.openai("gpt-6-luna"),
        prompt: "Reply with exactly: ok",
      });
      return { reply: text };
    }),
  }),
});

export type AppRouter = typeof appRouter;
