'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Admin plan change panel.
 *
 * Consequential actions, so:
 *   - every field is explicit; nothing is silently defaulted to "lifetime"
 *   - a reason is REQUIRED and recorded in the audit trail
 *   - the confirm step restates previous plan → new plan, dates and reason
 *   - the submit button disables while pending, so a double-click cannot
 *     apply the change twice
 *   - conflicts (another admin acted first) surface as a clear message
 */
export function PlanChangePanel({
  userId,
  userName,
  currentPlan,
  currentStatus,
  currentTrialEndsAt,
}: {
  userId: string;
  userName: string;
  currentPlan: string;
  currentStatus: string;
  currentTrialEndsAt: string | null;
}) {
  const router = useRouter();

  const [action, setAction] = useState<'set_plan' | 'extend_trial' | 'suspend'>('set_plan');
  const [planCode, setPlanCode] = useState<'FREE' | 'PRO' | 'PREMIUM'>('PRO');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [newTrialEndsAt, setNewTrialEndsAt] = useState('');
  const [reason, setReason] = useState('');
  const [adminNote, setAdminNote] = useState('');

  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const needsConfirm = action === 'set_plan' || action === 'suspend';

  function label(code: string) {
    return code.charAt(0) + code.slice(1).toLowerCase();
  }

  async function submit() {
    if (pending) return;
    setPending(true);
    setError(null);
    setSuccess(null);

    try {
      const body: Record<string, unknown> = { action, reason, adminNote: adminNote || undefined };

      if (action === 'set_plan') {
        body.planCode = planCode;
        if (startsAt) body.startsAt = new Date(startsAt).toISOString();
        // Explicit null = no expiry. Never left ambiguous by a blank field.
        body.endsAt = endsAt ? new Date(endsAt).toISOString() : null;
      }
      if (action === 'extend_trial' && newTrialEndsAt) {
        body.newTrialEndsAt = new Date(newTrialEndsAt).toISOString();
      }

      const response = await fetch(`/api/admin/users/${userId}/subscription`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        if (response.status === 409) {
          setError(
            payload?.error?.message ??
              'Someone else changed this user first. Reload to see the current state.',
          );
        } else if (response.status === 429) {
          setError('Too many changes at once. Please wait a moment and try again.');
        } else {
          setError(
            payload?.error?.details?.[0] ??
              payload?.error?.message ??
              "We couldn't update the plan right now. Please try again.",
          );
        }
        return;
      }

      setSuccess(
        action === 'set_plan'
          ? `Plan updated to ${label(planCode)}.`
          : action === 'extend_trial'
            ? 'Trial extended.'
            : 'Access suspended.',
      );
      setConfirming(false);
      setReason('');
      setAdminNote('');
      setEndsAt('');
      setNewTrialEndsAt('');
      router.refresh();
    } catch {
      setError('We could not reach the server. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="change-plan-heading" className="card-pad">
      <h2 id="change-plan-heading" className="text-sm font-semibold text-ink">
        Change access
      </h2>

      {success ? (
        <p role="status" className="mt-3 rounded-xl border border-success/30 bg-success/[0.06] px-4 py-3 text-sm text-[#136B45]">
          {success}
        </p>
      ) : null}

      <div className="mt-4 space-y-4">
        <fieldset>
          <legend className="mb-2 block text-sm font-medium text-ink">Action</legend>
          <div className="flex flex-wrap gap-3">
            {([
              { value: 'set_plan', label: 'Set plan' },
              { value: 'extend_trial', label: 'Extend trial' },
              { value: 'suspend', label: 'Suspend access' },
            ] as const).map((option) => (
              <label
                key={option.value}
                className={`flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-2 text-sm ${
                  action === option.value
                    ? 'border-gold bg-gold/[0.08] font-medium'
                    : 'border-line bg-white'
                }`}
              >
                <input
                  type="radio"
                  name="action"
                  checked={action === option.value}
                  onChange={() => {
                    setAction(option.value);
                    setConfirming(false);
                  }}
                  className="accent-[#D4AF37]"
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>

        {action === 'set_plan' ? (
          <>
            <div>
              <label htmlFor="planCode" className="mb-2 block text-sm text-ink">
                Plan
              </label>
              <select
                id="planCode"
                value={planCode}
                onChange={(e) => {
                  setPlanCode(e.target.value as typeof planCode);
                  setConfirming(false);
                }}
                className="select"
              >
                <option value="FREE">Free</option>
                <option value="PRO">Pro</option>
                <option value="PREMIUM">Premium</option>
              </select>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="startsAt" className="mb-2 block text-sm text-ink">
                  Effective from
                </label>
                <input
                  id="startsAt"
                  type="datetime-local"
                  value={startsAt}
                  onChange={(e) => {
                    setStartsAt(e.target.value);
                    setConfirming(false);
                  }}
                  className="input"
                />
                <p className="mt-1.5 text-xs text-muted">Leave blank to apply immediately.</p>
              </div>

              <div>
                <label htmlFor="endsAt" className="mb-2 block text-sm text-ink">
                  Expires
                </label>
                <input
                  id="endsAt"
                  type="datetime-local"
                  value={endsAt}
                  onChange={(e) => {
                    setEndsAt(e.target.value);
                    setConfirming(false);
                  }}
                  className="input"
                />
                <p className="mt-1.5 text-xs text-muted">
                  Leave blank for no expiry — access continues until changed.
                </p>
              </div>
            </div>
          </>
        ) : null}

        {action === 'extend_trial' ? (
          <div>
            <label htmlFor="newTrialEndsAt" className="mb-2 block text-sm text-ink">
              New trial end date
            </label>
            <input
              id="newTrialEndsAt"
              type="datetime-local"
              value={newTrialEndsAt}
              onChange={(e) => setNewTrialEndsAt(e.target.value)}
              className="input"
              aria-describedby="trialExtendHelp"
            />
            <p id="trialExtendHelp" className="mt-1.5 text-xs text-muted">
              The original trial start is never moved — only the end date changes.
              {currentTrialEndsAt
                ? ` Currently ends ${new Date(currentTrialEndsAt).toLocaleDateString()}.`
                : ''}
            </p>
          </div>
        ) : null}

        {action === 'suspend' ? (
          <p className="rounded-xl border border-warn/40 bg-warn/[0.06] px-4 py-3 text-sm text-ink">
            Suspending blocks paid features immediately. The account and all of the user&apos;s data
            remain intact and accessible after they return to Free.
          </p>
        ) : null}

        <div>
          <label htmlFor="reason" className="mb-2 block text-sm text-ink">
            Reason <span className="text-danger">(required)</span>
          </label>
          <input
            id="reason"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setConfirming(false);
            }}
            placeholder="e.g. Payment confirmed via WhatsApp"
            maxLength={500}
            required
            className="input"
          />
          <p className="mt-1.5 text-xs text-muted">
            Recorded in the subscription history so support can see what happened.
          </p>
        </div>

        <div>
          <label htmlFor="adminNote" className="mb-2 block text-sm text-ink">
            Internal note <span className="font-normal text-muted">(optional)</span>
          </label>
          <textarea
            id="adminNote"
            rows={2}
            value={adminNote}
            onChange={(e) => setAdminNote(e.target.value)}
            maxLength={1000}
            className="input resize-y"
          />
          <p className="mt-1.5 text-xs text-muted">
            Private to administrators. Never shown to the user or included in their email.
          </p>
        </div>

        {error ? (
          <p role="alert" className="rounded-xl border border-danger/30 bg-danger/[0.06] px-4 py-3 text-sm text-[#9B2C2C]">
            {error}
          </p>
        ) : null}

        {/* Confirmation step */}
        {confirming && needsConfirm ? (
          <div
            role="alertdialog"
            aria-labelledby="confirm-heading"
            className="rounded-xl border border-gold/50 bg-gold/[0.06] p-4"
          >
            <p id="confirm-heading" className="text-sm font-semibold text-ink">
              {action === 'suspend'
                ? `Suspend paid access for ${userName}?`
                : `Change ${userName}&apos;s plan from ${label(currentPlan)} to ${label(planCode)}?`}
            </p>
            <dl className="mt-3 space-y-1 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Previous plan</dt>
                <dd className="text-ink">{label(currentPlan)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">New plan</dt>
                <dd className="text-ink">{action === 'suspend' ? 'Suspended (no paid access)' : label(planCode)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Effective</dt>
                <dd className="text-ink">
                  {action === 'suspend'
                    ? 'Immediately'
                    : startsAt
                      ? new Date(startsAt).toLocaleString()
                      : 'Immediately'}
                </dd>
              </div>
              {action === 'set_plan' ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Expires</dt>
                  <dd className="text-ink">
                    {endsAt ? new Date(endsAt).toLocaleString() : 'No expiry'}
                  </dd>
                </div>
              ) : null}
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Reason</dt>
                <dd className="text-ink">{reason}</dd>
              </div>
            </dl>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => void submit()}
                disabled={pending}
                className="btn-primary text-xs"
              >
                {pending ? 'Applying…' : 'Confirm change'}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={pending}
                className="btn-secondary text-xs"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={pending || reason.trim().length < 3}
            className="btn-primary"
          >
            {action === 'extend_trial' ? 'Extend trial' : 'Review change'}
          </button>
        )}
      </div>
    </section>
  );
}