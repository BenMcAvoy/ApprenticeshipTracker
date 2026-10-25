import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ExternalLink, Search, Undo2 } from "lucide-react";
import { useState } from "react";
import { useAppliedListings } from "@/hooks/use-applied-listings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTRPC } from "@/lib/trpc";

export function AppliedHistoryCard() {
  const trpc = useTRPC();
  const { applied, mark } = useAppliedListings();
  const companies = useQuery(trpc.companies.list.queryOptions());
  const names = new Map((companies.data ?? []).map((company) => [company.id, company.name]));
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const entries = (applied.data ?? []).filter((entry) => `${entry.listingTitle} ${names.get(entry.companyId) ?? ""}`.toLowerCase().includes(query));

  if (applied.isPending) return <p role="status" className="text-sm text-muted-foreground">Loading…</p>;
  if (applied.isError) return <p role="alert" className="text-sm text-destructive">{applied.error.message}</p>;

  if (!applied.data?.length) {
    return (
      <div className="flex flex-col items-start gap-3 py-2">
        <p className="text-sm text-muted-foreground">No applications yet.</p>
        <Button variant="outline" size="sm" render={<Link to="/" />}>Browse roles</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {mark.isError && <p role="alert" className="text-sm text-destructive">{mark.error.message}</p>}
      <div className="flex items-center gap-3">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search" aria-label="Search applications" className="h-9 pl-9" />
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">{query ? `${entries.length} of ` : ""}{applied.data.length}</span>
      </div>

      {entries.length === 0 && <p className="text-sm text-muted-foreground">No matches.</p>}
      <ul className="flex flex-col divide-y">
        {entries.map((entry) => (
          <li key={`${entry.companyId}:${entry.listingKey}`} className="flex items-center gap-3 py-3 first:pt-0">
            <div className="min-w-0 flex-1 text-sm">
              {entry.listingUrl ? (
                <a href={entry.listingUrl} target="_blank" rel="noreferrer" className="break-words font-medium underline-offset-4 hover:underline">
                  {entry.listingTitle} <ExternalLink className="inline size-3 text-muted-foreground" />
                </a>
              ) : (
                <p className="break-words font-medium">{entry.listingTitle}</p>
              )}
              <p className="text-xs text-muted-foreground">
                {names.get(entry.companyId) ?? "Unknown"} · {new Date(entry.appliedAt).toLocaleDateString("en-GB")}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={mark.isPending}
              onClick={() => mark.mutate({ companyId: entry.companyId, listingKey: entry.listingKey, applied: false })}
              aria-label={`Undo applied for ${entry.listingTitle}`}
            >
              <Undo2 /> Undo
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
