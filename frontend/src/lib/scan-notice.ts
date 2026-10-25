import type { CompanyRow } from "@/components/company-card";

export function scanNotice(company: CompanyRow): { retained: boolean; message: string } | null {
  if (["unclear", "error"].includes(company.lastAttemptStatus ?? "") && ["open", "upcoming", "closed", "none"].includes(company.status)) {
    const at = company.lastConfirmedAt ? ` on ${new Date(company.lastConfirmedAt).toLocaleDateString()}` : "";
    return { retained: true, message: `Latest check was inconclusive. Showing the result last confirmed${at}; availability needs rechecking.` };
  }
  if (company.status === "open" && (company.scanVersion ?? 0) >= 2 && company.coverageComplete === false) {
    return { retained: false, message: "Verified roles found; the vacancy search is incomplete. Additional roles may exist." };
  }
  if (company.scanVersion === 0 && ["none", "closed"].includes(company.status)) {
    return { retained: false, message: "Older result; awaiting a fresh check." };
  }
  return null;
}
