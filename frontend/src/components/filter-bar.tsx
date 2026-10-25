import { ChevronDown, ListFilter, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CLOSING_SOON_DAYS, DEFAULT_FILTERS, type Filters, isFiltered, SORT_LABEL, SORTS, type Sort, STATUS_LABEL, STATUSES, type Status } from "@/lib/company-filters";

export function FilterBar({ filters, onChange, counts, shown, total, listings }: {
  filters: Filters; onChange: (next: Filters) => void;
  counts: Record<Status, number>; shown: number; total: number; listings: number;
}) {
  const activeCount = filters.statuses.length + Number(filters.soon);
  const summary = [...filters.statuses.map((status) => STATUS_LABEL[status]), ...(filters.soon ? [`Closing within ${CLOSING_SOON_DAYS} days`] : [])].join(" · ");
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 sm:flex sm:items-center">
        <div className="relative col-span-2 min-w-0 sm:flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={filters.q} onChange={(event) => onChange({ ...filters, q: event.target.value })} placeholder="Search companies, roles, locations…" className="h-11 pl-9 sm:h-9" aria-label="Search" />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" className="h-11 w-full justify-between sm:h-9 sm:w-auto" />}>
            <ListFilter /> Filters{activeCount > 0 ? ` (${activeCount})` : ""} <ChevronDown />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64 max-w-[calc(100vw-2rem)]">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Status</DropdownMenuLabel>
              {STATUSES.map((status) => <DropdownMenuCheckboxItem key={status} closeOnClick={false} className="min-h-11 sm:min-h-9" checked={filters.statuses.includes(status)} onCheckedChange={(checked) => onChange({ ...filters, statuses: checked ? [...filters.statuses, status] : filters.statuses.filter((item) => item !== status) })}>
                {STATUS_LABEL[status]} <span className="ml-auto text-xs tabular-nums text-muted-foreground">{counts[status]}</span>
              </DropdownMenuCheckboxItem>)}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem closeOnClick={false} className="min-h-11 sm:min-h-9" checked={filters.soon} onCheckedChange={(soon) => onChange({ ...filters, soon })}>Closing within {CLOSING_SOON_DAYS} days</DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="min-h-11 sm:min-h-9" disabled={!isFiltered(filters)} onClick={() => onChange(DEFAULT_FILTERS)}>Reset filters</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Select value={filters.sort} onValueChange={(sort) => onChange({ ...filters, sort: sort as Sort })}>
          <SelectTrigger className="h-11 min-h-11 w-full sm:h-9 sm:min-h-9 sm:w-56" aria-label="Sort results"><span className="shrink-0 text-muted-foreground">Sort:</span><SelectValue className="min-w-0 truncate">{SORT_LABEL[filters.sort]}</SelectValue></SelectTrigger>
          <SelectContent>{SORTS.map((sort) => <SelectItem key={sort} value={sort}>{SORT_LABEL[sort]}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{shown === total ? `${total} employer${total === 1 ? "" : "s"}` : `${shown} of ${total} employers`} · {listings} apprenticeship role{listings === 1 ? "" : "s"}</span>
        {summary && <span>{summary}</span>}
        {isFiltered(filters) && <Button variant="link" size="xs" className="ml-auto text-muted-foreground" onClick={() => onChange(DEFAULT_FILTERS)}>Reset filters</Button>}
      </div>
    </div>
  );
}
