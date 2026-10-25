import {
  ChevronDown,
  ChevronUp,
  Circle,
  CircleCheck,
  CircleX,
  Globe,
  Landmark,
  Loader2,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ScanStage = "search" | "browse" | "gov" | "verify" | "done";
export type ResultStatus = "open" | "upcoming" | "closed" | "none" | "unclear" | "error";

export type ScanEventView = {
  stage: ScanStage;
  level: "step" | "info" | "success" | "warn" | "error";
  message: string;
  progress: number;
  result?: { status: ResultStatus; listings: number };
};

export type CompanyScan = {
  id: number;
  name: string;
  state: "queued" | "running" | "finished";
  progress: number;
  message: string;
  /** Stages that logged a warning or error. */
  troubled: ScanStage[];
  events: ScanEventView[];
  result?: { status: ResultStatus; listings: number };
};

const STEPS = [
  { stage: "gov", label: "Gov service", icon: Landmark },
  { stage: "search", label: "Web search", icon: Search },
  { stage: "browse", label: "Browse", icon: Globe },
  { stage: "verify", label: "Verify", icon: ShieldCheck },
] as const;

const RESULT: Record<ResultStatus, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  open: { label: "Open", variant: "default" },
  upcoming: { label: "Opening soon", variant: "default" },
  closed: { label: "Closed", variant: "secondary" },
  none: { label: "No roles", variant: "secondary" },
  unclear: { label: "Unclear", variant: "outline" },
  error: { label: "Error", variant: "destructive" },
};

/** The agent decides its own route, so steps light up as it uses them rather than in a fixed order. */
function StepPipeline({ scan }: { scan: CompanyScan }) {
  const last = scan.events.at(-1)?.stage;
  const used = new Set(scan.events.map((e) => e.stage));
  return (
    <div className="flex items-center gap-1">
      {STEPS.map((step) => {
        const active = scan.state === "running" && last === step.stage;
        const done = used.has(step.stage);
        const troubled = scan.troubled.includes(step.stage);
        const Icon = step.icon;
        return (
          <div
            key={step.stage}
            title={step.label}
            className={cn(
              "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors",
              !done && "text-muted-foreground",
              done && "border-transparent bg-primary text-primary-foreground",
              troubled && "bg-amber-500 text-white",
              active && "border-primary bg-primary/10 text-foreground",
            )}
          >
            {active ? <Loader2 className="size-3 animate-spin" /> : <Icon className="size-3" />}
            <span className="hidden xl:inline">{step.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function StateIcon({ scan }: { scan: CompanyScan }) {
  if (scan.state === "queued") return <Circle className="size-4 text-muted-foreground" />;
  if (scan.state === "running") return <Loader2 className="size-4 animate-spin text-primary" />;
  if (scan.result?.status === "error") return <CircleX className="size-4 text-destructive" />;
  return <CircleCheck className={cn("size-4", scan.result?.status === "open" || scan.result?.status === "upcoming" ? "text-green-600" : "text-muted-foreground")} />;
}

function ScanRow({ scan }: { scan: CompanyScan }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border-b last:border-b-0">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="grid w-full grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-3 py-3 text-left text-sm hover:bg-muted/50 sm:grid-cols-[1rem_8rem_auto_7rem_5rem_minmax(0,1fr)] sm:gap-3 sm:px-4 sm:py-2"
      >
        <StateIcon scan={scan} />
        <span className="truncate font-medium">{scan.name}</span>
        <div className="hidden sm:block"><StepPipeline scan={scan} /></div>
        <div className="col-span-2 col-start-2 row-start-2 h-1.5 overflow-hidden rounded-full bg-muted sm:col-span-1 sm:col-start-auto sm:row-start-auto">
          <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${scan.progress}%` }} />
        </div>
        <div className="col-start-3 row-start-1 sm:col-start-auto sm:row-start-auto">
          {scan.result ? (
            <Badge variant={RESULT[scan.result.status].variant}>
              {RESULT[scan.result.status].label}
              {scan.result.listings > 0 && ` · ${scan.result.listings}`}
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">{scan.state === "queued" ? "Queued" : `${Math.round(scan.progress)}%`}</span>
          )}
        </div>
        <span className="col-span-2 col-start-2 row-start-3 min-w-0 truncate text-xs text-muted-foreground sm:col-span-1 sm:col-start-auto sm:row-start-auto">{scan.message}</span>
      </button>
      {expanded && scan.events.length > 0 && (
        <ol className="mr-3 ml-6 flex flex-col gap-2 border-l pb-3 pl-3 sm:ml-12 sm:gap-1 sm:pl-4">
          {scan.events.map((e, i) => (
            <li key={i} className="flex items-start gap-2 text-xs">
              <span
                className={cn(
                  "mt-1 size-1.5 shrink-0 rounded-full",
                  e.level === "error" ? "bg-destructive" : e.level === "warn" ? "bg-amber-500" : e.level === "success" ? "bg-green-600" : "bg-muted-foreground/50",
                )}
              />
              <span className={cn("break-all", e.level === "step" ? "text-foreground" : "text-muted-foreground")}>{e.message}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** VS Code-style bottom panel, rendered into the layout's bottom slot (see routes/__root.tsx). */
export function ScanPanel({
  scans,
  open,
  onClose,
}: {
  scans: CompanyScan[];
  open: boolean;
  onClose: () => void;
}) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [minimised, setMinimised] = useState(false);
  useEffect(() => setSlot(document.getElementById("bottom-panel")), []);
  useEffect(() => {
    if (open) setMinimised(false);
  }, [open]);

  if (!slot || !open) return null;

  const finished = scans.filter((s) => s.state === "finished");
  const running = scans.some((s) => s.state === "running");
  const overall = scans.length ? scans.reduce((sum, s) => sum + s.progress, 0) / scans.length : 0;
  const counts = (Object.keys(RESULT) as ResultStatus[])
    .map((status) => ({ status, count: finished.filter((s) => s.result?.status === status).length }))
    .filter((c) => c.count > 0);

  return createPortal(
    <section className="flex min-w-0 shrink-0 flex-col border-t bg-background">
      <header className="flex min-h-11 flex-wrap items-center gap-2 border-b bg-muted/40 pr-2 sm:min-h-9 sm:gap-4">
        <div className="flex min-h-11 items-center border-b-2 border-primary px-3 text-xs font-semibold tracking-wide uppercase sm:min-h-9 sm:px-4">
          Scans
        </div>
        <span className="text-xs text-muted-foreground">
          {finished.length}/{scans.length}{running ? "" : " done"}
        </span>
        <div className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-muted md:block">
          <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${overall}%` }} />
        </div>
        <div className="hidden flex-wrap gap-1 lg:flex">
          {counts.map(({ status, count }) => (
            <Badge key={status} variant={RESULT[status].variant}>
              {count} {RESULT[status].label.toLowerCase()}
            </Badge>
          ))}
        </div>
        <div className="ml-auto flex">
          <Button variant="ghost" size="icon-sm" className="size-11 sm:size-8" onClick={() => setMinimised((m) => !m)} title={minimised ? "Expand" : "Minimise"} aria-label={minimised ? "Expand scans" : "Minimise scans"}>
            {minimised ? <ChevronUp /> : <ChevronDown />}
          </Button>
          <Button variant="ghost" size="icon-sm" className="size-11 sm:size-8" onClick={onClose} title="Close" aria-label="Close scans">
            <X />
          </Button>
        </div>
      </header>
      {!minimised && (
        <div className="h-[min(16rem,40dvh)] overflow-y-auto">
          {scans.map((scan) => (
            <ScanRow key={scan.id} scan={scan} />
          ))}
        </div>
      )}
    </section>,
    slot,
  );
}
