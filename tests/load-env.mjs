/**
 * Safe test environment bootstrap.
 *
 * `tsx` does not load Next's env files, but Prisma Client does load `.env`,
 * which in this repository can point at production. That combination meant a
 * plain `npm test` could silently write to the wrong database.
 *
 * This module is loaded before any test file:
 *   1. load Next's env hierarchy, where `.env.local` overrides `.env`;
 *   2. prefer `TEST_DATABASE_URL` when it is explicitly supplied;
 *   3. refuse to continue unless the resulting database is local or clearly
 *      named as a test database.
 */

import nextEnv from '@next/env';

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

const url = process.env.DATABASE_URL ?? '';

let hostname = '';
let databaseName = '';
try {
  const parsed = new URL(url);
  hostname = parsed.hostname;
  databaseName = parsed.pathname.replace(/^\//, '');
} catch {
  // A malformed URL is treated as unsafe below.
}

const isLocal = ['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(hostname);
// A remote database is allowed only when its database name is clearly a test
// database. Testing the whole URL would let a password containing "test"
// accidentally satisfy the check.
const isTestNamed = /test/i.test(databaseName);

if (!url) {
  throw new Error(
    'No DATABASE_URL found. Set TEST_DATABASE_URL to a disposable local database before running tests.',
  );
}

if (!isLocal && !isTestNamed) {
  throw new Error(
    'Refusing to run tests against a non-local, non-test database. ' +
      'Set TEST_DATABASE_URL to a disposable database (or use .env.local).',
  );
}
