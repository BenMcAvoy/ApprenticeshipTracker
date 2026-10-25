/** Research identity only; user-applied keys keep their existing persistent format. */
export function vacancyIdentity(input: string): string {
  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase();
    const siemensDetail = /(?:^|\.)siemens\.com$/.test(host) && /\/externaljobs\/(?:JobDetail|ApplicationMethods)(?:\/|$)/i.test(url.pathname);
    if (siemensDetail) {
      const id = url.searchParams.get("folderId") ?? url.searchParams.get("jobId") ?? url.pathname.match(/\/JobDetail\/([^/]+)\/?$/i)?.[1];
      if (id) return `${host}|siemens-job:${id}`;
    }
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (/^(?:utm_.+|gclid|fbclid|msclkid|source|src)$/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch { return input; }
}
