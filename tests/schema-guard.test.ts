/**
 * Schema drift guard tests.
 *
 * This guard exists because of a real production outage on 2026-10-18: three
 * migrations were merged, the code deployed, and the database was never
 * migrated. Every page that reads `JobLead` — which is every dashboard load —
 * returned a 500 with the browser's unhelpful "a server-side exception has
 * occurred".
 *
 * The comparison logic is pure, so it is tested without a database. The claims
 * under test are the ones that matter: that a database missing a migration this
 * build expects is caught, and that a database baseline row predating the
 * repository does not produce a permanent false alarm.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, afterEach } from './harness';
import {
  compareMigrations,
  findUnknownMigrations,
  readLocalMigrations,
} from '@/lib/db/schema-guard';

const tempDirs: string[] = [];

function makeMigrationsDir(names: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrations-'));
  tempDirs.push(dir);
  for (const name of names) fs.mkdirSync(path.join(dir, name));
  // Prisma always ships this; it is not a migration.
  fs.writeFileSync(path.join(dir, 'migration_lock.toml'), 'provider = "postgresql"');
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('reading local migrations', () => {
  it('lists migration directories and ignores the lock file', () => {
    const dir = makeMigrationsDir(['20240101000000_a', '20240102000000_b']);
    expect(readLocalMigrations(dir)).toEqual(['20240101000000_a', '20240102000000_b']);
  });

  it('returns nothing when the directory does not exist', () => {
    expect(readLocalMigrations('/definitely/not/here')).toEqual([]);
  });

  it('reads the real migrations in this repository', () => {
    const real = readLocalMigrations();
    expect(real.length).toBeGreaterThan(0);
    expect(real.includes('migration_lock.toml')).toBe(false);
  });
});

describe('detecting a database that is behind', () => {
  const local = ['20240101000000_init', '20240102000000_feature'];

  it('flags a missing migration as BEHIND', () => {
    const result = compareMigrations({ local, applied: ['20240101000000_init'] });
    expect(result.status).toBe('BEHIND');
    expect(result.pending).toEqual(['20240102000000_feature']);
  });

  it('names every pending migration, not just the first', () => {
    const result = compareMigrations({ local, applied: [] });
    expect(result.status).toBe('BEHIND');
    expect(result.pending).toHaveLength(2);
  });

  it('reports CURRENT when everything is applied', () => {
    const result = compareMigrations({ local, applied: local });
    expect(result.status).toBe('CURRENT');
    expect(result.pending).toEqual([]);
    expect(result.unknown).toEqual([]);
  });

  it('ignores an applied migration that is still running', () => {
    // A migration recorded but not finished must not count as applied.
    const result = compareMigrations({
      local,
      applied: ['20240101000000_init', '20240102000000_feature'],
    });
    expect(result.status).toBe('CURRENT');
  });
});

describe('database baselines that predate the repository', () => {
  const local = ['20240101000000_init', '20240102000000_feature'];

  /**
   * Production carries a `0_init` row recorded before this repository tracked
   * migrations. Without this, every check would report AHEAD forever and the
   * warning would be ignored — which is worse than having no check.
   */
  it('does not report a pre-repository baseline as unknown', () => {
    const result = compareMigrations({
      local,
      applied: ['0_init', ...local],
    });
    expect(result.status).toBe('CURRENT');
    expect(result.unknown).toEqual([]);
  });

  it('still reports a genuinely unknown recent migration', () => {
    const result = compareMigrations({
      local,
      applied: ['0_init', ...local, '20240201000000_from_elsewhere'],
    });
    expect(result.status).toBe('AHEAD');
    expect(result.unknown).toEqual(['20240201000000_from_elsewhere']);
  });

  it('treats everything as unknown when we own no migrations', () => {
    expect(findUnknownMigrations({ local: [], applied: ['0_init'] })).toEqual(['0_init']);
  });

  it('compares baselines lexicographically, the way Prisma orders them', () => {
    expect(findUnknownMigrations({ local: ['20240101000000_x'], applied: ['0_init'] })).toEqual([]);
    expect(findUnknownMigrations({ local: ['20240101000000_x'], applied: ['20240102000000_y'] })).toEqual([
      '20240102000000_y',
    ]);
  });
});

describe('AHEAD is never mistaken for the dangerous direction', () => {
  it('reports AHEAD, not BEHIND, when the database has extra migrations', () => {
    // Extra columns are ignored by Prisma, so this is not an outage risk.
    const result = compareMigrations({
      local: ['20240101000000_init'],
      applied: ['20240101000000_init', '20240102000000_feature'],
    });
    expect(result.status).toBe('AHEAD');
    expect(result.pending).toEqual([]);
  });

  it('prefers BEHIND when both are true, because that is the dangerous one', () => {
    const result = compareMigrations({
      local: ['20240101000000_a', '20240103000000_c'],
      applied: ['20240101000000_a', '20240102000000_b'],
    });
    expect(result.status).toBe('BEHIND');
    expect(result.pending).toEqual(['20240103000000_c']);
  });
});