/**
 * Branded transactional email templates for teChia Jobs.
 *
 * Rendered by the outbox worker. Deliberately restrained branding: product
 * name once, parent company once, no exclamation-mark urgency.
 */

import { getAppUrl } from '@/lib/site-url';

export type EmailTemplateId =
  | 'verification'
  | 'password_reset'
  | 'trial_started'
  | 'trial_ending'
  | 'trial_expired'
  | 'upgrade_request_received'
  | 'admin_upgrade_request_notification'
  | 'plan_changed'
  | 'upgrade_request_resolved';

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function layout(opts: { title: string; preheader: string; body: string; cta?: { label: string; url: string } }) {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(opts.title)} — teChia Jobs</title>
</head>
<body style="margin:0;padding:0;background:#FAFAF7;color:#17191E;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(opts.preheader)}</div>
  <div style="max-width:560px;margin:40px auto;padding:0 16px;">
    <div style="background:#FFFFFF;border:1px solid #D9DDE3;border-radius:16px;padding:40px;">
      <div style="font-size:20px;font-weight:700;color:#17191E;margin-bottom:2px;">teChia Jobs</div>
      <div style="font-size:12px;color:#6B7280;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:26px;">A teChia Digital Solutions product</div>
      <h1 style="margin:0 0 12px;font-size:22px;font-weight:600;line-height:1.3;">${escapeHtml(opts.title)}</h1>
      ${opts.body}
      ${
        opts.cta
          ? `<div style="margin:28px 0;"><a href="${escapeHtml(opts.cta.url)}" style="display:inline-block;background:#C9A227;color:#17191E;text-decoration:none;font-weight:600;font-size:15px;padding:14px 28px;border-radius:10px;">${escapeHtml(opts.cta.label)}</a></div>`
          : ''
      }
      <p style="margin:28px 0 0;font-size:13px;color:#4B5563;line-height:1.6;">Need help? Reply to this email and the team will get back to you.</p>
    </div>
    <div style="margin-top:24px;font-size:12px;color:#6B7280;text-align:center;">© ${year} teChia Jobs · A teChia Digital Solutions product</div>
  </div>
</body>
</html>`;
}

function formatDate(value: unknown): string {
  if (!value) return '';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

/** Build subject + rendered bodies for a template. */
export function renderEmail(
  id: EmailTemplateId,
  payload: Record<string, unknown>,
): { subject: string; html: string; text: string } {
  const appUrl = getAppUrl();

  switch (id) {
    case 'verification': {
      const url = `${appUrl}/verify-email?token=${encodeURIComponent(String(payload.token ?? ''))}`;
      const subject = 'Verify your email — teChia Jobs';
      return {
        subject,
        html: layout({
          title: 'Verify your email address',
          preheader: 'Confirm your email to activate your teChia Jobs account.',
          body: `<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#4B5563;">Thanks for signing up. Confirm your email address to activate your account. This link expires in <strong>24 hours</strong>.</p>`,
          cta: { label: 'Verify my email', url },
        }),
        text: ['Verify your teChia Jobs email', '', 'Confirm your address using this link (expires in 24 hours):', url, ''].join('\n'),
      };
    }

    case 'password_reset': {
      const url = `${appUrl}/reset-password?token=${encodeURIComponent(String(payload.token ?? ''))}`;
      const subject = 'Reset your password — teChia Jobs';
      return {
        subject,
        html: layout({
          title: 'Reset your password',
          preheader: 'A password reset was requested for your teChia Jobs account.',
          body: `<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#4B5563;">We received a request to reset the password for your account. This link expires in <strong>1 hour</strong>.</p>
                 <p style="margin:0 0 20px;font-size:13px;color:#4B5563;">If you did not request this, your password will not change and you can safely ignore this email.</p>`,
          cta: { label: 'Reset my password', url },
        }),
        text: ['Reset your teChia Jobs password', '', 'This link expires in 1 hour:', url, '', "If you didn't request this, ignore this email."].join('\n'),
      };
    }

    case 'trial_started': {
      const subject = 'Your Pro trial has started — teChia Jobs';
      const trialEnd = formatDate(payload.trialEndsAt);
      return {
        subject,
        html: layout({
          title: 'Your Pro trial has started',
          preheader: `Your Pro trial runs until ${trialEnd}.`,
          body: `<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#4B5563;">Your 14-day Pro trial is active and runs until <strong>${escapeHtml(trialEnd)}</strong>.</p>
                 <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#4B5563;">You can use every Pro feature during your trial. If you would like to continue on a paid plan afterwards, submit an upgrade request and our team will contact you.</p>`,
          cta: { label: 'Open your dashboard', url: `${appUrl}/dashboard` },
        }),
        text: [
          'Your teChia Jobs Pro trial has started.',
          `It runs until ${trialEnd}.`,
          '',
          `Open your dashboard: ${appUrl}/dashboard`,
          `Manage your plan: ${appUrl}/settings/billing`,
        ].join('\n'),
      };
    }

    case 'trial_ending': {
      const days = Number(payload.daysRemaining ?? 0);
      const subject = `Your Pro trial ends in ${days} ${days === 1 ? 'day' : 'days'} — teChia Jobs`;
      return {
        subject,
        html: layout({
          title: `Your Pro trial ends in ${days} ${days === 1 ? 'day' : 'days'}`,
          preheader: 'Keep your Pro access, or continue on Free.',
          body: `<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#4B5563;">Your Pro trial ends on <strong>${escapeHtml(formatDate(payload.trialEndsAt))}</strong>.</p>
                 <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#4B5563;">After that your account stays active on the Free plan — none of your jobs, resumes, or applications are removed. If you would like to keep Pro access, submit an upgrade request and our team will contact you.</p>`,
          cta: { label: 'View plans', url: `${appUrl}/settings/billing` },
        }),
        text: [
          `Your teChia Jobs Pro trial ends in ${days} day${days === 1 ? '' : 's'} (${formatDate(payload.trialEndsAt)}).`,
          '',
          `After that your account continues on the Free plan with all your data intact.`,
          `Manage your plan: ${appUrl}/settings/billing`,
        ].join('\n'),
      };
    }

    case 'trial_expired': {
      const subject = 'Your Pro trial has ended — teChia Jobs';
      return {
        subject,
        html: layout({
          title: 'Your Pro trial has ended',
          preheader: 'Your account is now on the Free plan. Nothing was deleted.',
          body: `<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#4B5563;">Your 14-day Pro trial has ended and your account is now on the <strong>Free</strong> plan.</p>
                 <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#4B5563;">Your account is still active and all of your jobs, resumes, applications, and contacts are safe. Pro-only features are paused until you upgrade.</p>`,
          cta: { label: 'Request an upgrade', url: `${appUrl}/settings/billing` },
        }),
        text: [
          'Your teChia Jobs Pro trial has ended.',
          'Your account is now on the Free plan. All of your data is safe.',
          `Request an upgrade: ${appUrl}/settings/billing`,
        ].join('\n'),
      };
    }

    case 'upgrade_request_received': {
      const subject = 'We received your upgrade request — teChia Jobs';
      return {
        subject,
        html: layout({
          title: 'Your upgrade request has been received',
          preheader: `Request for the ${payload.requestedPlan ?? ''} plan. Our team will contact you.`,
          body: `<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#4B5563;">Thanks — we have your request for the <strong>${escapeHtml(payload.requestedPlan ?? '')}</strong> plan. A teChia Jobs administrator will contact you${payload.contactMethod === 'WHATSAPP' ? ' on WhatsApp' : ' by email'} to finalise the details.</p>
                 <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#4B5563;">Submitting a request does not charge you. Your plan is updated once the arrangement is confirmed.</p>`,
          cta: { label: 'View my plan', url: `${appUrl}/settings/billing` },
        }),
        text: [
          'We received your teChia Jobs upgrade request.',
          `Requested plan: ${payload.requestedPlan ?? ''}`,
          'A member of the team will contact you to finalise the details.',
          `View your plan: ${appUrl}/settings/billing`,
        ].join('\n'),
      };
    }

    case 'admin_upgrade_request_notification': {
      const subject = `New ${payload.requestedPlan ?? ''} upgrade request — ${payload.userName ?? payload.userEmail ?? 'teChia Jobs'}`;
      return {
        subject,
        html: layout({
          title: 'New upgrade request',
          preheader: 'A user has requested a plan upgrade.',
          body: `<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#4B5563;"><strong>${escapeHtml(payload.userName ?? 'A user')}</strong> (${escapeHtml(payload.userEmail ?? '')}) requested the <strong>${escapeHtml(payload.requestedPlan ?? '')}</strong> plan.</p>
                 <p style="margin:0 0 8px;font-size:13px;color:#4B5563;">Preferred contact: <strong>${escapeHtml(payload.contactMethod ?? '')}</strong></p>
                 ${payload.contactEmail ? `<p style="margin:0 0 8px;font-size:13px;color:#4B5563;">Email: ${escapeHtml(payload.contactEmail)}</p>` : ''}
                 ${payload.whatsappNumber ? `<p style="margin:0 0 8px;font-size:13px;color:#4B5563;">WhatsApp: ${escapeHtml(payload.whatsappNumber)}</p>` : ''}
                 ${payload.message ? `<p style="margin:16px 0 0;font-size:13px;color:#4B5563;">"${escapeHtml(payload.message)}"</p>` : ''}`,
          cta: { label: 'Review request', url: `${appUrl}/admin/upgrade-requests` },
        }),
        text: [
          'New teChia Jobs upgrade request',
          `User: ${payload.userName ?? ''} (${payload.userEmail ?? ''})`,
          `Requested plan: ${payload.requestedPlan ?? ''}`,
          `Contact: ${payload.contactMethod ?? ''}`,
          '',
          `Review: ${appUrl}/admin/upgrade-requests`,
        ].join('\n'),
      };
    }

    case 'plan_changed': {
      const subject = `Your plan is now ${payload.planName ?? ''} — teChia Jobs`;
      const expiresLine = payload.endsAt
        ? `This plan access expires on <strong>${escapeHtml(formatDate(payload.endsAt))}</strong>.`
        : 'This plan access has no end date set.';

      return {
        subject,
        html: layout({
          title: `Your plan is now ${payload.planName ?? ''}`,
          preheader: 'Your teChia Jobs plan has been updated.',
          body: `<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#4B5563;">Your teChia Jobs plan has been updated to <strong>${escapeHtml(payload.planName ?? '')}</strong>, effective ${escapeHtml(formatDate(payload.startsAt))}.</p>
                 <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#4B5563;">${expiresLine}</p>`,
          cta: { label: 'Manage my plan', url: `${appUrl}/settings/billing` },
        }),
        text: [
          `Your teChia Jobs plan is now ${payload.planName ?? ''}.`,
          `Effective: ${formatDate(payload.startsAt)}`,
          payload.endsAt ? `Expires: ${formatDate(payload.endsAt)}` : 'No expiry date set.',
          '',
          `Manage your plan: ${appUrl}/settings/billing`,
        ].join('\n'),
      };
    }

    case 'upgrade_request_resolved': {
      const subject = 'Your upgrade request was resolved — teChia Jobs';
      return {
        subject,
        html: layout({
          title: 'Your upgrade request was resolved',
          preheader: 'The teChia Jobs team has reviewed your request.',
          body: `<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#4B5563;">The team has marked your request for the <strong>${escapeHtml(payload.requestedPlan ?? '')}</strong> plan as <strong>${escapeHtml(String(payload.status ?? '')).toLowerCase()}</strong>.</p>
                 <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#4B5563;">You can see your current plan and status at any time from your billing page.</p>`,
          cta: { label: 'View my plan', url: `${appUrl}/settings/billing` },
        }),
        text: [
          'Your teChia Jobs upgrade request was resolved.',
          `Requested plan: ${payload.requestedPlan ?? ''}`,
          `Status: ${payload.status ?? ''}`,
          '',
          `View your plan: ${appUrl}/settings/billing`,
        ].join('\n'),
      };
    }

    default: {
      // Unknown type: fail loudly in logs, never send a broken email.
      throw new Error(`Unknown email template: ${String(id)}`);
    }
  }
}