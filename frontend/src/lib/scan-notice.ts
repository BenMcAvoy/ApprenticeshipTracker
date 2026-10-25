import type { CompanyRow } from "@/components/company-card";

export function scanNotice(company: CompanyRow): { retained: boolean; message: string } | null {
  if (["unclear", "error"].includes(company.lastAttemptStatus ?? "") && ["open", "upcoming", "closed", "none"].includes(company.status)) {
    return { retained: true, message: "Recheck failed. Showing last confirmed result." };
  }
  if (company.status === "open" && (company.scanVersion ?? 0) >= 2 && company.coverageComplete === false) {
    return { retained: false, message: "Search incomplete. More roles may exist." };
  }
  if (company.scanVersion === 0 && ["none", "closed"].includes(company.status)) {
    return { retained: false, message: "Older result. Recheck needed." };
  }
  return null;
}
