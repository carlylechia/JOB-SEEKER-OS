/**
 * Email helper — powered by Resend.
 * All outgoing transactional emails go through this module.
 *
 * Required env vars:
 *   RESEND_API_KEY  — get from resend.com
 *   RESEND_FROM     — verified sender address, e.g. "Job Seeker OS <noreply@yourapp.com>"
 *   NEXT_PUBLIC_APP_URL — e.g. https://yourapp.com
 */

import { Resend } from 'resend';

const FROM = process.env.RESEND_FROM ?? 'Job Seeker OS <noreply@jobseekeros.com>';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

export async function sendVerificationEmail(email: string, token: string): Promise<void> {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const verifyUrl = `${APP_URL}/verify-email?token=${encodeURIComponent(token)}`;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Verify your email — Job Seeker OS</title>
  <style>
    body { margin: 0; padding: 0; background: #08111f; color: #e7edf7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .wrapper { max-width: 560px; margin: 40px auto; padding: 0 16px; }
    .card { background: #0f1a2e; border: 1px solid #22314d; border-radius: 16px; padding: 40px; }
    .logo { font-size: 20px; font-weight: 700; color: #4f8cff; margin-bottom: 28px; }
    h1 { margin: 0 0 12px; font-size: 22px; font-weight: 600; }
    p { margin: 0 0 20px; font-size: 15px; line-height: 1.6; color: #98a7c4; }
    .btn { display: inline-block; background: #4f8cff; color: #ffffff !important; text-decoration: none; font-weight: 600; font-size: 15px; padding: 14px 28px; border-radius: 10px; }
    .small { font-size: 13px; color: #98a7c4; margin-top: 24px; }
    .small a { color: #4f8cff; word-break: break-all; }
    .footer { margin-top: 24px; font-size: 12px; color: #4a5e7a; text-align: center; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="logo">Job Seeker OS</div>
      <h1>Verify your email address</h1>
      <p>
        Thanks for signing up! Click the button below to confirm your email address and
        activate your account. This link expires in <strong>24 hours</strong>.
      </p>
      <a class="btn" href="${verifyUrl}">Verify my email</a>
      <p class="small">
        If the button doesn't work, copy and paste this link into your browser:<br />
        <a href="${verifyUrl}">${verifyUrl}</a>
      </p>
      <p class="small" style="margin-bottom:0;">
        If you didn't create a Job Seeker OS account, you can safely ignore this email.
      </p>
    </div>
    <div class="footer">© ${new Date().getFullYear()} Job Seeker OS</div>
  </div>
</body>
</html>
  `.trim();

  const text = [
    'Welcome to Job Seeker OS!',
    '',
    'Please verify your email address by visiting the link below.',
    'This link expires in 24 hours.',
    '',
    verifyUrl,
    '',
    "If you didn't create an account, ignore this email.",
  ].join('\n');

  const { error } = await resend.emails.send({
    from: FROM,
    to: email,
    subject: 'Verify your email — Job Seeker OS',
    html,
    text,
  });

  if (error) {
    throw new Error(`Resend error: ${error.message}`);
  }
}
