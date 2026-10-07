/**
 * Test setup.
 *
 * Integration tests need a real Postgres database (the billing logic uses raw
 * row locks and transactions that cannot be meaningfully faked). They run
 * against `TEST_DATABASE_URL` and fall back to `DATABASE_URL`.
 *
 * SAFETY: the suite refuses to run against a database whose name does not look
 * like a test database, so it can never wipe production data.
 */

import { beforeAll, afterAll } from 'vitest';

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? '';

/**
 * Refuse to run destructive setup against anything that is not obviously a
 * local/test database.
 */
function assertSafeTestDatabase() {
  if (!url) {
    throw new Error(
      'No TEST_DATABASE_URL or DATABASE_URL set. Integration tests need a real Postgres instance.',
    );
  }
  const isLocal =
    url.includes('localhost') || url.includes('127.0.0.1') || url.includes('postgres:');
  const isTestNamed = /test/i.test(url);

  if (!isLocal && !isTestNamed) {
    throw new Error(
      'Refusing to run integration tests against a non-local, non-test database. ' +
        'Set TEST_DATABASE_URL to a disposable database.',
    );
  }
}

beforeAll(() => {
  assertSafeTestDatabase();
  // Long random secret: cron auth fails closed below 16 characters.
  process.env.CRON_SECRET = process.env.CRON_SECRET ?? 'test-cron-secret-value-0123456789';
  // Never attempt real delivery during tests.
  process.env.RESEND_API_KEY = process.env.RESEND_API_KEY ?? '';
  process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
});

afterAll(async () => {
  const { prisma } = await import('@/lib/prisma');
  await prisma.$disconnect();
});