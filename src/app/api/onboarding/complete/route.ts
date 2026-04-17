import { auth } from '@/auth';
import { jsonError, jsonOk } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { logImportantError, logImportantInfo } from '@/lib/observability';
import { prisma } from '@/lib/prisma';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { sanitizeArray, sanitizeText, sanitizeUrl } from '@/lib/sanitize';
import { createNotification } from '@/lib/notifications';
import { z } from 'zod';

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

const completeSchema = z.object({
  name: z.string().max(120).optional().transform((v) => (v ? sanitizeText(v, 120) : undefined)),
  profilePictureUrl: z.string().max(2048).optional().transform((v) => (v ? sanitizeUrl(v) : undefined)),
  location: z.string().max(120).optional().transform((v) => (v ? sanitizeText(v, 120) : undefined)),
  remotePreference: z.enum(['REMOTE', 'HYBRID', 'ONSITE', 'FLEXIBLE']).optional(),
  timezoneMatches: z.array(z.string()).max(8).optional().transform((v) => v ? sanitizeArray(v, 8) : undefined),
  preferredStack: z.array(z.string()).max(20).optional().transform((v) => v ? sanitizeArray(v, 20) : undefined),
  resumeUrl: z.string().max(2048).optional().transform((v) => (v ? sanitizeUrl(v) : undefined)),
  preferredTitles: z.array(z.string()).max(10).optional().transform((v) => v ? sanitizeArray(v, 10) : undefined),
  salaryMin: z.coerce.number().min(0).max(1_000_000).optional(),
  salaryTarget: z.coerce.number().min(0).max(1_000_000).optional(),
  currentLevel: z.enum(['ENTRY', 'MID', 'SENIOR', 'FLEXIBLE']).optional(),
  targetLevel: z.enum(['ENTRY', 'MID', 'SENIOR', 'FLEXIBLE']).optional(),
  linkedinUrl: z.string().max(2048).optional().transform((v) => (v ? sanitizeUrl(v) : undefined)),
  githubUrl: z.string().max(2048).optional().transform((v) => (v ? sanitizeUrl(v) : undefined)),
  portfolioUrl: z.string().max(2048).optional().transform((v) => (v ? sanitizeUrl(v) : undefined)),
  headline: z.string().max(160).optional().transform((v) => (v ? sanitizeText(v, 160) : undefined)),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return jsonError('Unauthorized', 401, undefined, request);

  const rate = applyRateLimit(`onboarding:complete:${session.user.id}:${getRequestIp(request)}`, 10, 60_000);
  if (!rate.ok) return jsonError('Too many requests', 429, undefined, request);

  try {
    const body = await request.json();
    const parsed = completeSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError('Invalid payload', 422, parsed.error.issues.map((i) => i.message), request);
    }

    const { name, ...profileData } = parsed.data;

    if (name) {
      await prisma.user.update({ where: { id: session.user.id }, data: { name } });
    }

    // Compute profileCompleted (same logic as PUT /api/profile)
    const { headline, portfolioUrl, linkedinUrl, githubUrl, resumeUrl } = profileData;
    const isProfileComplete = Boolean(
      name &&
      headline &&
      (portfolioUrl || linkedinUrl || githubUrl || resumeUrl)
    );
    const profileCompletedData = isProfileComplete
      ? { profileCompleted: true, profileCompletedAt: new Date() }
      : { profileCompleted: false };

    await prisma.userProfile.upsert({
      where: { userId: session.user.id },
      create: {
        userId: session.user.id,
        onboardingCompleted: true,
        onboardingCompletedAt: new Date(),
        onboardingSkipped: false,
        onboardingStep: 6,
        ...profileCompletedData,
        ...profileData,
      },
      update: {
        onboardingCompleted: true,
        onboardingCompletedAt: new Date(),
        onboardingSkipped: false,
        onboardingStep: 6,
        ...profileCompletedData,
        ...profileData,
      },
    });

    await logImportantInfo({
      event: 'onboarding_completed',
      userId: session.user.id,
      route: '/api/onboarding/complete',
    });

    // Send in-app welcome notification
    try {
      const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { name: true },
      });
      const firstName = user?.name?.split(' ')[0] ?? 'there';
      await createNotification(session.user.id, {
        type: 'system',
        title: '🎉 Welcome to Job Seeker OS!',
        message: `You're all set, ${firstName}! Your workspace is personalised and ready. Start by adding your first job lead or browsing public listings.`,
      });
    } catch {
      // Non-critical — don't fail the request
    }

    return jsonOk({ ok: true }, request);
  } catch (error) {
    await logImportantError({
      event: 'onboarding_complete_failed',
      userId: session.user.id,
      route: '/api/onboarding/complete',
      error,
    });
    return jsonError('Unable to complete onboarding.', 500, undefined, request);
  }
}
