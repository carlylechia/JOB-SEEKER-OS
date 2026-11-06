import { unstable_cache } from 'next/cache';
import { prisma } from '@/lib/prisma';

export type LandingStats = {
  openRoles: number;
  hiringCompanies: number;
  connectedSources: number;
  countriesCovered: number;
};

const FALLBACK_STATS: LandingStats = {
  openRoles: 6500,
  hiringCompanies: 500,
  connectedSources: 85,
  countriesCovered: 40,
};

type RawRow = {
  open_roles: number | bigint | string;
  hiring_companies: number | bigint | string;
  connected_sources: number | bigint | string;
  countries_covered: number | bigint | string;
};

function toNumber(value: number | bigint | string): number {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') return Number(value);
  return value;
}

async function computeLandingStats(): Promise<LandingStats> {
  try {
    const rows = await prisma.$queryRaw<RawRow[]>`
      SELECT
        (SELECT COUNT(*)::int FROM "ExternalJob" ej
          WHERE ej.status = 'OPEN'
            AND ej."closedAt" IS NULL
            AND (ej."expiresAt" IS NULL OR ej."expiresAt" > NOW())) AS open_roles,
        (SELECT COUNT(DISTINCT ej.company)::int FROM "ExternalJob" ej
          WHERE ej.status = 'OPEN'
            AND ej."closedAt" IS NULL
            AND (ej."expiresAt" IS NULL OR ej."expiresAt" > NOW())) AS hiring_companies,
        (SELECT COUNT(*)::int FROM "JobSource" js WHERE js.enabled = true) AS connected_sources,
        (SELECT COUNT(DISTINCT cc)::int
           FROM "ExternalJob" ej
           CROSS JOIN LATERAL unnest(ej."countryCodes") AS cc
          WHERE ej.status = 'OPEN'
            AND ej."closedAt" IS NULL
            AND (ej."expiresAt" IS NULL OR ej."expiresAt" > NOW())) AS countries_covered
    `;

    const row = rows[0];
    if (!row) return FALLBACK_STATS;

    const stats: LandingStats = {
      openRoles: toNumber(row.open_roles),
      hiringCompanies: toNumber(row.hiring_companies),
      connectedSources: toNumber(row.connected_sources),
      countriesCovered: toNumber(row.countries_covered),
    };

    // Guard against degenerate/empty catalogs so the marketing surface never
    // shows a misleading "0 open roles".
    if (stats.openRoles <= 0) return FALLBACK_STATS;
    return stats;
  } catch {
    return FALLBACK_STATS;
  }
}

export const getLandingStats = unstable_cache(
  computeLandingStats,
  ['landing-stats'],
  { revalidate: 300 },
);
