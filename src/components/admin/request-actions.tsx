'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Admin actions for a single upgrade request.
 *
 * The workflow the dashboard makes operational truth:
 *   New → Review → Contact user → Discuss → Update plan → Approve → User notified
 *
 * Approval optionally activates the plan in the SAME database transaction, so
 * the request can never end up "approved" while the plan was not changed.
 */
export function RequestActions({
  requestId,
  status,
  requestedPlan,
  userName,
}: {
  requestId: string;
  status: string;
  requestedPlan: string;
  userName: string;
}) {
  const router = useRouter();

  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [adminNote, setAdminNote] = useState('');
  const [activatePlan, setActivatePlan] = useState(true);
  const [confirmApprove, setConfirmApprove] = useState(false);

  const isOpen = status === 'PENDING' || status === 'CONTACTED';

  async function run(action: string, extra: Record<string, unknown> = {}) {
    if (pending) return; // Blocks double-submission.
    setPending(action);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`/api/admin/upgrade-requests/${requestId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, adminNote: adminNote || undefined, ...extra }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        if (response.status === 409) {
          setError(
            payload?.error?.message ??
              'This request was already handled by another administrator. Reload to see the current state.',
          );
        } else if (response.status === 404) {
          setError('That request no longer exists.');
        } else {
          setError(payload?.error?.message ?? "We couldn't update the request. Please try again.");
        }
        return;
      }

      setSuccess(
        action === 'mark_contacted'
          ? 'Marked as contacted.'
          : action === 'approve'
            ? `Plan updated successfully.`
            : action === 'reject'
              ? 'Request rejected.'
              : 'Request cancelled.',
      );
      setAdminNote('');
      setConfirmApprove(false);
      router.refresh();
    } catch {
      setError('We could not reach the server. Check your connection and try again.');
    } finally {
      setPending(null);
    }
  }

  if (!isOpen) {
    return (
      <section aria-labelledby="actions-heading" className="card-pad">
        <h2 id="actions-heading" className="text-sm font-semibold text-ink">
          Actions
        </h2>
        <p className="muted mt-2">
          This request is {status.toLowerCase()} and can no longer be changed. Create a new plan
          change from the user record if needed.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="actions-heading" className="card-pad">
      <h2 id="actions-heading" className="text-sm font-semibold text-ink">
        Actions
      </h2>

      <div className="mt-4 space-y-4">
        <div>
          <label htmlFor="adminNote" className="mb-2 block text-sm text-ink">
            Internal admin note <span className="font-normal text-muted">(optional)</span>
          </label>
          <textarea
            id="adminNote"
            rows={2}
            value={adminNote}
            onChange={(e) => setAdminNote(e.target.value)}
            maxLength={1000}
            className="input resize-y"
            placeholder="e.g. Called on WhatsApp, agreed to 30-day Pro"
          />
          <p className="mt-1.5 text-xs text-muted">
            Private to administrators. Never shown to the user or included in their email.
          </p>
        </div>

        {status === 'PENDING' ? (
          <button
            type="button"
            onClick={() => void run('mark_contacted')}
            disabled={Boolean(pending)}
            className="btn-secondary"
          >
            {pending === 'mark_contacted' ? 'Saving…' : 'Mark contacted'}
          </button>
        ) : null}

        {/* Approve + activate */}
        <div className="rounded-xl border border-line p-4">
          <label className="flex items-start gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={activatePlan}
              onChange={(e) => setActivatePlan(e.target.checked)}
              className="mt-0.5 accent-[#D4AF37]"
            />
            <span>
              Activate the {requestedPlan.charAt(0) + requestedPlan.slice(1).toLowerCase()} plan when
              approving
              <span className="block text-xs text-muted">
                Plan change and request approval commit together, so they can never disagree.
              </span>
            </span>
          </label>

          {confirmApprove ? (
            <div role="alertdialog" aria-labelledby="approve-confirm" className="mt-4 rounded-xl border border-gold/50 bg-gold/[0.06] p-4">
              <p id="approve-confirm" className="text-sm font-semibold text-ink">
                Approve this request{activatePlan ? ` and activate ${requestedPlan} for ${userName}` : ''}?
              </p>
              <p className="mt-1 text-sm text-muted">
                {activatePlan
                  ? "The user's access changes immediately and they are notified."
                  : 'The request is marked approved. Remember to update the plan separately.'}
              </p>
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => void run('approve', { activatePlan })}
                  disabled={Boolean(pending)}
                  className="btn-primary text-xs"
                >
                  {pending === 'approve' ? 'Approving…' : 'Confirm approval'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmApprove(false)}
                  disabled={Boolean(pending)}
                  className="btn-secondary text-xs"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmApprove(true)}
              disabled={Boolean(pending)}
              className="btn-primary mt-4"
            >
              Approve request
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void run('reject')}
            disabled={Boolean(pending)}
            className="btn-secondary"
          >
            {pending === 'reject' ? 'Saving…' : 'Reject'}
          </button>
          <button
            type="button"
            onClick={() => void run('cancel')}
            disabled={Boolean(pending)}
            className="btn-secondary"
          >
            {pending === 'cancel' ? 'Saving…' : 'Cancel request'}
          </button>
          <button
            type="button"
            onClick={() => void run('add_note', { adminNote })}
            disabled={Boolean(pending) || !adminNote}
            className="btn-secondary"
          >
            {pending === 'add_note' ? 'Saving…' : 'Save note'}
          </button>
        </div>

        {error ? (
          <p role="alert" className="rounded-xl border border-danger/30 bg-danger/[0.06] px-4 py-3 text-sm text-[#9B2C2C]">
            {error}
          </p>
        ) : null}
        {success ? (
          <p role="status" className="rounded-xl border border-success/30 bg-success/[0.06] px-4 py-3 text-sm text-[#136B45]">
            {success}
          </p>
        ) : null}
      </div>
    </section>
  );
}