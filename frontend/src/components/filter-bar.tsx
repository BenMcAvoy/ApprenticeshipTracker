import { CLOSING_SOON_DAYS, DEFAULT_FILTERS, type Filters, isFiltered, SORT_LABEL, SORTS, type Sort } from "@/lib/company-filters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function FilterBar({ filters, onChange, shown, total, listings }: {
  filters: Filters; onChange: (next: Filters) => void; shown: number; total: number; listings: number;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input value={filters.q} onChange={(event) => onChange({ ...filters, q: event.target.value })} placeholder="Search vacancies or employers" className="h-11 sm:h-9 sm:flex-1" aria-label="Search vacancies or employers" />
        <Select value={filters.sort} onValueChange={(sort) => onChange({ ...filters, sort: sort as Sort })}>
          <SelectTrigger className="h-11 min-h-11 w-full sm:h-9 sm:min-h-9 sm:w-56" aria-label="Sort results"><span className="shrink-0 text-muted-foreground">Sort:</span><SelectValue className="min-w-0 truncate">{SORT_LABEL[filters.sort]}</SelectValue></SelectTrigger>
          <SelectContent>{SORTS.map((sort) => <SelectItem key={sort} value={sort}>{SORT_LABEL[sort]}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <span>{shown === total ? `${total}` : `${shown} of ${total}`} employers · {listings} roles</span>
        <label className="flex items-center gap-2"><input type="checkbox" checked={filters.soon} onChange={(event) => onChange({ ...filters, soon: event.target.checked })} />Closing within {CLOSING_SOON_DAYS} days</label>
        {isFiltered(filters) && <Button variant="link" size="xs" className="ml-auto text-muted-foreground" onClick={() => onChange(DEFAULT_FILTERS)}>Reset</Button>}
      </div>
    </div>
  );
}
