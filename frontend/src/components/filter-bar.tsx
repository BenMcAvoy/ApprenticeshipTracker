import { useState, type ReactNode } from "react";
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
  const [mobileOpen, setMobileOpen] = useState(false);
  const toggle = <T,>(values: T[], value: T) => values.includes(value) ? values.filter((item) => item !== value) : [...values, value];

  return (
    <div className="grid min-w-0 gap-5 lg:grid-cols-[250px_minmax(0,1fr)] xl:grid-cols-[270px_minmax(0,1fr)]">
      <button type="button" className="flex h-10 items-center justify-between rounded-lg border bg-card px-3 text-sm lg:hidden" onClick={() => setMobileOpen(!mobileOpen)} aria-expanded={mobileOpen}>
        <span>Filters{isFiltered(filters) ? " · Active" : ""}</span><span className="text-muted-foreground">{mobileOpen ? "Hide" : "Show"}</span>
      </button>
      <aside className={`${mobileOpen ? "block" : "hidden"} rounded-xl border bg-card p-4 lg:block lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:sticky lg:top-4`}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Filters</h2>
          <Button variant="link" size="xs" className="h-auto p-0 text-muted-foreground" onClick={() => onChange(DEFAULT_FILTERS)}>Reset defaults</Button>
        </div>

        <section className="mb-5">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Location</h3>
          <Input value={filters.location} onChange={(event) => onChange({ ...filters, location: event.target.value })} placeholder="Town, city or postcode" aria-label="Location" className="h-9" />
        </section>

        <section className="mb-5">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Start year</h3>
          <select className="h-9 rounded-md border bg-background px-2 text-sm" aria-label="Start year" value={filters.startYear ?? ""} onChange={(event) => onChange({ ...filters, startYear: event.target.value ? Number(event.target.value) : null })}>
            <option value="">Any year</option>{YEARS.map((year) => <option key={year} value={year}>{year}</option>)}
          </select>
        </section>

        <section className="mb-5">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Salary range</h3>
          <div className="flex items-center gap-2">
            <select className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm" aria-label="Minimum salary" value={filters.salaryMin ?? ""} onChange={(event) => onChange({ ...filters, salaryMin: event.target.value ? Number(event.target.value) : null })}>
              <option value="">No min</option>{SALARIES.map((salary) => <option key={salary} value={salary}>{money(salary)}</option>)}
            </select><span className="text-muted-foreground">–</span>
            <select className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm" aria-label="Maximum salary" value={filters.salaryMax ?? ""} onChange={(event) => onChange({ ...filters, salaryMax: event.target.value ? Number(event.target.value) : null })}>
              <option value="">No max</option>{SALARIES.filter((salary) => salary > 0).map((salary) => <option key={salary} value={salary}>{money(salary)}</option>)}
            </select>
          </div>
        </section>

        <section className="mb-5">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Sector</h3>
          <div className="space-y-0.5">{SECTORS.map((sector) => <label key={sector} className={`flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-sm ${filters.routes.includes(sector) ? "bg-muted" : "hover:bg-muted/60"}`}>
            <input type="checkbox" checked={filters.routes.includes(sector)} onChange={() => onChange({ ...filters, routes: toggle(filters.routes, sector) })} className="accent-primary" />
            <span className="min-w-0 flex-1">{sector}</span>
          </label>)}</div>
        </section>

        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Level</h3>
          <div className="space-y-0.5">{LEVELS.map((level) => <label key={level} className={`flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-sm ${filters.levels.includes(level) ? "bg-muted" : "hover:bg-muted/60"}`}>
            <input type="checkbox" checked={filters.levels.includes(level)} onChange={() => onChange({ ...filters, levels: toggle(filters.levels, level) })} className="accent-primary" />
            <span>Level {level}</span>
          </label>)}</div>
        </section>
      </aside>

      <main className="min-w-0">
        <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center">
          <Input value={filters.q} onChange={(event) => onChange({ ...filters, q: event.target.value })} placeholder="Search role, company or keyword" className="h-11 flex-1 rounded-full bg-muted/60 px-4" aria-label="Search role, company or keyword" />
          <label className="flex items-center gap-2 text-sm text-muted-foreground"><span>Sort:</span><select className="h-9 rounded-md border-0 bg-transparent px-1 font-medium text-foreground" value={filters.sort} onChange={(event) => onChange({ ...filters, sort: event.target.value as Sort })} aria-label="Sort results">{SORTS.map((sort) => <option key={sort} value={sort}>{SORT_LABEL[sort]}</option>)}</select></label>
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          <p><strong>{total}</strong> {total === 1 ? "apprenticeship" : "apprenticeships"}<span className="ml-1 text-muted-foreground">· {listings} on this page · {shown} employers</span></p>
          <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={filters.soon} onChange={(event) => onChange({ ...filters, soon: event.target.checked })} />Closing within {CLOSING_SOON_DAYS} days</label>
        </div>
        <div className="mb-5 flex flex-wrap gap-1.5">
          {filters.routes.map((route) => <span key={route} className="rounded-full bg-muted px-2.5 py-1 text-xs">{route}<button className="ml-1.5 text-muted-foreground" aria-label={`Remove ${route} sector`} onClick={() => onChange({ ...filters, routes: filters.routes.filter((item) => item !== route) })}>×</button></span>)}
          {filters.levels.length > 0 && <span className="rounded-full bg-muted px-2.5 py-1 text-xs">Level {Math.min(...filters.levels)}{filters.levels.length > 1 ? `–${Math.max(...filters.levels)}` : ""}<button className="ml-1.5 text-muted-foreground" aria-label="Clear levels" onClick={() => onChange({ ...filters, levels: [] })}>×</button></span>}
          {filters.salaryMin !== null && <span className="rounded-full bg-muted px-2.5 py-1 text-xs">min {money(filters.salaryMin)}<button className="ml-1.5 text-muted-foreground" aria-label="Clear minimum salary" onClick={() => onChange({ ...filters, salaryMin: null })}>×</button></span>}
          {filters.salaryMax !== null && <span className="rounded-full bg-muted px-2.5 py-1 text-xs">max {money(filters.salaryMax)}<button className="ml-1.5 text-muted-foreground" aria-label="Clear maximum salary" onClick={() => onChange({ ...filters, salaryMax: null })}>×</button></span>}
          {filters.startYear !== null && <span className="rounded-full bg-muted px-2.5 py-1 text-xs">Starts {filters.startYear}<button className="ml-1.5 text-muted-foreground" aria-label="Clear start year" onClick={() => onChange({ ...filters, startYear: null })}>×</button></span>}
          {filters.location && <span className="rounded-full bg-muted px-2.5 py-1 text-xs">{filters.location}<button className="ml-1.5 text-muted-foreground" aria-label="Clear location" onClick={() => onChange({ ...filters, location: "" })}>×</button></span>}
        </div>
        {totalPages > 1 && <nav className="mb-4 flex items-center justify-center gap-3" aria-label="Vacancy pages">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>Previous</Button>
          <span className="text-xs text-muted-foreground">Page {page} of {totalPages}</span>
          <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>Next</Button>
        </nav>}
        {children}
      </main>
    </div>
  );
}
