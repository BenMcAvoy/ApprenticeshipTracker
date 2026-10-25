const HEADER_WORDS = new Set(["company", "companies", "company name", "name"]);

export type ParsedCompany = { name: string; careersUrl?: string };

const clean = (cell = "") => cell.trim().replace(/^"|"$/g, "").trim();

/** One company per line; for CSV, column 1 is the name and an optional column 2 is its careers URL. */
export function parseCompanies(text: string): ParsedCompany[] {
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.split(","))
    .map(([name, url]) => ({ name: clean(name), url: clean(url) }))
    .filter((row) => row.name);
  if (rows.length && HEADER_WORDS.has(rows[0].name.toLowerCase())) rows.shift();

  const byName = new Map<string, ParsedCompany>();
  for (const { name, url } of rows) {
    byName.set(name, { name, careersUrl: /^https?:\/\//.test(url) ? url : undefined });
  }
  return [...byName.values()];
}
