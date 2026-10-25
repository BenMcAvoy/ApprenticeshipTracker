import { generateText, Output } from "ai";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import { z } from "zod";
import { renderPage } from "./browser.ts";
import { openai } from "./openai-auth.ts";

const MODEL = "gpt-6-luna";

// ---------------------------------------------------------------------------
// CV text extraction
// ---------------------------------------------------------------------------

export async function extractCvText(fileName: string, base64: string): Promise<string> {
  const buffer = Buffer.from(base64, "base64");
  const lower = fileName.toLowerCase();
  let text: string;
  if (lower.endsWith(".pdf")) {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    text = (await extractText(pdf, { mergePages: true })).text;
  } else if (lower.endsWith(".docx")) {
    text = (await mammoth.extractRawText({ buffer })).value;
  } else if (/\.(txt|md|markdown)$/.test(lower)) {
    text = buffer.toString("utf8");
  } else {
    throw new Error("Unsupported file type. Upload a PDF, DOCX, TXT or MD file, or paste the text.");
  }
  text = text.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length < 80) {
    throw new Error("Couldn't read any text from that file (is it a scanned image?). Paste the text instead.");
  }
  return text;
}

// ---------------------------------------------------------------------------
// Tailoring
// ---------------------------------------------------------------------------

const changeSchema = z.object({
  section: z.string().describe("Where in the CV, e.g. 'Profile', 'Skills', 'Education'"),
  kind: z.enum(["reworded", "reordered", "emphasised", "trimmed", "removed", "formatting"]),
  before: z.string().nullable().describe("The ORIGINAL text, copied verbatim from the CV (null for pure reordering/formatting)"),
  after: z.string().describe("The new text as it now appears"),
  reason: z.string().describe("Why this helps for THIS vacancy, in one sentence"),
});

const draftSchema = z.object({
  fitSummary: z.string().describe("2-3 sentences: how well the CV fits this vacancy and what the strongest selling points are"),
  tailoredCv: z.string().describe("The complete tailored CV in Markdown"),
  changes: z.array(changeSchema),
  coverLetter: z.string().describe("The complete cover letter in plain paragraphs"),
  gaps: z
    .array(z.object({ requirement: z.string(), suggestion: z.string() }))
    .describe("Things the vacancy wants that the CV does NOT show, each with a suggestion the user could act on if it is TRUE for them. Never put these into the CV or letter."),
});

const auditSchema = z.object({
  issues: z
    .array(z.string())
    .describe("Each statement about the APPLICANT (experience, skills, grades, projects, results, numbers) that the original CV does not support. Empty if none."),
});

export type Tailored = z.infer<typeof draftSchema> & { audit: { fixed: string[]; remaining: string[] } };

const SYSTEM = `You are an expert UK early-careers CV and application coach. You are helping one applicant win a place on a technology degree apprenticeship.

ABSOLUTE RULES — the applicant's integrity depends on them:
- NEVER invent or inflate anything: no new employers, dates, qualifications, grades, skills, tools, projects, responsibilities, results or numbers. Every fact in your output must be traceable to the original CV.
- You MAY: reword for clarity and impact, put the most relevant content first, tighten, cut irrelevant material, fix grammar, mirror the vacancy's own terminology WHERE the CV genuinely shows that skill, and apply consistent UK formatting.
- If the vacancy wants something the CV does not show, do NOT add it. List it under "gaps" with a concrete suggestion the applicant can act on if it is true for them.

Craft:
- UK conventions: UK spelling, no photo, no date of birth, ideally 2 pages. Strong action verbs, concrete outcomes only where the CV supplies them.
- For degree apprenticeships employers hire on potential and motivation: foreground technical projects, relevant coursework, qualifications/predicted grades, initiative, and anything that shows learning and teamwork.
- Mirror the vacancy: pick up its keywords, but only for things the CV supports.
- Facts about the EMPLOYER and ROLE (company name, programme, training provider/university, location, what the job involves) come from the vacancy text and SHOULD be used to make the letter specific. Facts about the APPLICANT come only from the CV.
- Cover letter: 250–350 words, "Dear Hiring Team," unless a name is given, specific to this company and role (draw on real details from the vacancy text), genuine and direct rather than cliché, and every claim must come from the CV. Sign off with the applicant's name from the CV.
- The "changes" list must account for every meaningful edit, quoting the original text verbatim in "before".`;

export async function tailorApplication(input: {
  cv: string;
  company: string;
  listingTitle: string;
  listingUrl: string;
  closes?: string;
  location?: string;
  companySummary: string | null;
}): Promise<Tailored> {
  // 1. Read the actual vacancy so the CV targets what they ask for.
  let vacancyText = "";
  try {
    const page = await renderPage(input.listingUrl);
    vacancyText = page.text.slice(0, 14_000);
  } catch {
    vacancyText = "(The vacancy page could not be loaded; tailor using the title and company only, and say so in fitSummary.)";
  }

  const vacancy = `Company: ${input.company}
Role: ${input.listingTitle}
${input.location ? `Location: ${input.location}\n` : ""}${input.closes ? `Closes: ${input.closes}\n` : ""}${input.companySummary ? `Context: ${input.companySummary}\n` : ""}URL: ${input.listingUrl}

Vacancy page text:
${vacancyText}`;

  const generate = async (feedback?: { previous: Draft; issues: string[] }): Promise<Draft> => {
    const { output } = await generateText({
      model: openai()(MODEL),
      system: SYSTEM,
      output: Output.object({ schema: draftSchema }),
      prompt:
        `=== VACANCY ===
${vacancy}

=== APPLICANT'S ORIGINAL CV ===
${input.cv}

` +
        (feedback
          ? `=== YOUR PREVIOUS DRAFT ===
${JSON.stringify(feedback.previous)}

=== PROBLEMS A FACT-CHECK FOUND ===
These statements about the applicant are not supported by the original CV. Remove or restore each one (keep company/role facts from the vacancy). Return a COMPLETE corrected draft in the same format, with the change log and gaps updated to match the final text:
- ${feedback.issues.join("\n- ")}`
          : "Produce the tailored CV, change log, cover letter and gaps."),
    });
    return output;
  };

  const audit = async (draft: Draft): Promise<string[]> => {
    const { output } = await generateText({
      model: openai()(MODEL),
      system:
        "You are a strict fact-checker for job applications. The ORIGINAL CV is the only source of truth about the APPLICANT. The VACANCY is the source of truth about the employer and role. Flag any statement about the applicant (employers, dates, qualifications, grades, skills, tools, projects, responsibilities, results, numbers, experience) that the original CV does not support. Do NOT flag: reasonable rewording or reordering; accurate facts about the employer or role taken from the vacancy; or plain statements of motivation/interest in this role or programme.",
      output: Output.object({ schema: auditSchema }),
      prompt: `=== VACANCY ===
${vacancy}

=== ORIGINAL CV ===
${input.cv}

=== TAILORED CV ===
${draft.tailoredCv}

=== COVER LETTER ===
${draft.coverLetter}`,
    });
    return output.issues;
  };

  // 2. Draft, then fact-check and regenerate until clean (at most twice).
  let draft = await generate();
  const fixed: string[] = [];
  let remaining: string[] = [];
  for (let round = 0; ; round++) {
    remaining = await audit(draft);
    if (!remaining.length || round === 2) break;
    fixed.push(...remaining);
    draft = await generate({ previous: draft, issues: remaining });
  }

  // 3. Only keep "before" text that really exists in the original CV.
  const cvLines = norm(input.cv);
  const changes = draft.changes.map((c) => {
    const lines = (c.before ?? "").split("\n").map(norm).filter(Boolean);
    const verified = lines.length > 0 && lines.every((l) => cvLines.includes(l.replace(/^[-*•]\s*/, "")));
    return { ...c, before: verified ? c.before : null };
  });

  return { ...draft, changes, audit: { fixed, remaining } };
}

type Draft = z.infer<typeof draftSchema>;
const norm = (s: string) => s.toLowerCase().replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim();
