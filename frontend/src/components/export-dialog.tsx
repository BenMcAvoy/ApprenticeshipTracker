import { Check, Copy, Download, ListChecks } from "lucide-react";
import { useMemo, useState } from "react";
import type { CompanyRow } from "@/components/company-card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { buildExport } from "@/lib/export-list";

function download(content: string, fileName: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  Object.assign(document.createElement("a"), { href: url, download: fileName }).click();
  URL.revokeObjectURL(url);
}

/** Exports the companies currently shown (respecting filters) with their apply links. */
export function ExportDialog({ companies }: { companies: CompanyRow[] }) {
  const [openOnly, setOpenOnly] = useState(true);
  const [copied, setCopied] = useState(false);
  const result = useMemo(() => buildExport(companies, openOnly), [companies, openOnly]);
  const stamp = new Date().toISOString().slice(0, 10);

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" size="sm" className="h-11 md:h-7" />}>
        <ListChecks /> Export<span className="hidden md:inline"> list</span>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Export list</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-3">
          <Switch id="export-open-only" checked={openOnly} onCheckedChange={setOpenOnly} />
          <Label htmlFor="export-open-only">Open roles only</Label>
        </div>

        {result.links === 0 ? (
          <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">Nothing to export.</p>
        ) : (
          <Textarea readOnly rows={16} value={result.text} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={result.links === 0}
            onClick={async () => {
              await navigator.clipboard.writeText(result.text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
          </Button>
          <Button variant="outline" size="sm" disabled={result.links === 0} onClick={() => download(result.text, `apprenticeships-${stamp}.txt`, "text/plain")}>
            <Download /> .txt
          </Button>
          <Button variant="outline" size="sm" disabled={result.links === 0} onClick={() => download(result.csv, `apprenticeships-${stamp}.csv`, "text/csv")}>
            <Download /> .csv
          </Button>
          <span className="ml-auto text-xs text-muted-foreground">
            {result.companies} {result.companies === 1 ? "company" : "companies"} · {result.links} {result.links === 1 ? "link" : "links"}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
