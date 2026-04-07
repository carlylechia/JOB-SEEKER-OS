import { auth } from '@/auth';
import { jsonError, jsonOk } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { logImportantError, logImportantInfo } from '@/lib/observability';
import { prisma } from '@/lib/prisma';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { sanitizeText, sanitizeUrl } from '@/lib/sanitize';

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return jsonError('Unauthorized', 401, undefined, request);
  const rate = applyRateLimit(`profile:update:${session.user.id}:${getRequestIp(request)}`, 20, 60_000);
  if (!rate.ok) return jsonError('Too many requests', 429, undefined, request);

  try {
    const body = await request.json();
    const fullName = sanitizeText(String(body?.fullName || ''), 120);
    const headline = sanitizeText(String(body?.headline || ''), 160);
    const portfolioUrl = sanitizeUrl(String(body?.portfolioUrl || ''));
    const githubUrl = sanitizeUrl(String(body?.githubUrl || ''));
    const linkedinUrl = sanitizeUrl(String(body?.linkedinUrl || ''));
    const resumeUrl = sanitizeUrl(String(body?.resumeUrl || ''));
    const profileCompleted = Boolean(fullName && headline && (portfolioUrl || linkedinUrl || githubUrl || resumeUrl));

    await prisma.user.update({ where: { id: session.user.id }, data: { name: fullName || undefined } });
    const profile = await prisma.userProfile.update({
      where: { userId: session.user.id },
      data: {
        headline,
        portfolioUrl: portfolioUrl || null,
        githubUrl: githubUrl || null,
        linkedinUrl: linkedinUrl || null,
        resumeUrl: resumeUrl || null,
        profileCompleted,
        profileCompletedAt: profileCompleted ? new Date() : null,
      },
    });

    await logImportantInfo({ event: 'profile_updated', userId: session.user.id, route: '/api/profile', context: { profileCompleted } });
    return jsonOk({
      profile: {
        fullName,
        headline: profile.headline || '',
        portfolioUrl: profile.portfolioUrl || '',
        githubUrl: profile.githubUrl || '',
        linkedinUrl: profile.linkedinUrl || '',
        resumeUrl: profile.resumeUrl || '',
        profileCompleted,
      },
    }, request);
  } catch (error) {
    await logImportantError({ event: 'profile_update_failed', userId: session.user.id, route: '/api/profile', error, context: { method: 'PUT' } });
    return jsonError('Unable to update profile.', 500, undefined, request);
  }
}
