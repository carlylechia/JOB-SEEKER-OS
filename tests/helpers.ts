/**
 * Shared integration-test helpers: create isolated users and clean up after.
 */

import { prisma } from '@/lib/prisma';
import { resetClock, setTestNow } from '@/lib/billing/clock';

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Launch timestamp used by every test, so assertions are deterministic. */
export const T0 = new Date('2026-03-01T12:00:00.000Z');

export async function createUser(opts: { role?: 'USER' | 'ADMIN'; email?: string } = {}) {
  const email = opts.email ?? `test-${Math.random().toString(36).slice(2, 10)}@example.test`;
  return prisma.user.create({
    data: {
      email,
      passwordHash: 'not-a-real-hash',
      name: 'Test User',
      role: opts.role ?? 'USER',
      emailVerified: new Date(),
    },
  });
}

/** Delete every trace of a test user. Never touches global plan definitions. */
export async function destroyUser(userId: string) {
  await prisma.subscriptionEvent.deleteMany({ where: { userId } });
  await prisma.upgradeRequest.deleteMany({ where: { userId } });
  await prisma.usageRecord.deleteMany({ where: { userId } });
  await prisma.subscription.deleteMany({ where: { userId } });
  await prisma.notification.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
}

export { setTestNow, resetClock };