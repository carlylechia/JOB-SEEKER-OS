'use client';

import { useState } from 'react';
import { whatsappNumberSchema } from '@/lib/billing/upgrade-requests';
import type { PlanCode } from '@/lib/billing/plans';

/**
 * Upgrade request form.
 *
 * The server is the source of truth: this client sends only the requested
 * plan, contact preference, contact details and message. It never sends a
 * userId, a status, or a plan assignment — those are all derived server-side.
 */
export function UpgradeRequestForm({
  defaultEmail,
  currentPlan,
}: {
  defaultEmail: string;
  currentPlan: PlanCode;
}) {
  const [requestedPlan, setRequestedPlan] = useState<Exclude<PlanCode, 'FREE'>>(
    currentPlan === 'FREE' ? 'PRO' : 'PREMIUM',
  );
  const [contactMethod, setContactMethod] = useState<'EMAIL' | 'WHATSAPP'>('EMAIL');
  const [contactEmail, setContactEmail] = useState(defaultEmail);
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [message, setMessage] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Client-side mirror of the server rule for immediate feedback. The server
  // re-validates everything regardless.
  const whatsappError = whatsappNumber ? whatsappNumberSchema.safeParse(whatsappNumber) : null;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return; // Prevents accidental double-submission.

    setError(null);
    setSuccess(null);
    setSubmitting(true);

    try {
      const response = await fetch('/api/upgrade-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestedPlan,
          contactMethod,
          contactEmail: contactMethod === 'EMAIL' ? contactEmail : undefined,
          whatsappNumber: contactMethod === 'WHATSAPP' ? whatsappNumber : undefined,
          message,
        }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        if (response.status === 409) {
          setError(
            'You already have an upgrade request in progress. Our team is reviewing it — you can submit a new one once it is resolved.',
          );
        } else if (response.status === 429) {
          setError('You have submitted several requests recently. Please wait before trying again.');
        } else {
          setError(
            payload?.error?.details?.[0] ?? 'We could not submit your request. Please try again.',
          );
        }
        return;
      }

      setSuccess(payload?.message ?? 'Your upgrade request has been received.');
      setMessage('');
    } catch {
      setError('We could not reach the server. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div role="status" className="card-pad border-success/40 bg-success/[0.06]">
        <h3 className="text-sm font-semibold text-ink">{success}</h3>
        <p className="muted mt-2">
          Requested plan:{' '}
          <strong className="text-ink">
            {requestedPlan.charAt(0) + requestedPlan.slice(1).toLowerCase()}
          </strong>
          . Preferred contact: {contactMethod === 'EMAIL' ? 'Email' : 'WhatsApp'}.
        </p>
        <p className="mt-2 text-xs text-muted">
          Your plan has not changed yet — an administrator will contact you and activate it once
          confirmed.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="card-pad space-y-5" noValidate>
      <fieldset>
        <legend className="mb-2 block text-sm font-medium text-ink">
          Which plan would you like?
        </legend>
        <div className="flex flex-wrap gap-3">
          {(['PRO', 'PREMIUM'] as const).map((plan) => (
            <label
              key={plan}
              className={`flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-2.5 text-sm ${
                requestedPlan === plan
                  ? 'border-gold bg-gold/[0.08] font-medium text-ink'
                  : 'border-line bg-white text-ink'
              }`}
            >
              <input
                type="radio"
                name="requestedPlan"
                value={plan}
                checked={requestedPlan === plan}
                onChange={() => setRequestedPlan(plan)}
                className="accent-[#D4AF37]"
              />
              {plan.charAt(0) + plan.slice(1).toLowerCase()}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 block text-sm font-medium text-ink">
          How should we contact you?
        </legend>
        <div className="flex flex-wrap gap-3">
          {([
            { value: 'EMAIL', label: 'Email' },
            { value: 'WHATSAPP', label: 'WhatsApp' },
          ] as const).map((option) => (
            <label
              key={option.value}
              className={`flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-2.5 text-sm ${
                contactMethod === option.value
                  ? 'border-gold bg-gold/[0.08] font-medium text-ink'
                  : 'border-line bg-white text-ink'
              }`}
            >
              <input
                type="radio"
                name="contactMethod"
                value={option.value}
                checked={contactMethod === option.value}
                onChange={() => setContactMethod(option.value)}
                className="accent-[#D4AF37]"
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      {contactMethod === 'EMAIL' ? (
        <div>
          <label htmlFor="contactEmail" className="mb-2 block text-sm text-ink">
            Contact email
          </label>
          <input
            id="contactEmail"
            type="email"
            required
            autoComplete="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            className="input"
            aria-describedby="contactEmailHelp"
          />
          <p id="contactEmailHelp" className="mt-1.5 text-xs text-muted">
            Defaults to your account email. Change it if you would prefer another address.
          </p>
        </div>
      ) : (
        <div>
          <label htmlFor="whatsappNumber" className="mb-2 block text-sm text-ink">
            WhatsApp number
          </label>
          <input
            id="whatsappNumber"
            type="tel"
            required
            autoComplete="tel"
            inputMode="tel"
            placeholder="+2348012345678"
            value={whatsappNumber}
            onChange={(e) => setWhatsappNumber(e.target.value)}
            className="input"
            aria-invalid={Boolean(whatsappError && !whatsappError.success)}
            aria-describedby="whatsappHelp"
          />
          <p id="whatsappHelp" className="mt-1.5 text-xs text-muted">
            Include your country code. We check the format only — we cannot confirm the number is a
            registered WhatsApp account.
          </p>
          {whatsappError && !whatsappError.success ? (
            <p role="alert" className="mt-1.5 text-xs text-danger">
              {whatsappError.error.issues[0]?.message}
            </p>
          ) : null}
        </div>
      )}

      <div>
        <label htmlFor="message" className="mb-2 block text-sm text-ink">
          Anything we should know? <span className="font-normal text-muted">(optional)</span>
        </label>
        <textarea
          id="message"
          rows={4}
          maxLength={1500}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="What you want to use the plan for, or any questions you have."
          className="input resize-y"
          aria-describedby="messageHelp"
        />
        <p id="messageHelp" className="mt-1.5 text-xs text-muted">
          {message.length}/1500 characters
        </p>
      </div>

      {error ? (
        <p role="alert" className="rounded-xl border border-danger/30 bg-danger/[0.06] px-4 py-3 text-sm text-[#9B2C2C]">
          {error}
        </p>
      ) : null}

      <button type="submit" className="btn-primary" disabled={submitting}>
        {submitting ? 'Submitting…' : 'Submit upgrade request'}
      </button>
    </form>
  );
}