import { auth } from '@/auth';
import { jsonError, jsonOk } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { logImportantError, logImportantInfo } from '@/lib/observability';
import { prisma } from '@/lib/prisma';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { sanitizeArray, sanitizeText, sanitizeUrl } from '@/lib/sanitize';
import { z } from 'zod';

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

const updateSchema = z.object({
  step: z.number().int().min(1).max(6).optional(),
  // Step 1
  name: z.string().max(120).optional().transform((v) => (v ? sanitizeText(v, 120) : undefined)),
  // Step 2
  profilePictureUrl: z.string().max(2048).optional().transform((v) => (v ? sanitizeUrl(v) : undefined)),
  // Step 3
  location: z.string().max(120).optional().transform((v) => (v ? sanitizeText(v, 120) : undefined)),
  remotePreference: z.enum(['REMOTE', 'HYBRID', 'ONSITE', 'FLEXIBLE']).optional(),
  timezoneMatches: z.array(z.string()).max(8).optional().transform((v) => v ? sanitizeArray(v, 8) : undefined),
  // Step 4 – parsed skills from resume
  preferredStack: z.array(z.string()).max(20).optional().transform((v) => v ? sanitizeArray(v, 20) : undefined),
  resumeUrl: z.string().max(2048).optional().transform((v) => (v ? sanitizeUrl(v) : undefined)),
  // Step 5 – profile info
  headline: z.string().max(160).optional().transform((v) => (v ? sanitizeText(v, 160) : undefined)),
  linkedinUrl: z.string().max(2048).optional().transform((v) => (v ? sanitizeUrl(v) : undefined)),
  githubUrl: z.string().max(2048).optional().transform((v) => (v ? sanitizeUrl(v) : undefined)),
  portfolioUrl: z.string().max(2048).optional().transform((v) => (v ? sanitizeUrl(v) : undefined)),
  // Step 6
  preferredTitles: z.array(z.string()).max(10).optional().transform((v) => v ? sanitizeArray(v, 10) : undefined),
  salaryMin: z.coerce.number().min(0).max(1_000_000).optional(),
  salaryTarget: z.coerce.number().min(0).max(1_000_000).optional(),
  currentLevel: z.enum(['ENTRY', 'MID', 'SENIOR', 'FLEXIBLE']).optional(),
  targetLevel: z.enum(['ENTRY', 'MID', 'SENIOR', 'FLEXIBLE']).optional(),
});

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return jsonError('Unauthorized', 401, undefined, request);

  const rate = applyRateLimit(`onboarding:update:${session.user.id}:${getRequestIp(request)}`, 60, 60_000);
  if (!rate.ok) return jsonError('Too many requests', 429, undefined, request);

  try {
    const body = await request.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError('Invalid payload', 422, parsed.error.issues.map((i) => i.message), request);
    }

    const { step, name, ...profileData } = parsed.data;

    // Update user name if provided
    if (name) {
      await prisma.user.update({ where: { id: session.user.id }, data: { name } });
    }

    // Upsert profile (LinkedIn users may not have one yet)
    await prisma.userProfile.upsert({
      where: { userId: session.user.id },
      create: {
        userId: session.user.id,
        onboardingStep: step ?? 1,
        ...profileData,
      },
      update: {
        ...(step !== undefined ? { onboardingStep: step } : {}),
        ...profileData,
      },
    });

    await logImportantInfo({
      event: 'onboarding_step_saved',
      userId: session.user.id,
      route: '/api/onboarding/update',
      context: { step },
    });

    return jsonOk({ ok: true }, request);
  } catch (error) {
    await logImportantError({
      event: 'onboarding_update_failed',
      userId: session.user.id,
      route: '/api/onboarding/update',
      error,
    });
    return jsonError('Unable to save onboarding progress.', 500, undefined, request);
  }
}
