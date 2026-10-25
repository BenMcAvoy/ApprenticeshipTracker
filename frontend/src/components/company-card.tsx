import { Collapsible } from "@base-ui/react/collapsible";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ExternalLink, Pencil, RefreshCw } from "lucide-react";
import { listingKey } from "backend/listing-key";
import { useState } from "react";
import { ApplicationDialog } from "@/components/application-dialog";
import { useAuth } from "@/components/auth-provider";
import { OpportunityRow } from "@/components/opportunity-row";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { closingInfo, listingsOf, type Listing, type Tone } from "@/lib/company-filters";
import { useTRPC } from "@/lib/trpc";
import { scanNotice } from "@/lib/scan-notice";
import { cn } from "@/lib/utils";

export type CompanyRow = {
  id: number; name: string; careersUrl: string | null; status: string;
  summary: string | null; listings: string; evidence: string; checked: number;
  lastScannedAt: string | Date | null; lastConfirmedAt?: string | Date | null;
  lastAttemptStatus?: string | null; lastAttemptSummary?: string | null;
  scanVersion?: number; coverageComplete?: boolean;
};

const STATUS: Record<string, string> = { open: "Open", upcoming: "Opening soon", closed: "Closed", none: "No roles", unclear: "Unclear", error: "Error", unscanned: "Not scanned" };
const TONE: Record<Tone, string> = { urgent: "text-destructive", warn: "text-amber-700 dark:text-amber-400", normal: "text-muted-foreground", muted: "text-muted-foreground" };

export function CompanyCard({ company, scanning, disabled, onScan, appliedKeys, onAppliedChange, marking, savingKey }: {
  company: CompanyRow; scanning: boolean; disabled?: boolean; onScan: () => void;
  appliedKeys: Set<string>; onAppliedChange: (listing: Listing, applied: boolean) => void;
  marking?: boolean; savingKey?: string;
}) {
  const { isAdmin } = useAuth();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [url, setUrl] = useState(company.careersUrl ?? "");
  const setUrlMutation = useMutation(trpc.scan.setUrl.mutationOptions({ onSuccess: () => {
    setEditing(false);
    return queryClient.invalidateQueries(trpc.companies.list.queryFilter());
  } }));
  const [tailoring, setTailoring] = useState<{ title: string; url: string } | null>(null);
  const profile = useQuery({ ...trpc.profile.get.queryOptions(), refetchOnWindowFocus: "always" });
  const hasCv = Boolean(profile.data?.cvText.trim());
  const canTailor = company.status === "open";
  const notice = scanNotice(company);
  const status = STATUS[company.status] ?? STATUS.unscanned;
  const listings = listingsOf(company);
  const closing = notice && !listings.length
    ? { tone: "warn" as const, headline: "Needs recheck", detail: undefined }
    : closingInfo(company);
  const evidence: { url: string; quote: string }[] = JSON.parse(company.evidence);

  return (
    <Card className="min-w-0 gap-3">
      <CardHeader className="flex flex-row items-start justify-between gap-3 border-b pb-3">
        <div className="min-w-0 flex-1">
          <CardTitle className="break-words">{company.name}</CardTitle>
          <p className={cn("mt-1 text-xs", company.status === "error" ? "text-destructive" : "text-muted-foreground")}>
            {scanning ? "Scanning…" : notice?.retained ? `${status} (last confirmed)` : status}
            {listings.length > 0 && <span> · {listings.length} {listings.length === 1 ? "role" : "roles"}</span>}
          </p>
        </div>
        {isAdmin && <Button size="icon-sm" variant="ghost" className="size-10 shrink-0 sm:size-8" disabled={scanning || disabled} onClick={onScan} title={`Rescan ${company.name}`} aria-label={`Scan ${company.name}`}><RefreshCw className={scanning ? "animate-spin" : ""} /></Button>}
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {notice && <p className="text-xs text-amber-700 dark:text-amber-400" role="status">{notice.message}</p>}
        {listings.length === 0 && <div className={cn("text-xs", TONE[closing.tone])}>
          <p className="font-medium">{closing.headline.replace(/TODAY|TOMORROW/g, (word) => word.toLowerCase())}</p>
          {closing.detail && <p className="mt-1 text-muted-foreground">{closing.detail}</p>}
        </div>}
        {listings.length > 0 && <ul className="divide-y">
          {listings.map((listing) => {
            const key = listingKey(listing);
            const applied = appliedKeys.has(key);
            return <OpportunityRow key={key} listing={listing} applied={applied} saving={Boolean(marking && savingKey === key)} marking={marking}
              canTailor={canTailor} tailorDisabled={!hasCv || Boolean(notice?.retained) || Boolean(listing.needsRecheck)}
              tailorHint={notice?.retained || listing.needsRecheck ? "Rescan to verify first" : hasCv ? "Tailor CV and write a cover letter" : "Upload your CV in Settings first"}
              onTailor={() => setTailoring({ title: listing.title, url: listing.url! })} onAppliedChange={() => onAppliedChange(listing, !applied)} />;
          })}
        </ul>}
        <Collapsible.Root open={detailsOpen} onOpenChange={setDetailsOpen} className="border-t pt-2">
          <Collapsible.Trigger render={<Button variant="ghost" size="sm" className="h-9 w-full justify-between px-0 text-xs text-muted-foreground hover:bg-transparent" />} aria-label={`Details for ${company.name}`}>
            Details <ChevronDown className={cn("transition-transform", detailsOpen && "rotate-180")} />
          </Collapsible.Trigger>
          <Collapsible.Panel className="pt-3">
            <div className="flex flex-col gap-4 text-xs text-muted-foreground">
              {company.summary && <p className="text-sm leading-relaxed text-foreground">{company.summary}</p>}
              {evidence.length > 0 && <div>
                <h3 className="mb-2 font-medium text-foreground">Sources ({evidence.length})</h3>
                <ul className="flex flex-col gap-3">{evidence.map((item, index) => <li key={index} className="min-w-0 border-l-2 pl-3">
                  <q className="leading-relaxed">{item.quote}</q>
                  <a className="mt-1 block break-all underline underline-offset-2" href={item.url.startsWith("http") ? item.url : undefined} target="_blank" rel="noreferrer">{item.url}</a>
                </li>)}</ul>
              </div>}
              {isAdmin && editing ? <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); setUrlMutation.mutate({ id: company.id, careersUrl: url.trim() || null }); }}>
                <Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://" aria-label={`Careers URL for ${company.name}`} className="h-9 basis-full" />
                <Button type="submit" size="sm" disabled={setUrlMutation.isPending}>Save</Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
              </form> : <div className="flex items-center justify-between gap-2">
                {company.careersUrl ? <a className="min-w-0 truncate underline-offset-4 hover:underline" href={company.careersUrl} target="_blank" rel="noreferrer" title={company.careersUrl}>Careers page <ExternalLink className="ml-1 inline size-3" /></a> : <span>No careers page</span>}
                {isAdmin && <Button size="icon-sm" variant="ghost" onClick={() => { setUrl(company.careersUrl ?? ""); setEditing(true); }} title="Edit careers page" aria-label={`Edit careers page for ${company.name}`}><Pencil /></Button>}
              </div>}
              {setUrlMutation.isError && <Badge variant="destructive">{setUrlMutation.error.message}</Badge>}
              <div className="flex flex-col gap-1">
                {company.lastScannedAt && <p>Checked {new Date(company.lastScannedAt).toLocaleDateString("en-GB")}</p>}
                {company.lastConfirmedAt && <p>Confirmed {new Date(company.lastConfirmedAt).toLocaleDateString("en-GB")}</p>}
              </div>
              {company.lastAttemptSummary && notice?.retained && <p>{company.lastAttemptSummary}</p>}
            </div>
          </Collapsible.Panel>
        </Collapsible.Root>
        {tailoring && <ApplicationDialog open onOpenChange={(open) => !open && setTailoring(null)} companyId={company.id} company={company.name} listing={tailoring} />}
      </CardContent>
    </Card>
  );
}
