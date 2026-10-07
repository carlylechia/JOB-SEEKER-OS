#!/usr/bin/env tsx
/**
 * Admin role revocation — operationally controlled counterpart to bootstrap.
 *
 *   npm run admin:revoke -- you@yourdomain.com
 *
 * Refuses to remove the last remaining admin, which would leave the admin
 * control plane unmanageable.
 */

import { prisma } from '../src/lib/prisma';
import { logImportantInfo } from '../src/lib/observability';

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const emailArg = args[0];

  if (!emailArg) {
    console.error('\n  Usage: npm run admin:revoke -- you@yourdomain.com\n');
    process.exit(1);
  }

  const email = emailArg.trim().toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, role: true },
  });

  if (!user) {
    console.error(`\n  No account exists for ${email}.\n`);
    process.exit(1);
  }

  if (user.role !== 'ADMIN') {
    console.log(`\n  ${email} is not an ADMIN. Nothing to do.\n`);
    return;
  }

  const remaining = await prisma.user.count({ where: { role: 'ADMIN' } });
  if (remaining <= 1) {
    console.error('\n  Refusing to revoke the last remaining admin.');
    console.error('  Promote another account first so /admin stays manageable.\n');
    process.exit(1);
  }

  await prisma.user.update({ where: { id: user.id }, data: { role: 'USER' } });

  await logImportantInfo({
    event: 'admin_role_revoked',
    userId: user.id,
    context: { email, method: 'cli_revoke' },
  });

  console.log(`\n  Revoked ADMIN from ${email}.\n`);
}

main()
  .catch((error) => {
    console.error('Admin revoke failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });