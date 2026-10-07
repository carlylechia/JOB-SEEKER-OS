'use client';

import { useEffect, useState } from 'react';

/**
 * Trial countdown.
 *
 * Hydration safety: the initial render is deterministic (based only on the
 * server-provided persisted timestamp), and the live refinement happens in an
 * effect after mount. That avoids the classic "countdown differs between server
 * and client" hydration mismatch.
 *
 * Always driven by the PERSISTED trialEndsAt — never recomputed from local
 * storage or a client-side clock the server doesn't know about.
 */

type Props = {
  trialEndsAt: string;
  isTrialing: boolean;
  trialExpired: boolean;
};

function computeDaysLeft(endsAt: string): number {
  const remaining = new Date(endsAt).getTime() - Date.now();
  if (remaining <= 0) return 0;
  return Math.ceil(remaining / (24 * 60 * 60 * 1000));
}

function message(days: number, trialExpired: boolean): string {
  if (trialExpired) return 'Your Pro trial has ended.';
  if (days <= 0) return 'Your Pro trial ends today.';
  if (days === 1) return 'Your Pro trial ends tomorrow.';
  return `${days} days left in your Pro trial`;
}

export function TrialCountdown({ trialEndsAt, isTrialing, trialExpired }: Props) {
  // Deterministic first paint: assume "several days" until mounted so server
  // and client markup match exactly.
  const [days, setDays] = useState<number | null>(null);

  useEffect(() => {
    setDays(computeDaysLeft(trialEndsAt));
    const timer = window.setInterval(() => {
      setDays(computeDaysLeft(trialEndsAt));
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [trialEndsAt]);

  if (!isTrialing && !trialExpired) return null;

  const resolvedDays = days ?? 14;
  const text = days === null ? 'Your Pro trial is active' : message(resolvedDays, trialExpired);
  const urgent = days !== null && !trialExpired && resolvedDays <= 3;

  return (
    <p
      className={`text-sm ${urgent ? 'text-[#6B5410]' : 'text-muted'}`}
      // Announce politely so screen-reader users hear updates once per minute
      // rather than on every tick.
      aria-live="polite"
    >
      {text}.
      {!trialExpired && days !== null ? (
        <span className="block text-xs text-muted mt-1">
          Your trial ends on {new Date(trialEndsAt).toLocaleDateString(undefined, { dateStyle: 'long' })}.
        </span>
      ) : null}
    </p>
  );
}

/** Trial banner shown at the top of the app shell. */
export function TrialBanner({
  trialEndsAt,
  isTrialing,
  trialExpired,
}: Props) {
  const [days, setDays] = useState<number | null>(null);

  useEffect(() => {
    setDays(computeDaysLeft(trialEndsAt));
    const timer = window.setInterval(
      () => setDays(computeDaysLeft(trialEndsAt)),
      60_000,
    );
    return () => window.clearInterval(timer);
  }, [trialEndsAt]);

  if (!isTrialing && !trialExpired) return null;

  if (trialExpired) {
    return (
      <div
        role="status"
        className="border-b border-line bg-silverlight/70 px-4 py-2.5 text-center text-sm text-ink"
      >
        Your Pro trial has ended and your account is now on the Free plan. All of
        your data is safe.{' '}
        <a href="/settings/billing" className="font-semibold underline">
          Request an upgrade
        </a>
      </div>
    );
  }

  const resolvedDays = days ?? 14;

  return (
    <div
      role="status"
      className="border-b border-gold/30 bg-gold/10 px-4 py-2.5 text-center text-sm text-ink"
    >
      {message(resolvedDays, false)}.{' '}
      <a href="/settings/billing" className="font-semibold underline">
        View plans
      </a>
    </div>
  );
}