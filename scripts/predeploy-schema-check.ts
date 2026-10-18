/**
 * Predeploy schema gate.
 *
 * Run before deploying the application. Exits non-zero when the target database
 * is provably behind this build, which turns "deploy code, migrate later, hope
 * nobody notices" from a silent outage into a failed command.
 *
 *   npm run predeploy -- --production     check only, never migrates
 *
 * It NEVER migrates. Deploying migrations from a build machine, a CI runner or
 * a preview build is how two people end up running `migrate dev` against
 * production. This script only reads.
 */

import { checkSchemaDrift, explainDrift } from '@/lib/db/schema-guard';

async function main() {
  const target = process.argv.includes('--production') ? 'production' : 'the target database';

  /**
   * `--report` describes without judging.
   *
   * The deploy pipeline uses this BEFORE migrating, where drift is expected
   * and is the thing about to be fixed. Exiting non-zero there would fail the
   * pipeline for the very thing it is about to resolve.
   */
  const reportOnly = process.argv.includes('--report');

  console.log(`\nChecking that ${target} matches this build...\n`);

  const report = await checkSchemaDrift();

  console.log(explainDrift(report));

  if (reportOnly) {
    console.log(
      report.status === 'BEHIND'
        ? `  ${report.pending.length} migration(s) pending — apply with \`prisma migrate deploy\`.\n`
        : '  Nothing to apply.\n',
    );
    return;
  }

  if (report.status === 'BEHIND') {
    console.error(
      '  STOP. Deploying now would take the dashboard down for every user.\n' +
        '  Apply the migration first:\n\n' +
        '    DATABASE_URL="<production-url>" npm run prisma:migrate:deploy\n',
    );
    process.exit(1);
  }

  if (report.status === 'UNKNOWN') {
    console.warn(
      '  Proceeding, but the check did not run. Verify manually before deploying:\n\n' +
        '    DATABASE_URL="<production-url>" npm run prisma:migrate:status\n',
    );
    return;
  }

  console.log('  Safe to deploy.\n');
}

main().catch((error) => {
  console.error('\n  Schema check failed to run:', error instanceof Error ? error.message : error);
  // Fail closed on an unexpected crash, but distinguish it from proven drift so
  // the message stays honest about what is known.
  console.error('  Verify manually: npm run prisma:migrate:status\n');
  process.exit(1);
});