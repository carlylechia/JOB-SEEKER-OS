import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { prisma } from '@/lib/prisma';
import { registerSchema } from '@/lib/register-schema';
import { seedUserWorkspace } from '@/lib/db-helpers';
import { sendVerificationEmail } from '@/lib/email';
import { enqueueEmailBestEffort } from '@/lib/billing/email-outbox';
import { maybeStartTrialForNewUser } from '@/lib/billing/monetization';
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

    // ✅ STEP 3: Start the new-user trial.
    // Monetization-off and every failure mode here are non-critical: a user
    // without a subscription resolves to Free, which is correct behaviour.
    try {
      await maybeStartTrialForNewUser(user.id);
    } catch (trialError) {
      await logImportantError({
        event: 'new_user_trial_failed',
        userId: user.id,
        route: '/api/register',
        error: trialError,
      });
    }

    // ✅ STEP 4: Queue the verification email.
    // Queued, NOT sent inline: a Resend outage must not make a successfully
    // created account look like a failed registration. The outbox worker
    // retries with backoff and the user can request a resend.
    const emailQueued = await enqueueEmailBestEffort({
      type: 'verification',
      recipient: normalizedEmail,
      payload: { token: emailVerificationToken },
      idempotencyKey: `verification:${user.id}`,
    });

    if (emailQueued) {
      await logImportantInfo({
        event: 'verification_email_queued',
        userId: user.id,
        route: '/api/register',
        context: { email: normalizedEmail },
      });
    } else {
      // Fall back to a direct send so the user is not stranded, but still
      // never let this fail registration.
      try {
        await sendVerificationEmail(normalizedEmail, emailVerificationToken);
        await logImportantInfo({
          event: 'verification_email_sent',
          userId: user.id,
          route: '/api/register',
        });
      } catch (emailError) {
        await logImportantError({
          event: 'verification_email_failed',
          userId: user.id,
          route: '/api/register',
          error: emailError,
          context: { note: 'Account was created successfully; email can be resent.' },
        });
      }
    }

    // ✅ STEP 5: Log registration
    await logImportantInfo({
      event: 'user_registered',
      userId: user.id,
      route: '/api/register',
    });

    // ✅ STEP 6: Return — do NOT auto-login
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
