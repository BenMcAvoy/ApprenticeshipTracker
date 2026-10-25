import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, Copy, Download, FileDown, Lightbulb, Loader2, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { buildCvDocx, buildLetterDocx, docxFileName, parseCv, personName } from "@/lib/cv-docx";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";

type Change = { section: string; kind: string; before: string | null; after: string; reason: string };
type Gap = { requirement: string; suggestion: string };

const KIND: Record<string, string> = {
  reworded: "Reworded",
  reordered: "Reordered",
  emphasised: "Emphasised",
  trimmed: "Trimmed",
  removed: "Removed",
  formatting: "Formatting",
};

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement("a"), { href: url, download: fileName }).click();
  URL.revokeObjectURL(url);
}

/** Word download (primary), plus copy and a plain-text fallback. */
function Actions({ text, makeDocx, docxName, plainName }: { text: string; makeDocx: () => Promise<Blob>; docxName: string; plainName: string }) {
  const [copied, setCopied] = useState(false);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        disabled={building}
        onClick={async () => {
          setBuilding(true);
          setError(null);
          try {
            saveBlob(await makeDocx(), docxName);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Couldn't build the Word file");
          } finally {
            setBuilding(false);
          }
        }}
      >
        {building ? <Loader2 className="animate-spin" /> : <FileDown />} Download .docx
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={async () => {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => saveBlob(new Blob([text], { type: "text/plain" }), plainName)}>
        <Download /> {plainName.split(".").pop()}
      </Button>
      {error && <Badge variant="destructive">{error}</Badge>}
    </div>
  );
}

const Runs = ({ runs }: { runs: { text: string; bold?: boolean; italic?: boolean }[] }) =>
  runs.map((r, i) => (
    <span key={i} className={cn(r.bold && "font-semibold", r.italic && "italic")}>
      {r.text}
    </span>
  ));

/** On-screen version of what the .docx will contain (same parser). */
function CvPreview({ markdown }: { markdown: string }) {
  return (
    <div className="max-h-[55vh] overflow-auto rounded-lg border bg-white p-8 text-[13px] leading-relaxed text-neutral-900 shadow-sm">
      {parseCv(markdown).map((b, i) => {
        switch (b.type) {
          case "name":
            return (
              <h2 key={i} className="text-center text-2xl font-bold">
                <Runs runs={b.runs} />
              </h2>
            );
          case "contact":
            return (
              <p key={i} className="mb-3 text-center text-xs text-neutral-600">
                <Runs runs={b.runs} />
              </p>
            );
          case "heading":
            if (b.level === 3) {
              return (
                <h4 key={i} className="mt-2.5 text-[13px] font-bold">
                  <Runs runs={b.runs} />
                </h4>
              );
            }
            return (
              <h3 key={i} className="mt-4 mb-1 border-b border-neutral-400 pb-0.5 text-sm font-bold tracking-wide text-[#1F3864] uppercase">
                <Runs runs={b.runs} />
              </h3>
            );
          case "bullet":
            return (
              <li key={i} className="ml-5 list-disc">
                <Runs runs={b.runs} />
              </li>
            );
          case "paragraph":
            return (
              <p key={i} className="mb-1.5">
                {b.lines.map((line, li) => (
                  <span key={li}>
                    {li > 0 && <br />}
                    <Runs runs={line} />
                  </span>
                ))}
              </p>
            );
        }
      })}
    </div>
  );
}

export function ApplicationDialog({
  open,
  onOpenChange,
  companyId,
  company,
  listing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: number;
  company: string;
  listing: { title: string; url: string };
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const input = { companyId, listingUrl: listing.url };
  const saved = useQuery({ ...trpc.applications.get.queryOptions(input), enabled: open, refetchOnWindowFocus: "always" });
  const generate = useMutation(
    trpc.applications.generate.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries(trpc.applications.get.queryFilter(input)),
    }),
  );
  const app = saved.data;
  const changes: Change[] = app ? JSON.parse(app.changes) : [];
  const gaps: Gap[] = app ? JSON.parse(app.gaps) : [];
  const audit: { fixed: string[]; remaining: string[] } = app ? JSON.parse(app.audit) : { fixed: [], remaining: [] };
  const slug = company.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{listing.title}</DialogTitle>
          <DialogDescription>{company}</DialogDescription>
        </DialogHeader>

        {generate.isPending && (
          <div className="flex flex-col items-center gap-3 py-12 text-sm text-muted-foreground">
            <Loader2 className="size-6 animate-spin" />
            <p>Tailoring… about a minute.</p>
          </div>
        )}

        {saved.isError && <p role="alert" className="text-sm text-destructive">{saved.error.message}</p>}
        {!generate.isPending && !app && saved.isSuccess && (
          <div className="flex justify-center py-8">
            <Button onClick={() => generate.mutate(input)}>
              <Sparkles /> Tailor
            </Button>
          </div>
        )}

        {generate.isError && <Badge variant="destructive">{generate.error.message}</Badge>}

        {!generate.isPending && app && (
          <Tabs defaultValue="overview">
            <div className="flex items-center justify-between gap-2">
              <TabsList>
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="changes">Changes ({changes.length})</TabsTrigger>
                <TabsTrigger value="cv">CV</TabsTrigger>
                <TabsTrigger value="letter">Letter</TabsTrigger>
              </TabsList>
              <Button variant="ghost" size="sm" onClick={() => generate.mutate(input)}>
                <RefreshCw /> Redo
              </Button>
            </div>

            <TabsContent value="overview" className="flex flex-col gap-4 pt-3 text-sm">
              <p>{app.fitSummary}</p>

              <div className="flex items-start gap-2 rounded-lg border p-3">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-green-600" />
                <div className="flex flex-col gap-1">
                  <span className="font-medium">{audit.remaining.length ? "Check flagged items" : "Fact-checked"}</span>
                  <span className="text-muted-foreground">
                    {audit.fixed.length > 0
                      ? `${audit.fixed.length} removed`
                      : audit.remaining.length === 0 && "Nothing unsupported"}
                  </span>
                  {audit.fixed.map((f, i) => (
                    <span key={i} className="text-xs text-muted-foreground">
                      Removed: {f}
                    </span>
                  ))}
                  {audit.remaining.map((r, i) => (
                    <span key={i} className="text-xs text-amber-600">
                      Still check: {r}
                    </span>
                  ))}
                </div>
              </div>

              {gaps.length > 0 && (
                <div className="flex flex-col gap-2">
                  <h3 className="flex items-center gap-2 font-medium">
                    <Lightbulb className="size-4 text-amber-500" /> Gaps
                  </h3>
                  {gaps.map((g, i) => (
                    <div key={i} className="rounded-lg border p-3">
                      <p className="font-medium">{g.requirement}</p>
                      <p className="text-muted-foreground">{g.suggestion}</p>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="changes" className="flex flex-col gap-3 pt-3 text-sm">
              {changes.map((c, i) => (
                <div key={i} className="flex flex-col gap-2 rounded-lg border p-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{c.section}</span>
                    <Badge variant="secondary">{KIND[c.kind] ?? c.kind}</Badge>
                  </div>
                  <p className="text-muted-foreground">{c.reason}</p>
                  <div className="grid gap-2 md:grid-cols-[1fr_auto_1fr] md:items-start">
                    <div className="rounded-md bg-red-500/10 p-2 text-xs whitespace-pre-wrap">
                      {c.before ?? <span className="text-muted-foreground italic">New wording</span>}
                    </div>
                    <ArrowRight className="hidden size-4 self-center text-muted-foreground md:block" />
                    <div className="rounded-md bg-green-500/10 p-2 text-xs whitespace-pre-wrap">{c.after}</div>
                  </div>
                </div>
              ))}
            </TabsContent>

            <TabsContent value="cv" className="flex flex-col gap-3 pt-3">
              <Actions
                text={app.tailoredCv}
                makeDocx={() => buildCvDocx(app.tailoredCv)}
                docxName={docxFileName("CV", personName(app.tailoredCv), company)}
                plainName={`cv-${slug}.md`}
              />
              <CvPreview markdown={app.tailoredCv} />
            </TabsContent>

            <TabsContent value="letter" className="flex flex-col gap-3 pt-3">
              <Actions
                text={app.coverLetter}
                makeDocx={() => buildLetterDocx(app.coverLetter)}
                docxName={docxFileName("Cover letter", personName(app.tailoredCv), company)}
                plainName={`cover-letter-${slug}.txt`}
              />
              <div className="max-h-[55vh] overflow-auto rounded-lg border bg-white p-8 text-[13px] leading-relaxed whitespace-pre-wrap text-neutral-900 shadow-sm">{app.coverLetter}</div>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
