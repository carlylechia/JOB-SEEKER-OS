import { randomBytes } from 'crypto';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { jsonOk, jsonError } from '@/lib/api';
import { sendPasswordResetEmail } from '@/lib/email';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { logImportantInfo, logImportantError } from '@/lib/observability';

const schema = z.object({
  email: z.string().email('Invalid email'),
});

export async function POST(request: Request) {
  // Strict rate-limit: 3 per IP per 10 min to prevent email abuse
  const rl = applyRateLimit(`forgot:${getRequestIp(request)}`, 3, 600_000);
  if (!rl.ok) return jsonError('Too many requests — try again later.', 429);

  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return jsonError('Invalid request', 400, parsed.error.errors.map((e) => e.message));
  }

  const email = parsed.data.email.toLowerCase();

  // Always return success to avoid user-enumeration
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, emailVerified: true },
  });

  if (user?.emailVerified) {
    const token = randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordResetToken: token, passwordResetExpires: expires },
    });

    try {
      await sendPasswordResetEmail(user.email, token);
      await logImportantInfo({
        event: 'password_reset_requested',
        userId: user.id,
        context: { email: user.email },
      });
    } catch (err) {
      await logImportantError({
        event: 'password_reset_email_failed',
        userId: user.id,
        error: err,
      });
    }
  }

  // Always return the same message to prevent user-enumeration
  return jsonOk({
    ok: true,
    message: 'If an account exists with that email, you\'ll receive a reset link shortly.',
  });
}
