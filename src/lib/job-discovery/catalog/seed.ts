import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { EMPLOYER_BOARD_SEEDS } from './employer-boards';
import { PROVIDER_DEFINITIONS } from './providers';

const VERIFIED_AT = new Date('2026-10-28T00:00:00.000Z');

const FEED_SOURCES: Prisma.JobSourceCreateManyInput[] = [
  {
    id: 'arbeitnow:feed',
    provider: 'arbeitnow',
    sourceType: 'free_aggregator',
    displayName: 'Arbeitnow',
    employerName: null,
    boardToken: null,
    careersUrl: 'https://www.arbeitnow.com',
    country: 'DE',
    region: 'Europe',
    industry: 'Cross-industry',
    enabled: true,
    verifiedAt: VERIFIED_AT,
    verificationNote: 'Free public job-board API; checked 2026-10-28.',
    descriptionMode: 'full',
    attribution: 'Job data provided by Arbeitnow',
    attributionUrl: 'https://www.arbeitnow.com',
    attributionRequired: true,
    allowStructuredData: false,
    retentionDays: 30,
  },
  {
    id: 'himalayas:feed',
    provider: 'himalayas',
    sourceType: 'free_aggregator',
    displayName: 'Himalayas',
    employerName: null,
    boardToken: null,
    careersUrl: 'https://himalayas.app',
    country: null,
    region: 'Global',
    industry: 'Cross-industry',
    enabled: true,
    verifiedAt: VERIFIED_AT,
    verificationNote: 'Free public JSON API; terms permit display with unchanged application link and visible attribution; checked 2026-10-28.',
    descriptionMode: 'full',
    attribution: 'Jobs by Himalayas',
    attributionUrl: 'https://himalayas.app',
    attributionRequired: true,
    allowStructuredData: false,
    retentionDays: null,
  },
  {
    id: 'remoteok:feed',
    provider: 'remoteok',
    sourceType: 'free_aggregator',
    displayName: 'Remote OK',
    employerName: null,
    boardToken: null,
    careersUrl: 'https://remoteok.com',
    country: null,
    region: 'Global',
    industry: 'Cross-industry',
    enabled: true,
    verifiedAt: VERIFIED_AT,
    verificationNote: 'Free public API; terms require a follow link back and a visible Remote OK mention; checked 2026-10-28.',
    descriptionMode: 'full',
    attribution: 'Remote OK',
    attributionUrl: 'https://remoteok.com',
    attributionRequired: true,
    allowStructuredData: false,
    retentionDays: 30,
  },
  {
    id: 'fourdayweek:feed',
    provider: 'fourdayweek',
    sourceType: 'free_aggregator',
    displayName: '4 Day Week',
    employerName: null,
    boardToken: null,
    careersUrl: 'https://4dayweek.io',
    country: null,
    region: 'Global',
    industry: 'Cross-industry',
    enabled: true,
    verifiedAt: VERIFIED_AT,
    verificationNote: 'Free public API, 60 requests/minute; terms require a link back. Newest listings are gated, so only unlocked records are ingested; checked 2026-10-28.',
    descriptionMode: 'full',
    attribution: 'Listed on 4 Day Week',
    attributionUrl: 'https://4dayweek.io',
    attributionRequired: true,
    allowStructuredData: false,
    retentionDays: 30,
  },
  {
    id: 'usajobs:feed',
    provider: 'usajobs',
    sourceType: 'government',
    displayName: 'USAJOBS',
    employerName: 'United States federal agencies',
    boardToken: null,
    careersUrl: 'https://www.usajobs.gov',
    country: 'US',
    region: 'North America',
    industry: 'Public sector',
    enabled: true,
    verifiedAt: VERIFIED_AT,
    verificationNote: 'Official Search API. Requires a free API key and a contact email in the User-Agent; disabled until both are configured. Checked 2026-10-28.',
    descriptionMode: 'full',
    attribution: 'USAJOBS',
    attributionUrl: 'https://www.usajobs.gov',
    attributionRequired: true,
    allowStructuredData: false,
    retentionDays: 60,
  },
  {
    id: 'headcountlabs:feed',
    provider: 'headcountlabs',
    sourceType: 'licensed_aggregator',
    displayName: 'Headcount Labs',
    employerName: null,
    boardToken: null,
    careersUrl: 'https://headcountlabs.com',
    country: null,
    region: 'Global',
    industry: 'Cross-industry',
    enabled: false,
    verifiedAt: VERIFIED_AT,
    verificationNote: 'Free allowance: 100,000 records/month, 30 requests/minute, 1,000 requests/day, no card. Disabled until HEADCOUNTLABS_API_KEY and HEADCOUNTLABS_LICENSE_ACK=true are set; checked 2026-10-28.',
    descriptionMode: 'full',
    attribution: 'Job data: Headcount Labs',
    attributionUrl: 'https://headcountlabs.com',
    attributionRequired: true,
    allowStructuredData: false,
    retentionDays: 30,
  },
];

function boardSeeds(): Prisma.JobSourceCreateManyInput[] {
  return EMPLOYER_BOARD_SEEDS.map((board) => {
    const definition = PROVIDER_DEFINITIONS[board.provider];
    return {
      id: `${board.provider}:${board.token}`,
      provider: board.provider,
      sourceType: definition.sourceType,
      displayName: `${board.employer} (${definition.displayName})`,
      employerName: board.employer,
      boardToken: board.token,
      careersUrl: board.careersUrl,
      country: board.country,
      region: board.region,
      industry: board.industry,
      enabled: true,
      verifiedAt: VERIFIED_AT,
      verificationNote: `Public ${definition.displayName} board API and employer careers page checked 2026-10-28.`,
      descriptionMode: board.descriptionMode,
      attribution: `${definition.displayName} public board`,
      attributionUrl: definition.siteUrl,
      attributionRequired: false,
      allowStructuredData: false,
      retentionDays: 45,
    };
  });
}

let seedPromise: Promise<void> | null = null;

/**
 * Add newly documented sources without overwriting admin decisions.
 * Existing rows keep their enabled flag, attribution overrides and last-sync
 * state, so deploying a new seed cannot silently re-enable a disabled source.
 */
export async function ensureJobSourcesSeeded() {
  if (!seedPromise) {
    seedPromise = (async () => {
      const rows = [...FEED_SOURCES, ...boardSeeds()];
      await prisma.jobSource.createMany({ data: rows, skipDuplicates: true });
    })().catch((error) => {
      seedPromise = null;
      throw error;
    });
  }
  return seedPromise;
}

export const SEEDED_SOURCE_COUNT = FEED_SOURCES.length + EMPLOYER_BOARD_SEEDS.length;
