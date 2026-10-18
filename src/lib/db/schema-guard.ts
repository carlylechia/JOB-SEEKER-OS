/**
 * Schema drift detection.
 *
 * THE FAILURE THIS EXISTS TO PREVENT
 *
 * Vercel deploys code the moment it is merged. The database is a separate
 * system that only changes when someone runs `prisma migrate deploy`. Those two
 * facts combine into a window where the deployed code queries columns the
 * database does not have:
 *
 *     deployed code  →  SELECT "jobDescription" FROM "JobLead"
 *     production DB  →  column does not exist
 *
 * The result is a 500 on every page that touches the table — which on this
 * application means the dashboard, because the dashboard reads JobLead on every
 * load. That outage happened on 2026-10-18 when three migrations were merged
 * but never deployed.
 *
 * Why it is not caught by anything else:
 *
 *  - `tsc` is static. It checks the code, never the database.
 *  - The test suite runs against a LOCAL database that is always current.
 *  - `prisma generate` validates the schema against the CLIENT, not the server.
 *  - The browser reports "a server-side exception has occurred", which names no
 *    table and no column and is very slow to diagnose from a support ticket.
 *
 * So the check is explicit: compare the migrations committed in this repository
 * against the migrations actually recorded as finished in the target database.
 * If the database is behind, that is a proven mismatch and we refuse to
 * continue. If the database is unreachable we cannot prove anything, so we warn
 * rather than block — an unreachable database is not evidence of drift.
 */

import fs from 'node:fs';
import path from 'node:path';

import { prisma } from '@/lib/prisma';

export type SchemaDriftStatus = 'CURRENT' | 'BEHIND' | 'AHEAD' | 'UNKNOWN';

export type SchemaDriftReport = {
  status: SchemaDriftStatus;
  /** Migrations committed here but not applied to the database. */
  pending: string[];
  /** Migrations applied in the database that this build does not contain. */
  unknown: string[];
  /** Set when the database could not be reached. */
  error?: string;
};

/**
 * Migrations committed in this repository.
 *
 * Read from disk rather than hardcoded so a migration can never be added
 * without this check noticing it. `migration_lock.toml` is not a migration.
 */
export function readLocalMigrations(migrationsDir?: string): string[] {
  const dir = migrationsDir ?? path.join(process.cwd(), 'prisma', 'migrations');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** Migrations the database reports as successfully finished. */
export async function readAppliedMigrations(): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ migration_name: string; finished_at: Date | null }>>`
    SELECT migration_name, finished_at FROM "_prisma_migrations"
  `;
  return rows.filter((row) => row.finished_at !== null).map((row) => row.migration_name);
}

/**
 * Applied migrations this build does not contain, ignoring database-level
 * baselines that predate the repository's history.
 *
 * Production carries a `0_init` row recorded before this repository tracked
 * migrations. That is not drift, it is history, and reporting it on every check
 * would train people to ignore the warning. Anything sorting before the
 * earliest migration we own is treated as such a baseline.
 */
export function findUnknownMigrations(params: { local: string[]; applied: string[] }): string[] {
  const localSet = new Set(params.local);
  const earliestLocal = params.local[0];
  if (!earliestLocal) return params.applied;

  return params.applied.filter((name) => !localSet.has(name) && name >= earliestLocal);
}

/**
 * Compare the two.
 *
 * Pure apart from the two reads above, so the comparison logic is unit-testable
 * without a database.
 */
export function compareMigrations(params: {
  local: string[];
  applied: string[];
}): Pick<SchemaDriftReport, 'status' | 'pending' | 'unknown'> {
  const appliedSet = new Set(params.applied);

  // Committed here, not in the database. DANGEROUS: deployed code will query
  // things that do not exist.
  const pending = params.local.filter((name) => !appliedSet.has(name));

  // In the database, not committed here. Not immediately dangerous (extra
  // columns are ignored), but it means the wrong build is pointed here.
  const unknown = findUnknownMigrations(params);

  const status: SchemaDriftStatus = pending.length > 0 ? 'BEHIND' : unknown.length > 0 ? 'AHEAD' : 'CURRENT';

  return { status, pending, unknown };
}

/** Full check. Never throws — the caller decides what to do with the result. */
export async function checkSchemaDrift(migrationsDir?: string): Promise<SchemaDriftReport> {
  const local = readLocalMigrations(migrationsDir);
  try {
    const applied = await readAppliedMigrations();
    return { ...compareMigrations({ local, applied }) };
  } catch (error) {
    return {
      status: 'UNKNOWN',
      pending: [],
      unknown: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * A human explanation, written for whoever is mid-deploy at 2am.
 *
 * The previous behaviour was a generic "server-side exception" on the
 * dashboard. This says exactly which migration is missing and exactly which
 * command fixes it.
 */
export function explainDrift(report: SchemaDriftReport): string {
  switch (report.status) {
    case 'BEHIND':
      return [
        '',
        '  ✗ DATABASE SCHEMA IS BEHIND THIS BUILD',
        '',
        `    ${report.pending.length} migration(s) are committed here but not applied to the database:`,
        ...report.pending.map((name) => `      • ${name}`),
        '',
        '    Deploying now would 500 every page that reads the affected tables.',
        '    Fix it first, from a trusted machine:',
        '',
        '      DATABASE_URL="<production-url>" npm run prisma:migrate:deploy',
        '',
      ].join('\n');

    case 'AHEAD':
      return [
        '',
        '  ⚠ DATABASE HAS MIGRATIONS THIS BUILD DOES NOT CONTAIN',
        '',
        ...report.unknown.map((name) => `      • ${name}`),
        '',
        '    This usually means the wrong branch is deployed, or the database',
        '    belongs to a different environment. Extra columns are harmless, but',
        '    confirm this is the intended build before continuing.',
        '',
      ].join('\n');

    case 'UNKNOWN':
      return [
        '',
        '  ⚠ COULD NOT VERIFY THE DATABASE SCHEMA',
        '',
        `    ${report.error ?? 'The database was unreachable.'}`,
        '',
        '    No drift detected either way — the check could not run. Deploying',
        '    without verifying is how the previous outage happened, so confirm',
        '    the migration state manually before continuing.',
        '',
      ].join('\n');

    default:
      return '  ✓ Database schema is up to date.\n';
  }
}

/**
 * Assert the schema is current, for use at build time.
 *
 * Fails the build ONLY on proven drift. An unreachable database warns and
 * continues, because blocking every deploy on a transient network blip would
 * train people to ignore this check — which is worse than not having it.
 */
export async function assertSchemaCurrent(options?: { migrationsDir?: string }): Promise<SchemaDriftReport> {
  const report = await checkSchemaDrift(options?.migrationsDir);

  if (report.status === 'BEHIND') {
    console.error(explainDrift(report));
    throw new Error(
      `Refusing to build: the database is missing ${report.pending.length} migration(s). ` +
        'Run `prisma migrate deploy` against the target database first.',
    );
  }

  console.log(explainDrift(report));
  return report;
}