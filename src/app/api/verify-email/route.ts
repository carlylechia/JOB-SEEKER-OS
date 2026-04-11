import { prisma } from '@/lib/prisma';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { logImportantInfo, logImportantError } from '@/lib/observability';

export async function GET(request: Request) {
  const rate = applyRateLimit(`verify-email:${getRequestIp(request)}`, 10, 60_000);
  if (!rate.ok) {
    return Response.json({ error: 'Too many requests.' }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');

  if (!token || token.length < 32) {
    return Response.json({ error: 'Invalid verification link.' }, { status: 400 });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { emailVerificationToken: token },
      select: {
        id: true,
        email: true,
        emailVerified: true,
        emailVerificationExpires: true,
      },
    });

    if (!user) {
      await logImportantInfo({
        event: 'email_verification_failed',
        route: '/api/verify-email',
        context: { reason: 'token_not_found' },
      });
      return Response.json({ error: 'Invalid or expired verification link.' }, { status: 400 });
    }

    // Already verified — idempotent success
    if (user.emailVerified) {
      return Response.json({ ok: true, alreadyVerified: true });
    }

    // Check expiry
    if (user.emailVerificationExpires && user.emailVerificationExpires < new Date()) {
      await logImportantInfo({
        event: 'email_verification_failed',
        userId: user.id,
        route: '/api/verify-email',
        context: { reason: 'token_expired' },
      });
      return Response.json({ error: 'This verification link has expired. Please register again.' }, { status: 400 });
    }

    // Mark verified and clear the single-use token
    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: new Date(),
        emailVerificationToken: null,
        emailVerificationExpires: null,
      },
    });

    await logImportantInfo({
      event: 'email_verified',
      userId: user.id,
      route: '/api/verify-email',
      context: { email: user.email },
    });

    return Response.json({ ok: true });
  } catch (error) {
    await logImportantError({
      event: 'email_verification_failed',
      route: '/api/verify-email',
      error,
      context: { reason: 'server_error' },
    });
    return Response.json({ error: 'Unable to verify email right now.' }, { status: 500 });
  }
}
