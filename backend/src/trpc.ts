import { initTRPC, TRPCError } from "@trpc/server";
import type { CreateHTTPContextOptions } from "@trpc/server/adapters/standalone";
import { prisma } from "./db.ts";
import { authenticateRequest } from "./auth.ts";
import { isSignedIn, openai } from "./openai-auth.ts";

export const createContext = async ({ req }: CreateHTTPContextOptions) => ({
  prisma,
  user: await authenticateRequest(prisma, req.headers.authorization),
});
export type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const userProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in with Google first." });
  return next({ ctx: { user: ctx.user } });
});

export const adminProcedure = userProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "ADMIN") throw new TRPCError({ code: "FORBIDDEN", message: "Administrator access required." });
  return next();
});

/** Requires a completed ChatGPT login (see openai-auth.ts). */
const requireAI = t.middleware(async ({ next }) => {
  if (!(await isSignedIn())) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in with ChatGPT first" });
  }
  return next({ ctx: { openai: openai() } });
});

export const aiProcedure = userProcedure.use(requireAI);
export const adminAIProcedure = adminProcedure.use(requireAI);
export const manualScanProcedure = adminProcedure;
export const manualScanAIProcedure = adminAIProcedure;
