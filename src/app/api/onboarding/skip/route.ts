import { auth } from '@/auth';
import { jsonError, jsonOk } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { logImportantInfo, logImportantError } from '@/lib/observability';
import { prisma } from '@/lib/prisma';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

/**
 * POST /api/onboarding/skip
 *
 * Marks the user as having skipped onboarding.
 * Sets onboardingCompleted = true so the layout gate passes (they can reach
 * the dashboard), but also sets onboardingSkipped = true so the dashboard
 * can show a "resume onboarding" prompt.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return jsonError('Unauthorized', 401, undefined, request);

  const rate = applyRateLimit(`onboarding:skip:${session.user.id}:${getRequestIp(request)}`, 10, 60_000);
  if (!rate.ok) return jsonError('Too many requests', 429, undefined, request);

  try {
    await prisma.userProfile.upsert({
      where: { userId: session.user.id },
      create: {
        userId: session.user.id,
        onboardingCompleted: true,
        onboardingSkipped: true,
      },
      update: {
        onboardingCompleted: true,
        onboardingSkipped: true,
      },
    });

    await logImportantInfo({
      event: 'onboarding_skipped',
      userId: session.user.id,
      route: '/api/onboarding/skip',
    });

    return jsonOk({ ok: true }, request);
  } catch (error) {
    await logImportantError({
      event: 'onboarding_skip_failed',
      userId: session.user.id,
      route: '/api/onboarding/skip',
      error,
    });
    return jsonError('Unable to skip onboarding.', 500, undefined, request);
  }
}
