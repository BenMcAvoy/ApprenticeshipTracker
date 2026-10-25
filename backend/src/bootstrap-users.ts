import { pathToFileURL } from "node:url";
import { z } from "zod";
import { prisma } from "./db.ts";
import type { PrismaClient } from "./generated/prisma/client.ts";
import { createLogger } from "./logger.ts";

export const LEGACY_MIGRATION_KEY = "legacy-personal-data-v1";
const ADMIN_BOOTSTRAP_KEY = "initial-admin-v1";

type BootstrapEnvironment = { INITIAL_ADMIN_EMAIL?: string; LEGACY_OWNER_EMAIL?: string };

function configuredEmail(value: string | undefined): string | undefined {
  const email = value?.trim().toLowerCase();
  return email ? z.email().parse(email) : undefined;
}

/** Additive and atomic: source tables are retained, and existing account data is never overwritten. */
export async function bootstrapUsers(db: PrismaClient = prisma, env: BootstrapEnvironment = process.env) {
  const adminEmail = configuredEmail(env.INITIAL_ADMIN_EMAIL);
  const ownerEmail = configuredEmail(env.LEGACY_OWNER_EMAIL) ?? adminEmail;

  return db.$transaction(async (tx) => {
    let adminCreated = false;
    if (adminEmail && !(await tx.migrationMetadata.findUnique({ where: { key: ADMIN_BOOTSTRAP_KEY } }))) {
      const admin = await tx.user.upsert({
        where: { email: adminEmail },
        create: { email: adminEmail, role: "ADMIN" },
        update: { role: "ADMIN" },
      });
      await tx.migrationMetadata.create({ data: {
        key: ADMIN_BOOTSTRAP_KEY,
        value: JSON.stringify({ userId: admin.id, email: admin.email }),
      } });
      adminCreated = true;
    }

    if (!ownerEmail) return { adminCreated, migrated: false, reason: "owner-not-configured" as const };
    if (await tx.migrationMetadata.findUnique({ where: { key: LEGACY_MIGRATION_KEY } })) {
      return { adminCreated, migrated: false, reason: "already-migrated" as const };
    }

    const owner = await tx.user.upsert({ where: { email: ownerEmail }, create: { email: ownerEmail }, update: {} });
    const profile = await tx.profile.findUnique({ where: { id: 1 } });
    if (profile) {
      await tx.userProfile.upsert({
        where: { userId: owner.id },
        create: { userId: owner.id, cvText: profile.cvText, updatedAt: profile.updatedAt },
        update: {},
      });
    }
    const applications = await tx.application.findMany();
    for (const { id: _legacyId, ...application } of applications) {
      await tx.userApplication.upsert({
        where: { userId_companyId_listingUrl: { userId: owner.id, companyId: application.companyId, listingUrl: application.listingUrl } },
        create: { userId: owner.id, ...application },
        update: {},
      });
    }
    await tx.migrationMetadata.create({ data: {
      key: LEGACY_MIGRATION_KEY,
      value: JSON.stringify({ userId: owner.id, email: owner.email, profileFound: Boolean(profile), applicationsFound: applications.length }),
    } });
    return { adminCreated, migrated: true, reason: "completed" as const };
  }, { maxWait: 30_000, timeout: 60_000 });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await bootstrapUsers();
    createLogger("accounts").info({ reason: result.reason, adminCreated: result.adminCreated }, "Bootstrap complete");
  } catch (error) {
    createLogger("accounts").error({ err: error }, "Bootstrap failed; startup stopped");
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
