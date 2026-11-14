import { generateText } from "ai";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getLoginError, isSignedIn, logout, startLogin } from "./openai-auth.ts";
import { extractCvText, tailorApplication } from "./application.ts";
import { extractUploadedDocx, MAX_CV_BASE64_LENGTH, MAX_CV_FILENAME_LENGTH } from "./cv-upload.ts";
import { getFirebaseConfig, isAuthConfigured } from "./auth.ts";
import { listingKey } from "./listing-key.ts";
import { adminAIProcedure, adminProcedure, aiProcedure, publicProcedure, router, userProcedure } from "./trpc.ts";
import { listVacancyCompanies } from "./vacancies.ts";
import { isTagConfigured, searchTagVacancies } from "./tag-api.ts";

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

  companies: router({
    list: userProcedure.query(({ ctx }) =>
      ctx.prisma.company.findMany({ orderBy: { name: "asc" } }),
    ),
  }),

  vacancies: router({
    list: userProcedure.query(() => listVacancyCompanies()),
    search: userProcedure
      .input(z.object({
        q: z.string().max(150).default(""),
        location: z.string().max(100).default(""),
        routes: z.array(z.string().min(1).max(80)).max(30).default([]),
        courseLevels: z.array(z.number().int().min(1).max(10)).max(10).default([]),
        salaryMin: z.number().int().min(0).nullable().default(null),
        salaryMax: z.number().int().min(0).nullable().default(null),
        startYear: z.number().int().min(2020).max(2040).nullable().default(null),
        sort: z.enum(["recent", "closing", "quality"]).default("recent"),
        page: z.number().int().min(1).max(10000).default(1),
      }))
      .query(async ({ input }) => {
        if (!isTagConfigured()) {
          const snapshot = await listVacancyCompanies();
          return { ...snapshot, page: 1, totalPages: 1, pageSize: snapshot.total, live: false };
        }
        try {
          return await searchTagVacancies(input);
        } catch (error) {
          const snapshot = await listVacancyCompanies();
          return {
            ...snapshot,
            page: 1,
            totalPages: 1,
            pageSize: snapshot.total,
            live: false,
            liveError: error instanceof Error ? error.message : "The TAG feed could not be reached.",
          };
        }
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
    /** Tailors the CV and writes a cover letter for a current listing from the provider feed. */
    generate: aiProcedure
      .input(z.object({ companyId: z.number().int(), listingUrl: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const company = await ctx.prisma.company.findUnique({ where: { id: input.companyId } });
        if (!company) throw new TRPCError({ code: "NOT_FOUND", message: "That company no longer exists. Refresh the page." });
        if (company.source !== "the-apprentice-guide") {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This role is no longer in the current vacancy feed." });
        }
        const listings: { title: string; url: string; location?: string; closes?: string; needsRecheck?: boolean }[] = JSON.parse(company.listings);
        const listing = listings.find((l) => l.url === input.listingUrl);
        if (!listing) throw new TRPCError({ code: "NOT_FOUND", message: "That listing isn't in the current vacancy feed. Refresh the page." });

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
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The saved listings couldn't be read. Refresh the vacancy feed." });
        }
        const listing = listings.find((candidate) => listingKey(candidate) === input.listingKey);
        if (!listing) throw new TRPCError({ code: "NOT_FOUND", message: "That listing isn't in the current vacancy feed. Refresh the page." });
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
