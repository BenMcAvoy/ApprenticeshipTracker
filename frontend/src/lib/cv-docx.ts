// Turns the tailored CV (Markdown) and cover letter (plain paragraphs) into Word documents.
// No path-alias imports here so it can run in Node for tests as well as in the browser.

export type Run = { text: string; bold?: boolean; italic?: boolean };
export type Block =
  | { type: "name"; runs: Run[] }
  | { type: "contact"; runs: Run[] }
  | { type: "heading"; level: 2 | 3; runs: Run[] }
  | { type: "paragraph"; lines: Run[][] }
  | { type: "bullet"; runs: Run[] };

/** **bold**, *italic* and _italic_ to runs. Anything unmatched stays plain text. */
export function parseInline(text: string): Run[] {
  const runs: Run[] = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*|(?<![A-Za-z0-9])_(.+?)_(?![A-Za-z0-9])/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index) });
    if (m[1] !== undefined) runs.push({ text: m[1], bold: true });
    else runs.push({ text: m[2] ?? m[3], italic: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last) });
  return runs.length ? runs : [{ text }];
}

/** Markdown subset used for CVs: # name, ## section headings, - bullets, paragraphs with line breaks. */
export function parseCv(markdown: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let sawName = false;
  let sawHeading = false;

  const flush = () => {
    if (!paragraph.length) return;
    // The lines directly under the name (before any section) are the contact details.
    if (sawName && !sawHeading && !blocks.some((b) => b.type === "contact")) {
      blocks.push({ type: "contact", runs: parseInline(paragraph.join("  ·  ")) });
    } else {
      blocks.push({ type: "paragraph", lines: paragraph.map(parseInline) });
    }
    paragraph = [];
  };

  for (const raw of markdown.replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) {
      flush();
    } else if (/^#\s+/.test(trimmed) && !sawName) {
      flush();
      sawName = true;
      blocks.push({ type: "name", runs: parseInline(trimmed.replace(/^#\s+/, "")) });
    } else if (/^#{1,6}\s+/.test(trimmed)) {
      flush();
      sawHeading = true;
      // "##" starts a section (Experience, Education…); "###" and deeper are entries within it (a job, a school).
      const level = trimmed.match(/^#+/)![0].length <= 2 ? 2 : 3;
      blocks.push({ type: "heading", level, runs: parseInline(trimmed.replace(/^#{1,6}\s+/, "")) });
    } else if (/^[-*•]\s+/.test(trimmed)) {
      flush();
      blocks.push({ type: "bullet", runs: parseInline(trimmed.replace(/^[-*•]\s+/, "")) });
    } else if (/^[-*_]{3,}$/.test(trimmed)) {
      flush(); // horizontal rule: ignore
    } else {
      paragraph.push(trimmed);
    }
  }
  flush();
  return blocks;
}

export const personName = (markdown: string) => parseCv(markdown).find((b) => b.type === "name")?.runs.map((r) => r.text).join("") ?? "";

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim();
export const docxFileName = (kind: "CV" | "Cover letter", person: string, company: string) =>
  `${[kind, safeName(person), safeName(company)].filter(Boolean).join(" - ")}.docx`;

const FONT = "Calibri";
const A4 = { width: 11906, height: 16838 }; // twips

async function lib() {
  // Loaded on demand so the (large) docx library isn't in the initial page bundle.
  return import("docx");
}

/** An ATS-friendly single-column CV: no tables, text boxes or images. */
export async function buildCvDocx(markdown: string): Promise<Blob> {
  const { AlignmentType, BorderStyle, Document, HeadingLevel, Packer, Paragraph, TextRun } = await lib();
  const toRuns = (runs: Run[], size: number, extra: { bold?: boolean } = {}) =>
    runs.map((r) => new TextRun({ text: r.text, bold: r.bold || extra.bold, italics: r.italic, size, font: FONT }));

  const children = parseCv(markdown).map((block) => {
    switch (block.type) {
      case "name":
        return new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: toRuns(block.runs, 40, { bold: true }) });
      case "contact":
        return new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: toRuns(block.runs, 20) });
      case "heading":
        if (block.level === 3) {
          return new Paragraph({
            heading: HeadingLevel.HEADING_3,
            spacing: { before: 120, after: 40 },
            keepNext: true,
            children: block.runs.map((r) => new TextRun({ text: r.text, bold: true, italics: r.italic, size: 22, font: FONT })),
          });
        }
        return new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 200, after: 80 },
          keepNext: true,
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "808080", space: 2 } },
          children: block.runs.map((r) => new TextRun({ text: r.text.toUpperCase(), bold: true, size: 23, font: FONT, color: "1F3864" })),
        });
      case "bullet":
        return new Paragraph({ bullet: { level: 0 }, spacing: { after: 40 }, children: toRuns(block.runs, 21) });
      case "paragraph":
        // Consecutive lines (e.g. a project title then its description) keep their line breaks.
        return new Paragraph({
          spacing: { after: 80 },
          children: block.lines.flatMap((line, li) =>
            line.map((r, ri) => new TextRun({ text: r.text, bold: r.bold, italics: r.italic, size: 21, font: FONT, break: li > 0 && ri === 0 ? 1 : undefined })),
          ),
        });
    }
  });

  const doc = new Document({
    creator: "Apprentice Scanner",
    styles: { default: { document: { run: { font: FONT, size: 21 } } } },
    sections: [{ properties: { page: { size: A4, margin: { top: 850, bottom: 850, left: 1000, right: 1000 } } }, children }],
  });
  return Packer.toBlob(doc);
}

/** A plain, professional UK-style letter. */
export async function buildLetterDocx(letter: string): Promise<Blob> {
  const { Document, Packer, Paragraph, TextRun } = await lib();
  const paragraphs = letter
    .replace(/\r/g, "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        new Paragraph({
          spacing: { after: 200, line: 276 },
          children: p.split("\n").map((line, i) => new TextRun({ text: line.trim(), size: 22, font: FONT, break: i > 0 ? 1 : undefined })),
        }),
    );
  const doc = new Document({
    creator: "Apprentice Scanner",
    styles: { default: { document: { run: { font: FONT, size: 22 } } } },
    sections: [{ properties: { page: { size: A4, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } }, children: paragraphs }],
  });
  return Packer.toBlob(doc);
}
