import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { listingKey } from "backend/listing-key";
import { CompanyCard } from "@/components/company-card";
import { ExportDialog } from "@/components/export-dialog";
import { FilterBar } from "@/components/filter-bar";
import { HeaderActions } from "@/components/header-actions";
import { MasonryGrid } from "@/components/masonry-grid";
import { Button } from "@/components/ui/button";
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
  tagRouteName,
} from "@/lib/company-filters";
import { useTRPC } from "@/lib/trpc";
import { useAppliedListings } from "@/hooks/use-applied-listings";

export const Route = createFileRoute("/")({
  component: Home,
  validateSearch: (search): FilterSearch => ({
    q: typeof search.q === "string" ? search.q : undefined,
    sort: typeof search.sort === "string" ? search.sort : undefined,
    soon: search.soon === true || search.soon === "true" ? true : undefined,
    showApplied: search.showApplied === true || search.showApplied === "true" ? true : undefined,
    location: typeof search.location === "string" ? search.location : undefined,
    startYear: typeof search.startYear === "number" ? search.startYear : undefined,
    salaryMin: typeof search.salaryMin === "number" ? search.salaryMin : undefined,
    salaryMax: typeof search.salaryMax === "number" ? search.salaryMax : undefined,
    routes: typeof search.routes === "string" ? search.routes.split("|").filter(Boolean) : Array.isArray(search.routes) ? search.routes.filter((item): item is string => typeof item === "string") : undefined,
    levels: typeof search.levels === "string" ? search.levels.split("|").map(Number).filter(Number.isFinite) : Array.isArray(search.levels) ? search.levels.map(Number).filter(Number.isFinite) : undefined,
    page: typeof search.page === "number" ? Math.max(1, search.page) : undefined,
  }),
  beforeLoad: ({ search }) => { if (search.showApplied) throw redirect({ to: "/applications" }); },
});

function Home() {
  const { applied, mark } = useAppliedListings();
  const [lastMarked, setLastMarked] = useState<{ companyId: number; listingKey: string; title: string } | null>(null);
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const filters = { ...filtersFromSearch(search), showApplied: false };
  const setFilters = (next: Filters) => {
    const page = next.page === filters.page ? 1 : next.page;
    void navigate({ search: searchFromFilters({ ...next, page }), replace: true });
  };
  const trpc = useTRPC();
  const routeKey = filters.routes.join("\u0000");
  const levelKey = filters.levels.join("\u0000");
  const requestInput = useMemo(() => ({
    q: filters.q,
    location: filters.location,
    routes: routeKey ? routeKey.split("\u0000").map(tagRouteName) : [],
    courseLevels: levelKey ? levelKey.split("\u0000").map(Number) : [],
    salaryMin: filters.salaryMin,
    salaryMax: filters.salaryMax,
    startYear: filters.startYear,
    sort: filters.sort,
    page: filters.page,
  }), [filters.q, filters.location, routeKey, levelKey, filters.salaryMin, filters.salaryMax, filters.startYear, filters.sort, filters.page]);
  const [liveSearch, setLiveSearch] = useState(requestInput);
  useEffect(() => {
    const timer = window.setTimeout(() => setLiveSearch(requestInput), 350);
    return () => window.clearTimeout(timer);
  }, [requestInput]);
  const feed = useQuery(trpc.vacancies.search.queryOptions(liveSearch, {
    staleTime: 60_000,
    placeholderData: (previous) => previous,
  }));
  const sourceCompanies = feed.data?.companies ?? [];
  const personalList = applyAppliedVisibility(sourceCompanies, applied.data ?? [], false);
  const visible = applyFilters(personalList, filters);
  const appliedKeys = new Map<number, Set<string>>();
  for (const entry of applied.data ?? []) {
    if (!appliedKeys.has(entry.companyId)) appliedKeys.set(entry.companyId, new Set());
    appliedKeys.get(entry.companyId)!.add(entry.listingKey);
  }
  const markListing = (companyId: number, listing: Listing, value: boolean) => mark.mutate(
    { companyId, listingKey: listingKey(listing), applied: value },
    { onSuccess: () => setLastMarked(value ? { companyId, listingKey: listingKey(listing), title: listing.title } : null) },
  );

  if (feed.isPending || applied.isPending) return <p role="status" className="text-sm text-muted-foreground">Loading vacancies…</p>;
  if (feed.isError || applied.isError) return (
    <div className="flex flex-col items-start gap-3">
      <p role="alert" className="text-sm text-destructive">{feed.error?.message || applied.error?.message}</p>
      <Button variant="outline" onClick={() => { void feed.refetch(); void applied.refetch(); }}>Try again</Button>
    </div>
  );

  return (
    <div className="@container flex flex-col gap-4">
      <HeaderActions>{visible.length > 0 && <ExportDialog companies={visible} />}</HeaderActions>
      {feed.data.liveError && <p role="status" className="text-xs text-muted-foreground">TAG live results are unavailable: {feed.data.liveError} Showing the saved snapshot.</p>}

      {mark.isError && <p role="alert" className="text-sm text-destructive">{mark.error.message}</p>}
      {lastMarked && (
        <div role="status" className="flex items-center gap-3 text-sm">
          <span className="min-w-0 truncate text-muted-foreground">Marked applied: {lastMarked.title}</span>
          <Button size="xs" variant="ghost" disabled={mark.isPending} onClick={() => mark.mutate({ companyId: lastMarked.companyId, listingKey: lastMarked.listingKey, applied: false }, { onSuccess: () => setLastMarked(null) })}>Undo</Button>
        </div>
      )}

      {feed.data && <FilterBar filters={filters} onChange={setFilters} shown={visible.length} total={feed.data.total} listings={visible.reduce((total, c) => total + listingsOf(c).length, 0)} page={feed.data.page} totalPages={feed.data.totalPages} onPageChange={(page) => setFilters({ ...filters, page })}>
        {visible.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-12 text-center text-sm text-muted-foreground">
            <p>{!sourceCompanies.length ? "No vacancies match these filters." : !personalList.length ? "All vacancies marked as applied." : "No matches."}</p>
            <Button variant="outline" size="sm" onClick={() => setFilters(DEFAULT_FILTERS)}>Reset filters</Button>
            {!personalList.length && <Button variant="link" render={<Link to="/applications" />}>View applications</Button>}
          </div>
        )}
        <MasonryGrid>
          {visible.map((company) => (
            <CompanyCard
              key={company.id}
              company={company}
              appliedKeys={appliedKeys.get(company.id) ?? new Set()}
              onAppliedChange={(listing, value) => markListing(company.id, listing, value)}
              marking={mark.isPending}
              savingKey={mark.isPending && mark.variables?.companyId === company.id ? mark.variables.listingKey : undefined}
            />
          ))}
        </MasonryGrid>
      </FilterBar>}
    </div>
  );
}
