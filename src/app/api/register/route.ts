import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { prisma } from '@/lib/prisma';
import { registerSchema } from '@/lib/register-schema';
import { seedUserWorkspace } from '@/lib/db-helpers';
import { sendVerificationEmail } from '@/lib/email';
import { logImportantError, logImportantInfo } from '@/lib/observability';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';

export async function POST(req: Request) {
  const rate = applyRateLimit(`register:${getRequestIp(req)}`, 5, 60_000);
  if (!rate.ok) {
    return Response.json({ error: 'Too many requests. Try again in a minute.' }, { status: 429 });
  }

  try {
    const body = await req.json();
    const parsed = registerSchema.safeParse(body);

    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message || 'Invalid input' },
        { status: 400 }
      );
    }

    const { name, email, password } = parsed.data;
    const normalizedEmail = email.toLowerCase();

    const existing = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existing) {
      return Response.json(
        { error: 'An account with this email already exists.' },
        { status: 409 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // Generate a secure single-use verification token
    const emailVerificationToken = randomBytes(32).toString('hex');
    const emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

    // ✅ STEP 1: Create user with verification token
    const user = await prisma.user.create({
      data: {
        name,
        email: normalizedEmail,
        passwordHash,
        emailVerificationToken,
        emailVerificationExpires,
        // emailVerified intentionally null — must click link
      },
    });

    // ✅ STEP 2: Seed workspace (non-critical)
    try {
      await seedUserWorkspace(user.id);
    } catch (seedError) {
      await logImportantError({
        event: 'user_workspace_seed_failed',
        userId: user.id,
        route: '/api/register',
        error: seedError,
      });
    }

    // ✅ STEP 3: Send verification email (non-critical — don't block registration)
    try {
      await sendVerificationEmail(normalizedEmail, emailVerificationToken);
      await logImportantInfo({
        event: 'verification_email_sent',
        userId: user.id,
        route: '/api/register',
        context: { email: normalizedEmail },
      });
    } catch (emailError) {
      // Log but do not fail — user can request a resend later
      await logImportantError({
        event: 'verification_email_failed',
        userId: user.id,
        route: '/api/register',
        error: emailError,
      });
    }

    // ✅ STEP 4: Log registration
    await logImportantInfo({
      event: 'user_registered',
      userId: user.id,
      route: '/api/register',
    });

    // ✅ STEP 5: Return — do NOT auto-login
    return Response.json({
      ok: true,
      message: 'Account created! Check your email to verify your address before signing in.',
    });

  } catch (error) {
    await logImportantError({
      event: 'user_register_failed',
      route: '/api/register',
      error,
    });

    return Response.json(
      { error: 'Unable to create account right now.' },
      { status: 500 }
    );
  }
}
