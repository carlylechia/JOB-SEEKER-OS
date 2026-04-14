import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { jsonOk, jsonError } from '@/lib/api';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { logImportantInfo, logImportantError } from '@/lib/observability';

const schema = z
  .object({
    token: z.string().min(1),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(1),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export async function POST(request: Request) {
  const rl = applyRateLimit(`reset:${getRequestIp(request)}`, 5, 600_000);
  if (!rl.ok) return jsonError('Too many requests', 429);

  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return jsonError('Invalid request', 400, parsed.error.errors.map((e) => e.message));
  }

  const { token, password } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { passwordResetToken: token },
    select: { id: true, email: true, passwordResetExpires: true },
  });

  if (!user) {
    return jsonError('Invalid or expired reset link.', 400);
  }

  if (!user.passwordResetExpires || user.passwordResetExpires < new Date()) {
    return jsonError('This reset link has expired. Please request a new one.', 400);
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      passwordResetToken: null,
      passwordResetExpires: null,
    },
  });

  try {
    await logImportantInfo({
      event: 'password_reset_completed',
      userId: user.id,
      context: { email: user.email },
    });
  } catch (err) {
    await logImportantError({ event: 'password_reset_log_failed', error: err });
  }

  return jsonOk({ ok: true, message: 'Password updated. You can now sign in.' });
}
