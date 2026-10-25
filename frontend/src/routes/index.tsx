import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { ChevronDown, PanelBottom, Radar } from "lucide-react";
import { useState } from "react";
import { listingKey } from "backend/listing-key";
import { useAuth } from "@/components/auth-provider";
import { useAppliedListings } from "@/hooks/use-applied-listings";
import { AddCompaniesDialog } from "@/components/add-companies-dialog";
import { CompanyCard } from "@/components/company-card";
import { ExportDialog } from "@/components/export-dialog";
import { FilterBar } from "@/components/filter-bar";
import { HeaderActions } from "@/components/header-actions";
import { MasonryGrid } from "@/components/masonry-grid";
import { useManualScanAccess } from "@/hooks/use-manual-scan-access";
import { type CompanyScan, ScanPanel, type ScanEventView } from "@/components/scan-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  applyFilters,
  applyAppliedVisibility,
  listingsOf,
  type Listing,
  DEFAULT_FILTERS,
  type FilterSearch,
  type Filters,
  filtersFromSearch,
  searchFromFilters,
  type Status,
  STATUSES,
} from "@/lib/company-filters";
import { manualTrpcClient, useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/")({
  component: Home,
  // Filters live in the URL so a filtered view survives refreshes and can be bookmarked.
  validateSearch: (search): FilterSearch => ({
    q: typeof search.q === "string" ? search.q : undefined,
    status: typeof search.status === "string" ? search.status : undefined,
    sort: typeof search.sort === "string" ? search.sort : undefined,
    soon: search.soon === true || search.soon === "true" ? true : undefined,
    showApplied: search.showApplied === true || search.showApplied === "true" ? true : undefined,
  }),
  beforeLoad: ({ search }) => { if (search.showApplied) throw redirect({ to: "/applications" }); },
});

const CONCURRENCY = 3;

function Home() {
  const { isAdmin } = useAuth();
  const { applied, mark } = useAppliedListings();
  const [lastMarked, setLastMarked] = useState<{ companyId: number; listingKey: string; title: string } | null>(null);
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const filters = { ...filtersFromSearch(search), showApplied: false };
  const setFilters = (next: Filters) => void navigate({ search: searchFromFilters(next), replace: true });
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const companies = useQuery(trpc.companies.list.queryOptions());
  const refresh = () => queryClient.invalidateQueries(trpc.companies.list.queryFilter());
  const importCompanies = useMutation(trpc.companies.import.mutationOptions({ onSuccess: refresh }));

  const [scans, setScans] = useState<CompanyScan[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const scanAccess = useManualScanAccess();

  const update = (id: number, fn: (scan: CompanyScan) => CompanyScan) =>
    setScans((all) => all.map((s) => (s.id === id ? fn(s) : s)));

  const apply = (scan: CompanyScan, event: ScanEventView): CompanyScan => ({
    ...scan,
    progress: event.progress,
    message: event.message,
    events: [...scan.events, event],
    troubled:
      event.level === "warn" && event.stage !== "done" && !scan.troubled.includes(event.stage)
        ? [...scan.troubled, event.stage]
        : scan.troubled,
    result: event.result ?? scan.result,
    state: event.progress >= 100 ? "finished" : "running",
  });

  /** Streams one company's scan into the panel; resolves when it finishes. */
  function scanCompany(id: number) {
    update(id, (s) => ({ ...s, state: "running" }));
    return new Promise<void>((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        sub.unsubscribe();
        update(id, (s) => (s.state === "finished" ? s : { ...s, state: "finished", progress: 100 }));
        void refresh();
        resolve();
      };
      const sub = manualTrpcClient.scan.run.subscribe(
        { id },
        {
          onData: (event) => {
            update(id, (s) => apply(s, event));
            if (event.progress >= 100) finish();
          },
          onError: (error) => {
            update(id, (s) =>
              apply(s, {
                stage: "done",
                level: "error",
                message: error.message,
                progress: 100,
                result: { status: "error", listings: 0 },
              }),
            );
            finish();
          },
          onComplete: finish,
        },
      );
    });
  }

  const runScans = (targets: { id: number; name: string }[]) => void scanAccess.run(() => startScans(targets));

  async function startScans(targets: { id: number; name: string }[]) {
    setScans(
      targets.map((t) => ({
        id: t.id,
        name: t.name,
        state: "queued",
        progress: 0,
        message: "Waiting…",
        troubled: [],
        events: [],
      })),
    );
    setPanelOpen(true);
    const queue = [...targets];
    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) await scanCompany(next.id);
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));
  }

  const list = companies.data ?? [];
  const personalList = applyAppliedVisibility(list, applied.data ?? [], false);
  // Never scanned, versus scanned by the old pipeline or failed (no sources recorded, so no proof behind the result).
  const unscanned = list.filter((c) => c.lastScannedAt === null);
  const unverified = list.filter((c) => c.lastScannedAt !== null && c.checked === 0);
  const counts = Object.fromEntries(STATUSES.map((s) => [s, personalList.filter((c) => c.status === s).length])) as Record<Status, number>;
  const visible = applyFilters(personalList, filters);
  const busy = scanAccess.busy || scans.some((s) => s.state !== "finished");
  const runningIds = new Set(scans.filter((s) => s.state === "running").map((s) => s.id));
  const appliedKeys = new Map<number, Set<string>>();
  for (const entry of applied.data ?? []) {
    if (!appliedKeys.has(entry.companyId)) appliedKeys.set(entry.companyId, new Set());
    appliedKeys.get(entry.companyId)!.add(entry.listingKey);
  }
  const markListing = (companyId: number, listing: Listing, value: boolean) => mark.mutate(
    { companyId, listingKey: listingKey(listing), applied: value },
    { onSuccess: () => setLastMarked(value ? { companyId, listingKey: listingKey(listing), title: listing.title } : null) },
  );

  if (companies.isPending || applied.isPending) return <p role="status" className="text-sm text-muted-foreground">Loading…</p>;
  if (companies.isError || applied.isError) return (
    <div className="flex flex-col items-start gap-3">
      <p role="alert" className="text-sm text-destructive">{companies.error?.message || applied.error?.message}</p>
      <Button variant="outline" onClick={() => { void companies.refetch(); void applied.refetch(); }}>Try again</Button>
    </div>
  );

  return (
    <div className="@container flex flex-col gap-4">
      {scanAccess.dialog}
      <HeaderActions>
        {isAdmin && scans.length > 0 && (
          <Button variant="ghost" size="sm" className="h-11 md:h-7" aria-label="Scans" title="Scans" onClick={() => setPanelOpen((o) => !o)}>
            <PanelBottom /><span className="hidden md:inline">Scans</span>
          </Button>
        )}
        {list.length > 0 && <ExportDialog companies={visible} />}
        {isAdmin && <><AddCompaniesDialog
          pending={importCompanies.isPending}
          onAdd={(companies) => importCompanies.mutateAsync({ companies })}
        />
        <div className="flex">
          <Button size="sm" className="h-11 rounded-r-none md:h-7" aria-label="Scan all companies" disabled={!list.length || busy} onClick={() => runScans(list)}>
            <Radar /><span className="hidden md:inline">Scan all</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button size="icon-sm" className="size-11 rounded-l-none border-l border-primary-foreground/20 md:size-7" disabled={busy} title="More scan options" aria-label="More scan options" />}
            >
              <ChevronDown />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={unscanned.length === 0} onClick={() => runScans(unscanned)}>
                Scan unscanned ({unscanned.length})
              </DropdownMenuItem>
              <DropdownMenuItem disabled={unverified.length === 0} onClick={() => runScans(unverified)}>
                Rescan unverified ({unverified.length})
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div></>}
      </HeaderActions>

      {isAdmin && <ScanPanel scans={scans} open={panelOpen} onClose={() => setPanelOpen(false)} />}

      {mark.isError && <p role="alert" className="text-sm text-destructive">{mark.error.message}</p>}
      {lastMarked && (
        <div role="status" className="flex items-center gap-3 text-sm">
          <span className="min-w-0 truncate text-muted-foreground">Marked applied: {lastMarked.title}</span>
          <Button size="xs" variant="ghost" disabled={mark.isPending} onClick={() => mark.mutate({ companyId: lastMarked.companyId, listingKey: lastMarked.listingKey, applied: false }, { onSuccess: () => setLastMarked(null) })}>Undo</Button>
        </div>
      )}

      {importCompanies.data && (
        <p className="text-sm text-muted-foreground">Added {importCompanies.data.added}.</p>
      )}
      {importCompanies.isError && <Badge variant="destructive">{importCompanies.error.message}</Badge>}

      {companies.data && list.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {isAdmin ? "No companies yet. Add some to get started." : "Nothing here yet."}
        </p>
      )}

      {list.length > 0 && <FilterBar filters={filters} onChange={setFilters} counts={counts} shown={visible.length} total={personalList.length} listings={visible.reduce((total, c) => total + listingsOf(c).length, 0)} />}

      {list.length > 0 && visible.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-12 text-center text-sm text-muted-foreground">
          <p>{!personalList.length ? "All applied." : "No matches."}</p>
          <Button variant="outline" size="sm" onClick={() => setFilters(DEFAULT_FILTERS)}>
            Reset filters
          </Button>
          {!personalList.length && <Button variant="link" render={<Link to="/applications" />}>View applications</Button>}
        </div>
      )}

      <MasonryGrid>
        {visible.map((c) => (
          <CompanyCard
            key={c.id}
            company={c}
            scanning={runningIds.has(c.id)}
            disabled={busy}
            onScan={() => runScans([c])}
            appliedKeys={appliedKeys.get(c.id) ?? new Set()}
            onAppliedChange={(listing, value) => markListing(c.id, listing, value)}
            marking={mark.isPending}
            savingKey={mark.isPending && mark.variables?.companyId === c.id ? mark.variables.listingKey : undefined}
          />
        ))}
      </MasonryGrid>
    </div>
  );
}
