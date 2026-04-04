import { auth } from '@/auth';
import { jsonError, jsonOk } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { preferencesPayloadSchema } from '@/lib/onboarding-schema';
import { logImportantError, logImportantInfo } from '@/lib/observability';
import { prisma } from '@/lib/prisma';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return jsonError('Unauthorized', 401, undefined, request);
  }

  const rate = applyRateLimit(`preferences:update:${session.user.id}:${getRequestIp(request)}`, 20, 60_000);
  if (!rate.ok) return jsonError('Too many requests', 429, undefined, request);

  try {
    const body = await request.json();
    const parsed = preferencesPayloadSchema.safeParse(body);

    if (!parsed.success) {
      return jsonError('Invalid preferences payload', 422, parsed.error.issues.map((issue: { message: string }) => issue.message), request);
    }

    const { onboardingCompleted, ...data } = parsed.data;

    await prisma.userProfile.update({
      where: { userId: session.user.id },
      data: {
        ...data,
        onboardingCompleted,
        onboardingCompletedAt: onboardingCompleted ? new Date() : null,
      },
    });

    await logImportantInfo({
      event: onboardingCompleted ? 'onboarding_completed' : 'preferences_updated',
      userId: session.user.id,
      route: '/api/preferences',
      context: { onboardingCompleted },
    });

    return jsonOk({ ok: true }, request);
  } catch (error) {
    await logImportantError({
      event: 'preferences_update_failed',
      userId: session.user.id,
      route: '/api/preferences',
      error,
      context: { method: 'PUT' },
    });
    return jsonError('Unable to update preferences.', 500, undefined, request);
  }
}
