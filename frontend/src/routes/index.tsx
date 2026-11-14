import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";
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
  }),
  beforeLoad: ({ search }) => { if (search.showApplied) throw redirect({ to: "/applications" }); },
});

function Home() {
  const { applied, mark } = useAppliedListings();
  const [lastMarked, setLastMarked] = useState<{ companyId: number; listingKey: string; title: string } | null>(null);
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const filters = { ...filtersFromSearch(search), showApplied: false };
  const setFilters = (next: Filters) => void navigate({ search: searchFromFilters(next), replace: true });
  const trpc = useTRPC();
  const feed = useQuery(trpc.vacancies.list.queryOptions());
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
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <p>
          Vacancies from <a className="underline underline-offset-2" href="https://www.theapprenticeguide.net/apprenticeships?routes=Digital&levels=6-7&salaryMin=20000&startYear=2027" target="_blank" rel="noreferrer">The Apprentice Guide</a>
          {` · ${feed.data.total} roles`}
        </p>
        <p>Imported {new Date(feed.data.fetchedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</p>
      </div>

      {mark.isError && <p role="alert" className="text-sm text-destructive">{mark.error.message}</p>}
      {lastMarked && (
        <div role="status" className="flex items-center gap-3 text-sm">
          <span className="min-w-0 truncate text-muted-foreground">Marked applied: {lastMarked.title}</span>
          <Button size="xs" variant="ghost" disabled={mark.isPending} onClick={() => mark.mutate({ companyId: lastMarked.companyId, listingKey: lastMarked.listingKey, applied: false }, { onSuccess: () => setLastMarked(null) })}>Undo</Button>
        </div>
      )}

      {sourceCompanies.length > 0 && <FilterBar filters={filters} onChange={setFilters} shown={visible.length} total={sourceCompanies.length} listings={visible.reduce((total, c) => total + listingsOf(c).length, 0)} />}
      {sourceCompanies.length > 0 && visible.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-12 text-center text-sm text-muted-foreground">
          <p>{!personalList.length ? "All vacancies marked as applied." : "No matches."}</p>
          <Button variant="outline" size="sm" onClick={() => setFilters(DEFAULT_FILTERS)}>Reset filters</Button>
          {!personalList.length && <Button variant="link" render={<Link to="/applications" />}>View applications</Button>}
        </div>
      )}
      {!sourceCompanies.length && <p className="text-sm text-muted-foreground">No vacancies are available in this feed.</p>}
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
    </div>
  );
}
