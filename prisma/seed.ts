import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/prisma';
import { seedUserWorkspace } from '../src/lib/db-helpers';

async function main() {
  const email = 'demo@jobseekeros.dev';
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log('Demo user already exists');
    return;
  }

  const passwordHash = await bcrypt.hash('demo12345', 12);
  const user = await prisma.user.create({
    data: {
      name: 'Demo User',
      email,
      passwordHash,
    },
  });

  await seedUserWorkspace(user.id);
  console.log('Created demo user: demo@jobseekeros.dev / demo12345');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
