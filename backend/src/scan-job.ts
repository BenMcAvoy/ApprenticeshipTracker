import type { Company, PrismaClient } from "./generated/prisma/client.ts";
import { runScan, type Verdict } from "./scan.ts";
import { saveScanTrace } from "./scan-trace.ts";
import { vacancyIdentity } from "./vacancy-identity.ts";

export const SCAN_VERSION = 2;
const confirmedStatuses = new Set(["open", "upcoming", "closed", "none"]);
type SavedListing = Verdict["listings"][number] & { lastVerifiedAt?: string; needsRecheck?: boolean };

function readListings(value: string): SavedListing[] {
  try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.title === "string" && typeof item.url === "string") : []; }
  catch { return []; }
}

/** Saves a finished scan. Shared by the UI-driven scan and the daily scheduler. */
export async function persistVerdict(prisma: PrismaClient, company: Company, verdict: Verdict) {
  let superseded = false;
  const result = await prisma.$transaction(async (tx) => {
    // Read inside the transaction: a manual scan may have completed since this
    // job took its starting snapshot. Never restore an older snapshot over it.
    const current = await tx.company.findUniqueOrThrow({ where: { id: company.id } });
    const confirmedAt = (row: Company) => confirmedStatuses.has(row.status) ? (row.lastConfirmedAt ?? row.lastScannedAt ?? row.createdAt).getTime() : 0;
    if (confirmedAt(current) > confirmedAt(company)) {
      superseded = true;
      return current;
    }
    const now = new Date();
    const attempt = { lastScannedAt: now, lastAttemptStatus: verdict.status, lastAttemptSummary: verdict.summary };
    if (!confirmedStatuses.has(verdict.status) && confirmedStatuses.has(current.status)) {
      return tx.company.update({ where: { id: company.id }, data: {
        ...attempt, lastConfirmedAt: current.lastConfirmedAt ?? current.lastScannedAt,
      } });
    }
    const confirmed = confirmedStatuses.has(verdict.status);
    const complete = confirmed && (verdict.coverage?.complete ?? verdict.status !== "open");
    const fresh: SavedListing[] = verdict.listings.map((listing) => ({ ...listing, lastVerifiedAt: now.toISOString(), needsRecheck: false }));
    const freshKeys = new Set(fresh.map((listing) => vacancyIdentity(listing.url)));
    const retained = verdict.status === "open" && !complete && current.status === "open"
      ? readListings(current.listings).filter((listing) => !freshKeys.has(vacancyIdentity(listing.url))).map((listing) => ({
          ...listing, needsRecheck: true,
          lastVerifiedAt: listing.lastVerifiedAt ?? (current.lastConfirmedAt ?? current.lastScannedAt)?.toISOString(),
        })) : [];
    const careersUrl = verdict.careersUrl ?? current.careersUrl ??
      verdict.evidence.map((e) => e.url).find((url) => /^https?:/.test(url) && !url.includes("findapprenticeship.service.gov.uk")) ?? null;
    return tx.company.update({ where: { id: company.id }, data: {
      ...attempt, careersUrl, status: verdict.status, summary: verdict.summary,
      listings: JSON.stringify([...fresh, ...retained]), evidence: JSON.stringify(verdict.evidence), checked: verdict.checked,
      lastConfirmedAt: confirmed ? now : null, scanVersion: confirmed ? SCAN_VERSION : current.scanVersion,
      coverageComplete: complete,
    } });
  });
  if (!superseded) await saveScanTrace({ id: company.id, name: company.name }, verdict).catch((error: unknown) => {
    console.error(`[scan] Could not save research trace for company ${company.id}:`, error instanceof Error ? error.message : "unknown error");
  });
  return result;
}

export function persistFailure(prisma: PrismaClient, company: Company, error: unknown) {
  return persistVerdict(prisma, company, {
    status: "error", summary: error instanceof Error ? error.message : "Scan failed",
    listings: [], evidence: [], checked: 0, careersUrl: null,
  });
}

/** Runs a scan to completion with no UI, saving the result. Never throws. */
export async function scanAndSave(prisma: PrismaClient, company: Company): Promise<void> {
  try {
    const scan = runScan(company);
    let step = await scan.next();
    while (!step.done) step = await scan.next();
    await persistVerdict(prisma, company, step.value);
  } catch (error) {
    await persistFailure(prisma, company, error);
  }
}
