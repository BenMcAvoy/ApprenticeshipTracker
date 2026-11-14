import { Collapsible } from "@base-ui/react/collapsible";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ExternalLink } from "lucide-react";
import { listingKey } from "backend/listing-key";
import { useState } from "react";
import { ApplicationDialog } from "@/components/application-dialog";
import { OpportunityRow } from "@/components/opportunity-row";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listingsOf, type Listing } from "@/lib/company-filters";
import { useTRPC } from "@/lib/trpc";

export type CompanyRow = {
  id: number;
  name: string;
  careersUrl: string | null;
  status: string;
  summary: string | null;
  listings: string;
  source?: string;
};

export function CompanyCard({ company, appliedKeys, onAppliedChange, marking, savingKey }: {
  company: CompanyRow;
  appliedKeys: Set<string>;
  onAppliedChange: (listing: Listing, applied: boolean) => void;
  marking?: boolean;
  savingKey?: string;
}) {
  const trpc = useTRPC();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [tailoring, setTailoring] = useState<{ title: string; url: string } | null>(null);
  const profile = useQuery({ ...trpc.profile.get.queryOptions(), refetchOnWindowFocus: "always" });
  const hasCv = Boolean(profile.data?.cvText.trim());
  const listings = listingsOf(company);
  const logo = listings.find((listing) => listing.companyLogo)?.companyLogo;

  return (
    <Card className="min-w-0 gap-3">
      <CardHeader className="flex flex-row items-center gap-3 border-b pb-3">
        {logo && <img src={logo} alt="" className="size-10 shrink-0 rounded-md object-contain" loading="lazy" />}
        <div className="min-w-0 flex-1">
          <CardTitle className="break-words">{company.name}</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">{listings.length} {listings.length === 1 ? "role" : "roles"}</p>
        </div>
        <Badge variant="secondary" className="shrink-0">Open</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {listings.length > 0 && <ul className="divide-y">
          {listings.map((listing) => {
            const key = listingKey(listing);
            const applied = appliedKeys.has(key);
            return <OpportunityRow key={key} listing={listing} applied={applied} saving={Boolean(marking && savingKey === key)} marking={marking}
              canTailor tailorDisabled={!hasCv}
              tailorHint={hasCv ? "Tailor CV and write a cover letter" : "Upload your CV in Settings first"}
              onTailor={() => setTailoring({ title: listing.title, url: listing.url! })}
              onAppliedChange={() => onAppliedChange(listing, !applied)} />;
          })}
        </ul>}
        {(company.summary || company.careersUrl) && <Collapsible.Root open={detailsOpen} onOpenChange={setDetailsOpen} className="border-t pt-2">
          <Collapsible.Trigger render={<Button variant="ghost" size="sm" className="h-9 w-full justify-between px-0 text-xs text-muted-foreground hover:bg-transparent" />} aria-label={`Details for ${company.name}`}>
            Employer details <ChevronDown className={`transition-transform ${detailsOpen ? "rotate-180" : ""}`} />
          </Collapsible.Trigger>
          <Collapsible.Panel className="flex flex-col gap-3 pt-3 text-xs text-muted-foreground">
            {company.summary && <p className="text-sm leading-relaxed text-foreground">{company.summary}</p>}
            {company.careersUrl && <a className="break-all underline underline-offset-2" href={company.careersUrl} target="_blank" rel="noreferrer">Company website <ExternalLink className="ml-1 inline size-3" /></a>}
          </Collapsible.Panel>
        </Collapsible.Root>}
        {tailoring && <ApplicationDialog open onOpenChange={(open) => !open && setTailoring(null)} companyId={company.id} company={company.name} listing={tailoring} />}
      </CardContent>
    </Card>
  );
}
