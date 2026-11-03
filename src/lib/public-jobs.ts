import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { buildStoredJobPayload, getUserPreferences } from '@/lib/db-helpers';
import { titleMatchesAny } from '@/lib/preferences';
import { SeniorityLevel, UserPreferences } from '@/types';
import {
  CATEGORY_LABELS,
  SENIORITY_LABELS,
  normalizeJobCategory,
  normalizeSeniority,
  type JobCategory,
  type SeniorityLevel as JobSeniorityLevel,
} from '@/lib/job-discovery/categories';

export type PublicJobsSort = 'newest' | 'oldest' | 'salary';

export type PublicJobsQueryOptions = {
  q?: string;
  /** Filter title specifically (in addition to q which also searches company/location) */
  title?: string;
  /** How many days back to look. 0 = no limit */
  days?: number;
  take?: number;
  /** 1-based page number */
  page?: number;
  category?: string;
  remoteType?: string;
  seniority?: string;
  employmentType?: string;
  source?: string;
  minSalary?: number;
  sort?: PublicJobsSort;
  includeFacets?: boolean;
};

export type PublicJobRecord = {
  id: string;
  sourceType: 'lead' | 'catalog';
  title: string;
  company: string;
  location: string | null;
  remoteType: string | null;
  employmentType: string | null;
  seniority: string | null;
  category: JobCategory;
  industry: string | null;
  skills: string[];
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  source: string | null;
  jobUrl: string | null;
  listedAt: Date | string;
  postedAt: Date | string | null;
  attribution: string | null;
  attributionUrl: string | null;
};

export type PublicJobFacet = { value: string; label: string; count: number };

export type PublicJobFacets = {
  categories: PublicJobFacet[];
  sources: PublicJobFacet[];
  seniorities: PublicJobFacet[];
};

export type PublicJobsResult = {
  jobs: PublicJobRecord[];
  total: number;
  page: number;
  totalPages: number;
  facets?: PublicJobFacets;
};

export function getPublicJobsSinceDate(days = 30) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  return since;
}

export function normalizePublicJobsSearchQuery(value?: string | null) {
  return value?.trim() ?? '';
}

export function clampPublicJobsTake(value?: number, min = 1, max = 40) {
  if (!Number.isFinite(value)) return max;
  return Math.min(Math.max(Number(value), min), max);
}

export function normalizePublicJobsSort(value?: string | null): PublicJobsSort {
  return value === 'oldest' || value === 'salary' ? value : 'newest';
}

/**
 * Union of the two public inventories.
 *
 * Community leads and the automatically fetched catalog live in different
 * tables. The page must deduplicate across both (the same role often appears in
 * a feed and was also saved by a user), so the union happens in SQL and the
 * DISTINCT ON keeps the newest copy. Only safe, public fields are selected:
 * `JobLead.notes` is deliberately absent.
 */
function combinedInventorySql() {
  return Prisma.sql`
    SELECT
      'lead'::text AS kind,
      jl.id AS id,
      jl.title AS title,
      jl.company AS company,
      jl.location AS location,
      jl."remoteType" AS "remoteType",
      jl."employmentType" AS "employmentType",
      jl.seniority AS seniority,
      jl.category AS category,
      jl.industry AS industry,
      COALESCE(jl.skills, ARRAY[]::text[]) AS skills,
      jl."salaryMin" AS "salaryMin",
      jl."salaryMax" AS "salaryMax",
      jl.currency AS currency,
      jl.source AS source,
      jl."jobUrl" AS "jobUrl",
      jl."createdAt" AS "listedAt",
      jl."createdAt" AS "postedAt",
      NULL::text AS attribution,
      NULL::text AS "attributionUrl"
    FROM "JobLead" jl
    WHERE jl."deletedAt" IS NULL
      AND (jl."expiresAt" IS NULL OR jl."expiresAt" > NOW())

    UNION ALL

    SELECT
      'catalog'::text AS kind,
      ej.id AS id,
      ej.title AS title,
      ej.company AS company,
      ej.location AS location,
      ej."remoteType" AS "remoteType",
      ej."employmentType" AS "employmentType",
      ej.seniority AS seniority,
      ej.category AS category,
      ej.industry AS industry,
      COALESCE(ej.skills, ARRAY[]::text[]) AS skills,
      ej."salaryMin" AS "salaryMin",
      ej."salaryMax" AS "salaryMax",
      ej.currency AS currency,
      ej.source AS source,
      COALESCE(ej."applicationUrl", ej."canonicalUrl") AS "jobUrl",
      COALESCE(ej."publishedAt", ej."firstSeenAt") AS "listedAt",
      ej."publishedAt" AS "postedAt",
      ej.attribution AS attribution,
      ej."attributionUrl" AS "attributionUrl"
    FROM "ExternalJob" ej
    WHERE ej.status = 'OPEN'
      AND ej."closedAt" IS NULL
      AND (ej."expiresAt" IS NULL OR ej."expiresAt" > NOW())
  `;
}

function buildPublicJobFilters(options: PublicJobsQueryOptions) {
  const q = normalizePublicJobsSearchQuery(options.q);
  const titleQ = options.title?.trim() ?? '';
  const days = options.days ?? 30;
  const filters: Prisma.Sql[] = [];

  if (days > 0) {
    filters.push(Prisma.sql`"listedAt" >= ${getPublicJobsSinceDate(Math.floor(days))}`);
  }
  if (q) {
    const like = `%${q}%`;
    filters.push(
      Prisma.sql`(
        title ILIKE ${like}
        OR company ILIKE ${like}
        OR COALESCE(location, '') ILIKE ${like}
        OR EXISTS (SELECT 1 FROM unnest(skills) AS skill WHERE skill ILIKE ${like})
      )`,
    );
  }
  if (titleQ) filters.push(Prisma.sql`title ILIKE ${`%${titleQ}%`}`);

  const category = options.category?.trim().toUpperCase();
  if (category && category !== 'ALL') {
    filters.push(Prisma.sql`UPPER(COALESCE(category, '')) = ${category}`);
  }

  const remoteType = options.remoteType?.trim().toLowerCase();
  if (remoteType === 'remote') {
    filters.push(
      Prisma.sql`LOWER(COALESCE("remoteType", '')) LIKE '%remote%' AND LOWER(COALESCE("remoteType", '')) NOT LIKE '%hybrid%'`,
    );
  } else if (remoteType === 'hybrid') {
    filters.push(Prisma.sql`LOWER(COALESCE("remoteType", '')) LIKE '%hybrid%'`);
  } else if (remoteType === 'onsite') {
    filters.push(
      Prisma.sql`(LOWER(COALESCE("remoteType", '')) LIKE '%onsite%' OR LOWER(COALESCE("remoteType", '')) LIKE '%on-site%')`,
    );
  }

  const seniority = options.seniority?.trim().toUpperCase();
  if (seniority && seniority !== 'ALL') {
    filters.push(Prisma.sql`UPPER(COALESCE(seniority, '')) = ${seniority}`);
  }

  const employmentType = options.employmentType?.trim().toUpperCase();
  if (employmentType && employmentType !== 'ALL') {
    filters.push(Prisma.sql`UPPER(COALESCE("employmentType", '')) = ${employmentType}`);
  }

  const source = options.source?.trim();
  if (source && source !== 'ALL') {
    filters.push(Prisma.sql`LOWER(COALESCE(source, '')) = ${source.toLowerCase()}`);
  }

  if (Number.isFinite(options.minSalary) && Number(options.minSalary) > 0) {
    filters.push(
      Prisma.sql`COALESCE("salaryMax", "salaryMin", 0) >= ${Math.floor(Number(options.minSalary))}`,
    );
  }

  return filters.length > 0 ? Prisma.sql`WHERE ${Prisma.join(filters, ' AND ')}` : Prisma.empty;
}

function dedupedInventorySql(options: PublicJobsQueryOptions) {
  return Prisma.sql`
    SELECT DISTINCT ON (lower(btrim(company)), lower(btrim(title))) *
    FROM combined
    ${buildPublicJobFilters(options)}
    ORDER BY lower(btrim(company)), lower(btrim(title)), "listedAt" DESC
  `;
}

function orderBySql(sort: PublicJobsSort) {
  if (sort === 'oldest') return Prisma.sql`"listedAt" ASC, title ASC`;
  if (sort === 'salary') {
    return Prisma.sql`COALESCE("salaryMax", "salaryMin", 0) DESC, "listedAt" DESC, title ASC`;
  }
  return Prisma.sql`"listedAt" DESC, title ASC`;
}

type RawPublicJobRow = {
  kind: 'lead' | 'catalog';
  id: string;
  title: string;
  company: string;
  location: string | null;
  remoteType: string | null;
  employmentType: string | null;
  seniority: string | null;
  category: string | null;
  industry: string | null;
  skills: string[] | null;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  source: string | null;
  jobUrl: string | null;
  listedAt: Date;
  postedAt: Date | null;
  attribution: string | null;
  attributionUrl: string | null;
};

function mapPublicJobRow(row: RawPublicJobRow): PublicJobRecord {
  const category = normalizeJobCategory(row.category, row.title, row.skills ?? []);
  return {
    id: `${row.kind}:${row.id}`,
    sourceType: row.kind,
    title: row.title,
    company: row.company,
    location: row.location,
    remoteType: row.remoteType,
    employmentType: row.employmentType,
    seniority: row.seniority || normalizeSeniority(null, row.title),
    category,
    industry: row.industry,
    skills: Array.isArray(row.skills) ? row.skills : [],
    salaryMin: row.salaryMin,
    salaryMax: row.salaryMax,
    currency: row.currency,
    source: row.source,
    jobUrl: row.jobUrl,
    listedAt: row.listedAt,
    postedAt: row.postedAt,
    attribution: row.attribution,
    attributionUrl: row.attributionUrl,
  };
}

export async function getPublicJobs(options: PublicJobsQueryOptions = {}): Promise<PublicJobsResult> {
  const perPage = clampPublicJobsTake(options.take, 1, 40);
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const sort = normalizePublicJobsSort(options.sort);
  const combined = combinedInventorySql();
  const deduped = dedupedInventorySql(options);

  const countPromise = prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
    WITH combined AS (${combined}),
    deduped AS (${deduped})
    SELECT COUNT(*)::int AS count FROM deduped
  `);

  // A page is only fetched after the count is known, because the page number
  // may need clamping to the last page. The two queries are still cheap enough
  // to run on every request and avoid stale offset pages.
  const countRows = await countPromise;
  const total = Number(countRows[0]?.count ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const clampedPage = Math.min(page, totalPages);
  const offset = (clampedPage - 1) * perPage;

  const rows = await prisma.$queryRaw<RawPublicJobRow[]>(Prisma.sql`
    WITH combined AS (${combined}),
    deduped AS (${deduped})
    SELECT * FROM deduped
    ORDER BY ${orderBySql(sort)}
    LIMIT ${perPage} OFFSET ${offset}
  `);

  const jobs = rows.map(mapPublicJobRow);
  const facets = options.includeFacets ? await getPublicJobFacets(options) : undefined;
  return { jobs, total, page: clampedPage, totalPages, facets };
}

export async function getPublicJobFacets(options: PublicJobsQueryOptions = {}): Promise<PublicJobFacets> {
  const days = options.days ?? 30;
  const combined = combinedInventorySql();
  const dayFilter =
    days > 0
      ? Prisma.sql`WHERE "listedAt" >= ${getPublicJobsSinceDate(Math.floor(days))}`
      : Prisma.empty;

  const [categoryRows, sourceRows, seniorityRows] = await Promise.all([
    prisma.$queryRaw<Array<{ value: string; count: number }>>(Prisma.sql`
      WITH combined AS (${combined})
      SELECT UPPER(category) AS value, COUNT(*)::int AS count
      FROM combined
      ${dayFilter}
      ${dayFilter ? Prisma.sql`AND` : Prisma.sql`WHERE`} category IS NOT NULL AND category <> ''
      GROUP BY UPPER(category)
      ORDER BY count DESC
    `),
    prisma.$queryRaw<Array<{ value: string; count: number }>>(Prisma.sql`
      WITH combined AS (${combined})
      SELECT source AS value, COUNT(*)::int AS count
      FROM combined
      ${dayFilter}
      ${dayFilter ? Prisma.sql`AND` : Prisma.sql`WHERE`} source IS NOT NULL AND source <> ''
      GROUP BY source
      ORDER BY count DESC
      LIMIT 30
    `),
    prisma.$queryRaw<Array<{ value: string; count: number }>>(Prisma.sql`
      WITH combined AS (${combined})
      SELECT UPPER(seniority) AS value, COUNT(*)::int AS count
      FROM combined
      ${dayFilter}
      ${dayFilter ? Prisma.sql`AND` : Prisma.sql`WHERE`} seniority IS NOT NULL
        AND seniority <> ''
        AND UPPER(seniority) <> 'UNKNOWN'
      GROUP BY UPPER(seniority)
      ORDER BY count DESC
    `),
  ]);

  return {
    categories: categoryRows
      .filter((row) => row.value in CATEGORY_LABELS)
      .map((row) => ({
        value: row.value,
        label: CATEGORY_LABELS[row.value as JobCategory],
        count: Number(row.count),
      })),
    sources: sourceRows.map((row) => ({
      value: row.value,
      label: row.value.replace(/:feed$/, '').replace(/[-_]/g, ' '),
      count: Number(row.count),
    })),
    seniorities: seniorityRows
      .filter((row) => row.value in SENIORITY_LABELS)
      .map((row) => ({
        value: row.value,
        label: SENIORITY_LABELS[row.value as JobSeniorityLevel],
        count: Number(row.count),
      })),
  };
}

export {
  formatPublicJobAge,
  formatPublicJobEmploymentType,
  formatPublicJobLocation,
  formatPublicJobSalary,
  formatPublicJobSeniority,
  formatPublicJobSource,
} from '@/lib/public-job-filters';

// ─── Import into a user's workspace ────────────────────────────────────────

type PublicJobSource = {
  title: string;
  location: string | null;
  remoteType: string | null;
  timezoneRequirement: string | null;
  eligibilityRegion: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  notes: string | null;
};

function includesAnyCI(text: string, needles: string[]): boolean {
  const lower = text.toLowerCase();
  return needles.some((n) => lower.includes(n.toLowerCase()));
}

const SENIOR_KEYWORDS = ['senior', 'sr.', 'sr ', 'lead', 'principal', 'staff', 'architect', 'head of', 'director'];
const ENTRY_KEYWORDS = ['junior', 'jr.', 'jr ', 'associate', 'entry level', 'entry-level', 'graduate', 'intern'];

function inferSeniorityScore(titleLower: string, targetLevel: SeniorityLevel): number {
  const isSenior = SENIOR_KEYWORDS.some((kw) => titleLower.includes(kw));
  const isEntry = ENTRY_KEYWORDS.some((kw) => titleLower.includes(kw));
  const isMid = !isSenior && !isEntry;

  if (targetLevel === 'FLEXIBLE') return 3;
  if (targetLevel === 'SENIOR') return isSenior ? 4 : isEntry ? 1 : 3;
  if (targetLevel === 'ENTRY') return isEntry ? 4 : isSenior ? 1 : 3;
  return isMid ? 4 : isSenior ? 2 : 3;
}

const REGION_KEYWORDS: Record<string, string[]> = {
  US: ['us', 'usa', 'united states', 'north america', 'us only', 'us-based'],
  EU: ['eu', 'europe', 'european union', 'emea', 'uk', 'united kingdom'],
  AFRICA: ['africa', 'african', 'nigeria', 'kenya', 'ghana', 'south africa'],
  WORLDWIDE: ['worldwide', 'global', 'anywhere', 'international'],
  FLEXIBLE: ['flexible'],
};

function inferGeographyScore(source: PublicJobSource, preferences: UserPreferences): number {
  const locationText = `${source.location ?? ''} ${source.eligibilityRegion ?? ''} ${source.remoteType ?? ''} ${source.notes ?? ''}`;
  const isRemote = /remote/i.test(locationText);

  const userWorkRegionKeywords = preferences.workRegions.flatMap(
    (r) => REGION_KEYWORDS[r] ?? [r.toLowerCase()],
  );

  const jobMatchesUserRegion =
    preferences.workRegions.includes('WORLDWIDE') ||
    (userWorkRegionKeywords.length > 0 && includesAnyCI(locationText, userWorkRegionKeywords)) ||
    (isRemote && preferences.workRegions.length > 0);

  let score = jobMatchesUserRegion ? 4 : 3;

  if (preferences.remoteOnly && !isRemote) {
    score = Math.max(1, score - 2);
  }

  return score;
}

function inferTimezoneScore(source: PublicJobSource, preferences: UserPreferences): number {
  if (!source.timezoneRequirement?.trim()) return 4;
  if (preferences.timezoneMatches.length === 0) return 3;
  const tzText = `${source.timezoneRequirement} ${source.notes ?? ''}`;
  return includesAnyCI(tzText, preferences.timezoneMatches) ? 4 : 2;
}

function inferCompensationScore(source: PublicJobSource, preferences: UserPreferences): number {
  const hasSalary = source.salaryMin != null || source.salaryMax != null;
  const hasPrefs = preferences.salaryMin > 0 || preferences.salaryTarget > 0;
  if (!hasSalary || !hasPrefs) return 3;

  const jobRef = source.salaryMax ?? source.salaryMin ?? 0;
  const userMin = preferences.salaryMin;
  const userTarget = preferences.salaryTarget > 0 ? preferences.salaryTarget : userMin * 1.25;
  if (jobRef < userMin) return 1;
  if (jobRef >= userTarget) return 5;
  const ratio = (jobRef - userMin) / (userTarget - userMin);
  return Math.round(2 + ratio * 2);
}

/**
 * Infer initial score components from available public job metadata and user
 * preferences. These replace the naive all-3 defaults so that fit scoring is
 * immediately meaningful without the user manually filling every slider.
 *
 * coreStackMatch / domainRelevance / applicationFriction / signalQuality are
 * kept at 3 (neutral) because they require full job-posting text to assess.
 */
function inferScoreComponents(source: PublicJobSource, preferences: UserPreferences) {
  const titleLower = source.title.toLowerCase();
  const roleSources = [...preferences.targetRoles, ...preferences.preferredTitles].filter(Boolean);
  const roleAlignment = roleSources.length
    ? (titleMatchesAny(source.title, roleSources) ? 4 : 2)
    : 3;

  return {
    roleAlignment,
    seniorityFit: inferSeniorityScore(titleLower, preferences.targetLevel),
    geographyEligibility: inferGeographyScore(source, preferences),
    timezoneCompatibility: inferTimezoneScore(source, preferences),
    compensationFit: inferCompensationScore(source, preferences),
    coreStackMatch: 3,
    domainRelevance: 3,
    applicationFriction: 3,
    signalQuality: 3,
  };
}

async function findExistingJob(userId: string, company: string, title: string, jobUrl: string | null) {
  return prisma.jobLead.findFirst({
    where: {
      userId,
      OR: [
        ...(jobUrl ? [{ jobUrl }] : []),
        { company, title },
      ],
    },
  });
}

async function restoreOrReturnExisting(existing: { id: string; deletedAt: Date | null }) {
  if (existing.deletedAt !== null) {
    await prisma.jobLead.update({ where: { id: existing.id }, data: { deletedAt: null } });
  }
  return existing.id;
}

type NewJobLeadInput = {
  userId: string;
  company: string;
  title: string;
  source: string;
  jobUrl: string;
  location: string;
  remoteType: string;
  timezoneRequirement: string;
  eligibilityRegion: string;
  employmentType: string;
  seniority: string;
  category: string;
  industry: string;
  skills: string[];
  requirements: unknown;
  companyProfile: unknown;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string;
  jobDescription: string;
  expiresAt: Date | null;
};

async function createWorkspaceJob(input: NewJobLeadInput, preferences: UserPreferences) {
  const inferred = inferScoreComponents(
    {
      title: input.title,
      location: input.location,
      remoteType: input.remoteType,
      timezoneRequirement: input.timezoneRequirement,
      eligibilityRegion: input.eligibilityRegion,
      salaryMin: input.salaryMin,
      salaryMax: input.salaryMax,
      notes: null,
    },
    preferences,
  );

  const jobPayload = buildStoredJobPayload(
    {
      company: input.company,
      title: input.title,
      source: input.source,
      jobUrl: input.jobUrl,
      location: input.location,
      remoteType: input.remoteType,
      timezoneRequirement: input.timezoneRequirement,
      eligibilityRegion: input.eligibilityRegion,
      employmentType: input.employmentType,
      seniority: input.seniority,
      category: input.category,
      industry: input.industry,
      skills: input.skills,
      requirements: input.requirements,
      companyProfile: input.companyProfile,
      salaryMin: input.salaryMin != null ? String(input.salaryMin) : '',
      salaryMax: input.salaryMax != null ? String(input.salaryMax) : '',
      currency: input.currency,
      notes: '',
      jobDescription: input.jobDescription,
      status: 'LEAD',
      dateFound: new Date().toISOString().slice(0, 10),
      contacts: [],
      ...inferred,
    },
    preferences,
  );

  const cloned = await prisma.jobLead.create({
    data: {
      userId: input.userId,
      expiresAt: input.expiresAt,
      company: jobPayload.company,
      title: jobPayload.title,
      source: jobPayload.source,
      jobUrl: jobPayload.jobUrl ?? null,
      location: jobPayload.location,
      remoteType: jobPayload.remoteType,
      timezoneRequirement: jobPayload.timezoneRequirement,
      eligibilityRegion: jobPayload.eligibilityRegion,
      employmentType: jobPayload.employmentType || null,
      seniority: jobPayload.seniority || null,
      category: jobPayload.category || null,
      industry: jobPayload.industry || null,
      skills: jobPayload.skills ?? [],
      requirements: jobPayload.requirements,
      companyProfile: jobPayload.companyProfile,
      salaryMin: jobPayload.salaryMin ?? null,
      salaryMax: jobPayload.salaryMax ?? null,
      currency: jobPayload.currency,
      notes: jobPayload.notes,
      jobDescription: jobPayload.jobDescription || null,
      status: jobPayload.status,
      dateFound: new Date(jobPayload.dateFound),
      dateApplied: jobPayload.dateApplied ? new Date(jobPayload.dateApplied) : null,
      nextFollowUp: jobPayload.nextFollowUp ? new Date(jobPayload.nextFollowUp) : null,
      priorityFlag: jobPayload.priorityFlag,
      score: jobPayload.score,
      checklist: jobPayload.checklist,
      contacts: jobPayload.contacts,
      interviews: jobPayload.interviews,
      prepPack: jobPayload.prepPack,
    },
  });

  return cloned.id;
}

async function cloneCatalogJobForUser(catalogId: string, userId: string): Promise<string> {
  const sourceJob = await prisma.externalJob.findFirst({
    where: { id: catalogId, status: 'OPEN' },
    select: {
      id: true,
      title: true,
      company: true,
      source: true,
      location: true,
      remoteType: true,
      employmentType: true,
      seniority: true,
      category: true,
      industry: true,
      skills: true,
      salaryMin: true,
      salaryMax: true,
      currency: true,
      description: true,
      applicationUrl: true,
      canonicalUrl: true,
      attribution: true,
      expiresAt: true,
    },
  });
  if (!sourceJob) throw new Error(`Public catalog job not found: ${catalogId}`);

  const jobUrl = sourceJob.applicationUrl || sourceJob.canonicalUrl || '';
  const existing = await findExistingJob(userId, sourceJob.company, sourceJob.title, jobUrl || null);
  if (existing) return restoreOrReturnExisting(existing);

  const preferences = await getUserPreferences(userId);
  return createWorkspaceJob(
    {
      userId,
      company: sourceJob.company,
      title: sourceJob.title,
      source: sourceJob.attribution || sourceJob.source,
      jobUrl,
      location: sourceJob.location || '',
      remoteType: sourceJob.remoteType || '',
      timezoneRequirement: '',
      eligibilityRegion: (sourceJob.skills ?? []).join(', '),
      employmentType: sourceJob.employmentType || '',
      seniority: sourceJob.seniority || '',
      category: sourceJob.category || '',
      industry: sourceJob.industry || '',
      skills: sourceJob.skills ?? [],
      requirements: null,
      companyProfile: null,
      salaryMin: sourceJob.salaryMin,
      salaryMax: sourceJob.salaryMax,
      currency: sourceJob.currency || 'USD',
      jobDescription: sourceJob.description || '',
      expiresAt: sourceJob.expiresAt,
    },
    preferences,
  );
}

async function cloneCommunityJobForUser(sourceJobId: string, userId: string): Promise<string> {
  const sourceJob = await prisma.jobLead.findFirst({
    where: { id: sourceJobId, deletedAt: null },
    // Public cloning never needs the owner's private free-text notes. Selecting
    // explicit fields also stops `notes` reaching the cloned row or the fit
    // scorer.
    select: {
      company: true,
      title: true,
      source: true,
      jobUrl: true,
      location: true,
      remoteType: true,
      timezoneRequirement: true,
      eligibilityRegion: true,
      employmentType: true,
      seniority: true,
      category: true,
      industry: true,
      skills: true,
      requirements: true,
      companyProfile: true,
      jobDescription: true,
      salaryMin: true,
      salaryMax: true,
      currency: true,
      expiresAt: true,
    },
  });

  if (!sourceJob) throw new Error(`Public job not found: ${sourceJobId}`);

  const existing = await findExistingJob(userId, sourceJob.company, sourceJob.title, sourceJob.jobUrl);
  if (existing) return restoreOrReturnExisting(existing);

  const preferences = await getUserPreferences(userId);
  return createWorkspaceJob(
    {
      userId,
      company: sourceJob.company,
      title: sourceJob.title,
      source: sourceJob.source || '',
      jobUrl: sourceJob.jobUrl || '',
      location: sourceJob.location || '',
      remoteType: sourceJob.remoteType || '',
      timezoneRequirement: sourceJob.timezoneRequirement || '',
      eligibilityRegion: sourceJob.eligibilityRegion || '',
      employmentType: sourceJob.employmentType || '',
      seniority: sourceJob.seniority || '',
      category: sourceJob.category || '',
      industry: sourceJob.industry || '',
      skills: sourceJob.skills ?? [],
      requirements: sourceJob.requirements,
      companyProfile: sourceJob.companyProfile,
      salaryMin: sourceJob.salaryMin,
      salaryMax: sourceJob.salaryMax,
      currency: sourceJob.currency || 'USD',
      jobDescription: sourceJob.jobDescription || '',
      expiresAt: sourceJob.expiresAt,
    },
    preferences,
  );
}

/**
 * Clone a public job into a specific user's workspace.
 *
 * IDs are prefixed by source (`catalog:` / `lead:`) so the save route never
 * has to guess which table an id belongs to. Raw legacy ids are still accepted
 * as community leads for links and cookies created before this release.
 */
export async function clonePublicJobForUser(
  sourceJobId: string,
  userId: string,
): Promise<string> {
  if (sourceJobId.startsWith('catalog:')) {
    return cloneCatalogJobForUser(sourceJobId.slice('catalog:'.length), userId);
  }
  if (sourceJobId.startsWith('lead:')) {
    return cloneCommunityJobForUser(sourceJobId.slice('lead:'.length), userId);
  }
  return cloneCommunityJobForUser(sourceJobId, userId);
}
