/**
 * Development seed.
 *
 * SAFETY: refuses to run in production. This creates a demo account with a
 * well-known password, which must never exist on a live database.
 */

import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/prisma';
import { seedUserWorkspace } from '../src/lib/db-helpers';

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('\n  Refusing to seed a demo account in production.\n');
    process.exit(1);
  }

  // Extra belt-and-braces guard: only touch a clearly local database.
  const url = process.env.DATABASE_URL ?? '';
  const isLocal =
    url.includes('localhost') || url.includes('127.0.0.1') || url.includes('postgres:');
  if (!isLocal) {
    console.error(
      '\n  Refusing to seed: DATABASE_URL does not point at a local database.',
      'Production data must never be seeded with demo rows.\n',
    );
    process.exit(1);
  }

  const email = 'demo@jobseekeros.dev';
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log('  Demo user already exists');
    return;
  }

  const passwordHash = await bcrypt.hash('demo12345', 12);
  const user = await prisma.user.create({
    data: { name: 'Demo User', email, passwordHash },
  });

  await seedUserWorkspace(user.id);
  console.log('  Created demo user: demo@jobseekeros.dev / demo12345');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });