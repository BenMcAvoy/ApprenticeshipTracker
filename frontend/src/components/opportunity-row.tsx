import { Check, ExternalLink, LoaderCircle, Sparkles, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listingClosing, type Listing } from "@/lib/company-filters";
import { cn } from "@/lib/utils";

export function OpportunityRow({ listing, applied, saving, marking, canTailor, tailorDisabled, tailorHint, onTailor, onAppliedChange }: {
  listing: Listing; applied: boolean; saving: boolean; marking?: boolean;
  canTailor: boolean; tailorDisabled: boolean; tailorHint: string;
  onTailor: () => void; onAppliedChange: () => void;
}) {
  const deadline = listingClosing(listing);
  const closing = deadline.text.replace(/TODAY|TOMORROW/g, (word) => word.toLowerCase());
  const deadlineTone = cn(deadline.tone === "urgent" && "font-medium text-destructive", deadline.tone === "warn" && "text-amber-700 dark:text-amber-400");

  return (
    <li className="flex min-w-0 flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        {listing.url ? (
          <a className="inline-flex max-w-full items-start gap-1.5 font-medium leading-snug underline-offset-4 hover:underline" href={listing.url} target="_blank" rel="noreferrer">
            <span className="min-w-0 break-words">{listing.title}</span>
            <ExternalLink className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
          </a>
        ) : (
          <p className="break-words font-medium leading-snug">{listing.title}</p>
        )}
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          {[listing.location, <span key="deadline" className={deadlineTone}>{closing.charAt(0).toUpperCase() + closing.slice(1)}</span>]
            .filter(Boolean)
            .map((part, index) => (
              <span key={index}>
                {index > 0 && " · "}
                {part}
              </span>
            ))}
        </p>
      </div>
      {listing.needsRecheck && <p className="text-xs text-amber-700 dark:text-amber-400">Needs recheck</p>}
      {applied && <Badge variant="secondary" className="w-fit"><Check className="size-3" /> Applied</Badge>}
      <div className="flex flex-wrap items-center gap-2">
        {canTailor && listing.url && (
          <Button size="sm" variant="ghost" className="h-9 px-2 text-xs" disabled={tailorDisabled} title={tailorHint} aria-label={`Tailor CV for ${listing.title}`} onClick={onTailor}>
            <Sparkles /> Tailor
          </Button>
        )}
        <Button
          size="sm"
          variant={applied ? "ghost" : "outline"}
          className="ml-auto h-9 px-2 text-xs"
          disabled={marking}
          aria-busy={saving || undefined}
          onClick={onAppliedChange}
          aria-label={`${applied ? "Undo applied for" : "Mark as applied for"} ${listing.title}`}
        >
          {saving ? <LoaderCircle className="animate-spin" /> : applied ? <Undo2 /> : <Check />}
          {saving ? "Saving…" : applied ? "Undo" : "Mark applied"}
        </Button>
      </div>
    </li>
  );
}
