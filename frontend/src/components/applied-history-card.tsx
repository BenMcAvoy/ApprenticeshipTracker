import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ClipboardList, ExternalLink, Search, Undo2 } from "lucide-react";
import { useState } from "react";
import { useAppliedListings } from "@/hooks/use-applied-listings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useTRPC } from "@/lib/trpc";

export function AppliedHistoryCard() {
  const trpc = useTRPC();
  const { applied, mark } = useAppliedListings();
  const companies = useQuery(trpc.companies.list.queryOptions());
  const names = new Map((companies.data ?? []).map((company) => [company.id, company.name]));
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const entries = (applied.data ?? []).filter((entry) => `${entry.listingTitle} ${names.get(entry.companyId) ?? ""}`.toLowerCase().includes(query));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ClipboardList className="size-4" /> Your applications</CardTitle>
        <CardDescription>Roles you've marked as applied, newest first. Your history stays here after a vacancy disappears. Undo returns a current role to Home.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {applied.isPending && <p role="status" className="text-sm text-muted-foreground">Loading your history…</p>}
        {applied.isError && <p role="alert" className="text-sm text-destructive">{applied.error.message}</p>}
        {mark.isError && <p role="alert" className="text-sm text-destructive">{mark.error.message}</p>}
        {applied.data?.length === 0 && <div className="flex flex-col items-start gap-3 py-5"><p className="text-sm text-muted-foreground">No applications yet. Mark a role as applied on Home after you submit it.</p><Button variant="outline" className="h-11" render={<Link to="/" />}>Browse opportunities</Button></div>}
        {!!applied.data?.length && <>
          <div className="relative"><Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search applications…" aria-label="Search applications" className="h-11 pl-9" /></div>
          <p className="text-xs text-muted-foreground">{query ? `${entries.length} of ` : ""}{applied.data.length} application{applied.data.length === 1 ? "" : "s"}</p>
          {entries.length === 0 && <p className="py-4 text-sm text-muted-foreground">No applications match your search.</p>}
          <ul className="flex flex-col divide-y">
          {entries.map((entry) => (
            <li key={`${entry.companyId}:${entry.listingKey}`} className="flex flex-col items-start gap-2 py-4 first:pt-0 sm:flex-row sm:gap-3">
              <div className="min-w-0 flex-1 text-sm">
                {entry.listingUrl ? <a href={entry.listingUrl} target="_blank" rel="noreferrer" className="break-words font-medium underline-offset-4 hover:underline">{entry.listingTitle} <ExternalLink className="inline size-3 text-muted-foreground" /></a> : <p className="break-words font-medium">{entry.listingTitle}</p>}
                <p className="mt-1 text-xs text-muted-foreground">{names.get(entry.companyId) ?? "Company"} · Applied {new Date(entry.appliedAt).toLocaleDateString("en-GB")}</p>
              </div>
              <Button variant="outline" size="sm" className="h-11 sm:h-8" disabled={mark.isPending} onClick={() => mark.mutate({ companyId: entry.companyId, listingKey: entry.listingKey, applied: false })} aria-label={`Undo applied for ${entry.listingTitle}`}><Undo2 /> Undo applied</Button>
            </li>
          ))}
        </ul></>}
      </CardContent>
    </Card>
  );
}
