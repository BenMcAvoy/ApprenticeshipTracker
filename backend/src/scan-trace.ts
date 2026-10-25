import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Verdict } from "./scan.ts";

/** Keep the latest public research trace per company, outside the source/image. */
export async function saveScanTrace(company: { id: number; name: string }, verdict: Verdict) {
  if (!verdict.diagnostics) return;
  const directory = process.env.SCAN_TRACE_DIR ?? (process.env.NODE_ENV === "production" ? "/data/scan-traces" : path.resolve(import.meta.dirname, "../scan-traces"));
  const research = verdict.diagnostics.research;
  const trace = {
    savedAt: new Date().toISOString(), company,
    verdict: { status: verdict.status, summary: verdict.summary, listings: verdict.listings, evidence: verdict.evidence },
    coverage: verdict.coverage,
    complete: verdict.diagnostics.complete,
    events: verdict.diagnostics.events.slice(-300),
    research: { ...research, pages: research.pages.map((source) => ({ ...source, page: { ...source.page, text: source.page.text.slice(0, 12_000), links: source.page.links.slice(0, 60) } })) },
  };
  await mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `${company.id}-${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(trace, null, 2), { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path.join(directory, `${company.id}.json`));
}
