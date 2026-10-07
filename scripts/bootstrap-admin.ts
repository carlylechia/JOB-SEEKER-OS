#!/usr/bin/env tsx
/**
 * Admin bootstrap — promotes exactly ONE existing account to ADMIN.
 *
 *   npm run admin:bootstrap -- you@yourdomain.com
 *
 * There is deliberately NO public admin-registration route, no "is admin?"
 * signup field, and no client-side admin email. Admin access is granted only
 * through this server-side/CLI operation, which:
 *   - requires an explicit email argument
 *   - normalises and validates it
 *   - verifies the account already exists (never creates one)
 *   - promotes only that exact account
 *   - writes an audit event
 *
 * To revoke admin access, run `npm run admin:revoke -- you@yourdomain.com`.
 */

import { prisma } from '../src/lib/prisma';
import { logImportantInfo } from '../src/lib/observability';

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const emailArg = args[0];

  if (!emailArg) {
    console.error('\n  Usage: npm run admin:bootstrap -- you@yourdomain.com\n');
    process.exit(1);
  }

  const email = normalizeEmail(emailArg);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error(`\n  "${emailArg}" is not a valid email address.\n`);
    process.exit(1);
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, role: true },
  });

  if (!user) {
    console.error(`\n  No account exists for ${email}.`);
    console.error('  Create the account through the normal registration flow first,');
    console.error('  then re-run this command.\n');
    process.exit(1);
  }

  if (user.role === 'ADMIN') {
    console.log(`\n  ${email} is already an ADMIN. Nothing to do.\n`);
    return;
  }

  await prisma.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });

  await logImportantInfo({
    event: 'admin_role_granted',
    userId: user.id,
    context: { email, method: 'cli_bootstrap' },
  });

  console.log(`\n  Promoted ${email} to ADMIN.`);
  console.log('  Verify by signing in and opening /admin.\n');
}

main()
  .catch((error) => {
    console.error('Admin bootstrap failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });