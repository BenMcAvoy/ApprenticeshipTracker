import type { ReactNode } from "react";
import { CLOSING_SOON_DAYS, DEFAULT_FILTERS, type Filters, isFiltered, SORT_LABEL, SORTS, type Sort } from "@/lib/company-filters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const SECTORS = ["Education and early years", "Health and science", "Business", "Engineering", "Hospitality", "Sales and marketing", "Digital", "Legal and finance", "Construction", "Care", "Transport", "Agriculture", "Creative", "Hair and beauty", "Protective"];
const YEARS = [2026, 2027, 2028, 2029, 2030];
const LEVELS = [2, 3, 4, 5, 6, 7];
const SALARIES = [0, 10000, 15000, 20000, 25000, 30000, 40000, 50000];
const money = (value: number) => value === 0 ? "No minimum" : `£${Math.round(value / 1000)}k`;

export function FilterBar({ filters, onChange, shown, total, listings, page, totalPages, onPageChange, children }: {
  filters: Filters; onChange: (next: Filters) => void; shown: number; total: number; listings: number; page: number; totalPages: number; onPageChange: (page: number) => void; children?: ReactNode;
}) {
  const toggle = <T,>(values: T[], value: T) => values.includes(value) ? values.filter((item) => item !== value) : [...values, value];

  return (
    <section className="w-full min-w-0">
      <div className="mb-4 flex flex-col gap-3">
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
          <Input value={filters.q} onChange={(event) => onChange({ ...filters, q: event.target.value })} placeholder="Search role, company or keyword" className="h-11 min-w-0 flex-1 rounded-full bg-muted/60 px-4" aria-label="Search role, company or keyword" />
          <label className="flex h-10 shrink-0 items-center gap-2 rounded-md border px-3 text-sm text-muted-foreground"><span>Sort:</span><select className="min-w-28 bg-transparent font-medium text-foreground outline-none" value={filters.sort} onChange={(event) => onChange({ ...filters, sort: event.target.value as Sort })} aria-label="Sort results">{SORTS.map((sort) => <option key={sort} value={sort}>{SORT_LABEL[sort]}</option>)}</select></label>
        </div>

        <div className="grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
          <Input value={filters.location} onChange={(event) => onChange({ ...filters, location: event.target.value })} placeholder="Town, city or postcode" aria-label="Location" className="h-10" />
          <select className="h-10 rounded-md border bg-background px-3 text-sm" aria-label="Start year" value={filters.startYear ?? ""} onChange={(event) => onChange({ ...filters, startYear: event.target.value ? Number(event.target.value) : null })}>
            <option value="">Any start year</option>{YEARS.map((year) => <option key={year} value={year}>{year}</option>)}
          </select>
          <select className="h-10 rounded-md border bg-background px-3 text-sm" aria-label="Minimum salary" value={filters.salaryMin ?? ""} onChange={(event) => onChange({ ...filters, salaryMin: event.target.value ? Number(event.target.value) : null })}>
            <option value="">No min salary</option>{SALARIES.map((salary) => <option key={salary} value={salary}>{money(salary)}</option>)}
          </select>
          <select className="h-10 rounded-md border bg-background px-3 text-sm" aria-label="Maximum salary" value={filters.salaryMax ?? ""} onChange={(event) => onChange({ ...filters, salaryMax: event.target.value ? Number(event.target.value) : null })}>
            <option value="">No max salary</option>{SALARIES.filter((salary) => salary > 0).map((salary) => <option key={salary} value={salary}>{money(salary)}</option>)}
          </select>

          <details className="group relative min-w-0">
            <summary className="flex h-10 cursor-pointer list-none items-center justify-between rounded-md border bg-background px-3 text-sm marker:hidden">
              <span className="truncate">Sector{filters.routes.length ? ` · ${filters.routes.length}` : ""}</span><span className="ml-2 text-muted-foreground">⌄</span>
            </summary>
            <div className="absolute left-0 top-11 z-30 max-h-72 w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border bg-popover p-2 shadow-lg">
              {SECTORS.map((sector) => <label key={sector} className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm hover:bg-muted">
                <input type="checkbox" checked={filters.routes.includes(sector)} onChange={() => onChange({ ...filters, routes: toggle(filters.routes, sector) })} className="accent-primary" /><span>{sector}</span>
              </label>)}
            </div>
          </details>

          <details className="group relative min-w-0">
            <summary className="flex h-10 cursor-pointer list-none items-center justify-between rounded-md border bg-background px-3 text-sm marker:hidden">
              <span className="truncate">Level{filters.levels.length ? ` · ${filters.levels.length}` : ""}</span><span className="ml-2 text-muted-foreground">⌄</span>
            </summary>
            <div className="absolute left-0 top-11 z-30 w-56 rounded-lg border bg-popover p-2 shadow-lg">
              {LEVELS.map((level) => <label key={level} className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm hover:bg-muted">
                <input type="checkbox" checked={filters.levels.includes(level)} onChange={() => onChange({ ...filters, levels: toggle(filters.levels, level) })} className="accent-primary" /><span>Level {level}</span>
              </label>)}
            </div>
          </details>

          <label className="flex h-10 items-center gap-2 rounded-md border px-3 text-sm"><input type="checkbox" checked={filters.soon} onChange={(event) => onChange({ ...filters, soon: event.target.checked })} />Closing within {CLOSING_SOON_DAYS} days</label>
        </div>

        <div className="flex min-h-8 flex-wrap items-center gap-1.5">
          {filters.routes.map((route) => <span key={route} className="rounded-full bg-muted px-2.5 py-1 text-xs">{route}<button className="ml-1.5 text-muted-foreground" aria-label={`Remove ${route} sector`} onClick={() => onChange({ ...filters, routes: filters.routes.filter((item) => item !== route) })}>×</button></span>)}
          {filters.levels.length > 0 && <span className="rounded-full bg-muted px-2.5 py-1 text-xs">Level {filters.levels.slice().sort((a, b) => a - b).join(", ")}<button className="ml-1.5 text-muted-foreground" aria-label="Clear levels" onClick={() => onChange({ ...filters, levels: [] })}>×</button></span>}
          {filters.salaryMin !== null && <span className="rounded-full bg-muted px-2.5 py-1 text-xs">min {money(filters.salaryMin)}<button className="ml-1.5 text-muted-foreground" aria-label="Clear minimum salary" onClick={() => onChange({ ...filters, salaryMin: null })}>×</button></span>}
          {filters.salaryMax !== null && <span className="rounded-full bg-muted px-2.5 py-1 text-xs">max {money(filters.salaryMax)}<button className="ml-1.5 text-muted-foreground" aria-label="Clear maximum salary" onClick={() => onChange({ ...filters, salaryMax: null })}>×</button></span>}
          {filters.startYear !== null && <span className="rounded-full bg-muted px-2.5 py-1 text-xs">Starts {filters.startYear}<button className="ml-1.5 text-muted-foreground" aria-label="Clear start year" onClick={() => onChange({ ...filters, startYear: null })}>×</button></span>}
          {filters.location && <span className="rounded-full bg-muted px-2.5 py-1 text-xs">{filters.location}<button className="ml-1.5 text-muted-foreground" aria-label="Clear location" onClick={() => onChange({ ...filters, location: "" })}>×</button></span>}
          {isFiltered(filters) && <Button variant="link" size="xs" className="ml-auto text-muted-foreground" onClick={() => onChange(DEFAULT_FILTERS)}>Reset defaults</Button>}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3 text-sm">
          <p><strong>{total}</strong> {total === 1 ? "apprenticeship" : "apprenticeships"}<span className="ml-2 text-xs text-muted-foreground">{listings} on this page · {shown} employers</span></p>
          {totalPages > 1 && <nav className="flex items-center gap-2" aria-label="Vacancy pages">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>Previous</Button>
            <span className="min-w-20 text-center text-xs text-muted-foreground">{page} / {totalPages}</span>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>Next</Button>
          </nav>}
        </div>
      </div>
      {children}
    </section>
  );
}
