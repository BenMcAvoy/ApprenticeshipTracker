/** Shared browser/server identity for a saved listing. Query values identifying a job are retained. */
export function listingKey(listing: { title: string; url?: string | null }): string {
  if (listing.url?.trim()) {
    try {
      const url = new URL(listing.url.trim());
      if (url.protocol === "https:" || url.protocol === "http:") {
        url.hash = "";
        for (const name of [...url.searchParams.keys()]) {
          if (/^utm_/i.test(name) || /^(fbclid|gclid)$/i.test(name)) url.searchParams.delete(name);
        }
        url.searchParams.sort();
        url.pathname = url.pathname.replace(/\/+$/, "") || "/";
        return `url:${url.toString()}`;
      }
    } catch {
      // A listing without a usable URL can still be tracked by its normalized title.
    }
  }
  return `title:${listing.title.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase()}`;
}
