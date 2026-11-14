import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { prisma } from "./db.ts";

type GuideVacancy = {
  id: string;
  slug: string | null;
  title: string;
  shortDescription: string | null;
  courseRoute: string;
  courseLevel: number;
  apprenticeshipLevel: string;
  city: string | null;
  region: string | null;
  postcode: string | null;
  remoteType: string | null;
  wageText: string | null;
  wageAdditional: string | null;
  hoursPerWeek: string | null;
  positions: number | null;
  postedAt: string | null;
  startDate: string | null;
  closingDate: string | null;
  status: string;
  isActive: boolean;
  company: {
    id: string;
    name: string;
    websiteUrl: string | null;
    logoUrl: string | null;
  };
};

type VacancySnapshot = {
  fetchedAt: string;
  total: number;
  source: string;
  query: string;
  data: GuideVacancy[];
};

const snapshotPath = fileURLToPath(new URL("../data/vacancies.json", import.meta.url));
const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as VacancySnapshot;

function listingFromVacancy(vacancy: GuideVacancy) {
  const title = vacancy.title.trim();
  const url = `https://www.theapprenticeguide.net/apprenticeships/${encodeURIComponent(vacancy.slug || vacancy.id)}`;
  const location = [vacancy.city, vacancy.region].filter(Boolean).join(", ");
  return {
    title,
    url,
    location,
    closes: vacancy.closingDate ?? undefined,
    postedAt: vacancy.postedAt ?? undefined,
    startDate: vacancy.startDate ?? undefined,
    salary: [vacancy.wageText, vacancy.wageAdditional].filter(Boolean).join(" · ") || undefined,
    courseRoute: vacancy.courseRoute,
    courseLevel: vacancy.courseLevel,
    apprenticeshipLevel: vacancy.apprenticeshipLevel,
    hoursPerWeek: vacancy.hoursPerWeek ?? undefined,
    positions: vacancy.positions ?? undefined,
    remoteType: vacancy.remoteType ?? undefined,
    postcode: vacancy.postcode ?? undefined,
    description: vacancy.shortDescription ?? undefined,
    companyLogo: vacancy.company.logoUrl ?? undefined,
    sourceId: vacancy.id,
  };
}

/** Import the latest API response snapshot into the existing application-compatible catalogue. */
export async function syncVacanciesFromSnapshot() {
  const grouped = new Map<string, GuideVacancy[]>();
  for (const vacancy of snapshot.data) {
    const name = vacancy.company?.name?.trim();
    if (!name || !vacancy.id || !vacancy.title?.trim()) continue;
    const group = grouped.get(name) ?? [];
    group.push(vacancy);
    grouped.set(name, group);
  }

  await prisma.$transaction([...grouped].map(([name, vacancies]) => {
    const first = vacancies[0];
    const listings = vacancies.map(listingFromVacancy);
    return prisma.company.upsert({
      where: { name },
      create: {
        name,
        source: "the-apprentice-guide",
        careersUrl: first.company.websiteUrl,
        status: "open",
        summary: null,
        listings: JSON.stringify(listings),
        evidence: "[]",
      },
      update: {
        source: "the-apprentice-guide",
        careersUrl: first.company.websiteUrl,
        status: "open",
        summary: null,
        listings: JSON.stringify(listings),
        evidence: "[]",
      },
    });
  }));

  return {
    companies: grouped.size,
    vacancies: snapshot.data.length,
    fetchedAt: snapshot.fetchedAt,
    source: snapshot.source,
  };
}

export async function listVacancyCompanies() {
  const companies = await prisma.company.findMany({
    where: { source: "the-apprentice-guide" },
    orderBy: { name: "asc" },
  });
  return {
    companies,
    fetchedAt: snapshot.fetchedAt,
    total: snapshot.data.length,
    source: snapshot.source,
    query: snapshot.query,
  };
}
