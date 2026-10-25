import type { CompanyRow } from "@/components/company-card";
import { STATUS_LABEL, type Status } from "@/lib/company-filters";

type Listing = { title: string; url: string | null; location?: string; closes?: string };

const listingsOf = (c: CompanyRow): Listing[] => {
  try {
    return JSON.parse(c.listings);
  } catch {
    return [];
  }
};

/** Rows to export: every listing with an apply link, or (when not restricted) a careers-page row for other companies. */
type Row = { company: string; status: string; role: string; location: string; closes: string; link: string };

function toRows(companies: CompanyRow[], openOnly: boolean): Row[] {
  const rows: Row[] = [];
  for (const c of companies) {
    const status = STATUS_LABEL[c.status as Status] ?? c.status;
    const links = listingsOf(c).filter((l) => l.url);
    if (c.status === "open" && links.length) {
      for (const l of links) {
        rows.push({ company: c.name, status, role: l.title, location: l.location ?? "", closes: l.closes ?? "", link: l.url! });
      }
    } else if (!openOnly && c.careersUrl) {
      rows.push({ company: c.name, status, role: "", location: "", closes: "", link: c.careersUrl });
    }
  }
  return rows;
}

export function buildExport(companies: CompanyRow[], openOnly: boolean) {
  const rows = toRows(companies, openOnly);
  const byCompany = new Map<string, Row[]>();
  for (const r of rows) byCompany.set(r.company, [...(byCompany.get(r.company) ?? []), r]);

  const date = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const lines = [`Apprenticeship list, ${date}`, `${byCompany.size} ${byCompany.size === 1 ? "company" : "companies"}, ${rows.length} ${rows.length === 1 ? "link" : "links"}`];

  for (const [company, items] of byCompany) {
    lines.push("", company.toUpperCase());
    for (const r of items) {
      if (r.role) {
        lines.push(`- ${r.role}${r.location ? `, ${r.location}` : ""}${r.closes ? ` (closes ${r.closes})` : ""}`, `  ${r.link}`);
      } else {
        lines.push(`- ${r.status}, careers page`, `  ${r.link}`);
      }
    }
  }

  const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const csv = [
    ["Company", "Status", "Role", "Location", "Closes", "Link"],
    ...rows.map((r) => [r.company, r.status, r.role, r.location, r.closes, r.link]),
  ]
    .map((row) => row.map(csvCell).join(","))
    .join("\n");

  return { text: lines.join("\n"), csv, companies: byCompany.size, links: rows.length };
}
