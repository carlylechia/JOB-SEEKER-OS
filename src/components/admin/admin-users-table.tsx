'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, Trash2, X } from 'lucide-react';
import { PlanBadge, StatusBadge } from '@/components/billing/plan-badge';

type AdminUserRow = {
  id: string;
  name: string | null;
  email: string;
  role: 'USER' | 'ADMIN';
  emailVerified: boolean;
  createdAt: string;
  subscription: {
    status: string;
    trialEndsAt: string | null;
    endsAt: string | null;
    plan: { code: string };
  } | null;
};

type DeleteOutcome = {
  userId: string;
  email?: string;
  role?: string;
  status: 'deleted' | 'skipped' | 'failed';
  code?: string;
  message?: string;
};

type ApiPayload = {
  error?: { code?: string; message?: string };
  deleted?: number;
  failed?: number;
  skipped?: number;
  outcomes?: DeleteOutcome[];
  fileCleanup?: { pending?: number; status?: string };
};

type Feedback = { tone: 'success' | 'warning' | 'error'; message: string };

type Confirmation = {
  mode: 'individual' | 'bulk';
  users: AdminUserRow[];
  ids: string[];
};

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString() : '—';
}

function feedbackFor(payload: ApiPayload, mode: 'individual' | 'bulk') {
  const deleted = payload.deleted ?? (mode === 'individual' ? 1 : 0);
  const failed = payload.failed ?? 0;
  const skipped = payload.skipped ?? 0;
  const cleanupPending = payload.fileCleanup?.pending ?? 0;

  if (mode === 'individual') {
    if (cleanupPending > 0) {
      return {
        tone: 'warning' as const,
        message: `User deleted. ${cleanupPending} stored file${cleanupPending === 1 ? '' : 's'} could not be removed yet and ${cleanupPending === 1 ? 'is' : 'are'} queued for retry.`,
      };
    }
    return { tone: 'success' as const, message: 'User deleted.' };
  }

  if (failed === 0 && skipped === 0) {
    return {
      tone: 'success' as const,
      message: `${deleted} user account${deleted === 1 ? '' : 's'} deleted.${cleanupPending > 0 ? ` ${cleanupPending} stored file${cleanupPending === 1 ? '' : 's'} queued for cleanup retry.` : ''}`,
    };
  }

  const notDeleted = (payload.outcomes ?? []).filter((outcome) => outcome.status !== 'deleted');
  const detail = notDeleted
    .slice(0, 5)
    .map((outcome) => `${outcome.email ?? outcome.userId} (${outcome.code ?? outcome.status})`)
    .join(', ');
  const remaining = notDeleted.length - Math.min(notDeleted.length, 5);

  return {
    tone: deleted > 0 ? ('warning' as const) : ('error' as const),
    message: `${deleted} deleted, ${failed} failed, ${skipped} skipped.${detail ? ` ${detail}${remaining > 0 ? ` and ${remaining} more` : ''}.` : ''}${cleanupPending > 0 ? ` ${cleanupPending} stored file${cleanupPending === 1 ? '' : 's'} queued for retry.` : ''}`,
  };
}

export function AdminUsersTable({
  users,
  currentAdminId,
}: {
  users: AdminUserRow[];
  currentAdminId: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [confirmationText, setConfirmationText] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);

  const idsKey = users.map((user) => user.id).join(',');
  // Selection is page-scoped. A new page, filter or refreshed list explicitly
  // clears it rather than silently carrying stale ids into a destructive action.
  useEffect(() => {
    setSelected(new Set());
    setConfirmation(null);
  }, [idsKey]);

  const selectableIds = useMemo(
    () => users.filter((user) => user.id !== currentAdminId).map((user) => user.id),
    [users, currentAdminId],
  );
  const allSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const someSelected = selectableIds.some((id) => selected.has(id));
  const selectedUsers = users.filter((user) => selected.has(user.id));

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected && !allSelected;
  }, [someSelected, allSelected]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (confirmation && !dialog.open) dialog.showModal();
    if (!confirmation && dialog.open) dialog.close();
  }, [confirmation]);

  function toggleOne(user: AdminUserRow) {
    if (user.id === currentAdminId) return;
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(user.id)) next.delete(user.id);
      else next.add(user.id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((previous) => {
      if (allSelected) {
        const next = new Set(previous);
        for (const id of selectableIds) next.delete(id);
        return next;
      }
      return new Set([...previous, ...selectableIds]);
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  function openIndividual(user: AdminUserRow) {
    if (user.id === currentAdminId || pending) return;
    setError(null);
    setConfirmationText('');
    setConfirmation({ mode: 'individual', users: [user], ids: [user.id] });
  }

  function openBulk() {
    if (selectedUsers.length === 0 || pending) return;
    setError(null);
    setConfirmationText('');
    setConfirmation({ mode: 'bulk', users: selectedUsers, ids: selectedUsers.map((user) => user.id) });
  }

  function closeDialog() {
    if (pending) return;
    setConfirmation(null);
    setConfirmationText('');
    setError(null);
  }

  async function submitDelete() {
    if (!confirmation || pending) return;
    setPending(true);
    setError(null);

    try {
      const response =
        confirmation.mode === 'individual'
          ? await fetch(`/api/admin/users/${confirmation.ids[0]}`, { method: 'DELETE' })
          : await fetch('/api/admin/users/bulk-delete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userIds: confirmation.ids }),
            });

      const payload = (await response.json().catch(() => null)) as ApiPayload | null;

      if (!response.ok) {
        setError(
          payload?.error?.message ??
            'The deletion could not be completed. Refresh the page and check the current state before retrying.',
        );
        // A missing account means the list is stale; refresh so the admin is
        // not shown a row that no longer exists.
        if (response.status === 404) router.refresh();
        return;
      }

      setFeedback(feedbackFor(payload ?? {}, confirmation.mode));
      setConfirmation(null);
      setConfirmationText('');
      setSelected(new Set());
      router.refresh();
    } catch {
      setError('We could not reach the server. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  }

  const requiredPhrase =
    confirmation?.mode === 'individual' ? confirmation.users[0]?.email ?? '' : 'DELETE';
  const confirmationMatches =
    requiredPhrase.length > 0 &&
    confirmationText.trim().toLowerCase() === requiredPhrase.trim().toLowerCase();

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">
          Selection applies to this page only. Changing page or filters clears it.
        </p>
        {selected.size > 0 ? (
          <div
            role="region"
            aria-label="Bulk user actions"
            className="flex flex-wrap items-center gap-2 rounded-xl border border-accent/40 bg-accent/[0.08] px-3 py-2"
          >
            <span className="text-sm font-medium text-ink" aria-live="polite">
              {selected.size} selected
            </span>
            <button type="button" onClick={clearSelection} className="text-xs text-muted underline underline-offset-2 hover:text-ink">
              Clear
            </button>
            <button
              type="button"
              onClick={openBulk}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-danger/30 bg-danger/10 px-3 py-1.5 text-xs font-medium text-danger-text transition-colors hover:bg-danger/20 disabled:opacity-60"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              Delete selected
            </button>
          </div>
        ) : null}
      </div>

      {feedback ? (
        <div
          role={feedback.tone === 'error' ? 'alert' : 'status'}
          className={`rounded-xl border px-4 py-3 text-sm ${
            feedback.tone === 'success'
              ? 'border-success/30 bg-success/[0.06] text-success-text'
              : feedback.tone === 'warning'
                ? 'border-warn/30 bg-warn/[0.06] text-warn-text'
                : 'border-danger/30 bg-danger/[0.06] text-danger-text'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <p>{feedback.message}</p>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="shrink-0 text-current opacity-70 hover:opacity-100"
              aria-label="Dismiss message"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}

      {/* Desktop table */}
      <div className="table-wrap hidden md:block">
        <table className="table">
          <caption className="sr-only">User directory with selection and deletion actions</caption>
          <thead>
            <tr>
              <th scope="col" className="w-10">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  disabled={selectableIds.length === 0}
                  aria-label="Select all eligible users on this page"
                  className="h-4 w-4 accent-[rgb(var(--accent))]"
                />
              </th>
              <th scope="col">User</th>
              <th scope="col">Role</th>
              <th scope="col">Plan</th>
              <th scope="col">Status</th>
              <th scope="col">Trial ends</th>
              <th scope="col">Plan ends</th>
              <th scope="col">Joined</th>
              <th className="text-right" scope="col">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const isSelf = user.id === currentAdminId;
              const isSelected = selected.has(user.id);
              return (
                <tr key={user.id} className={isSelected ? 'bg-accent/[0.06]' : undefined}>
                  <td>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleOne(user)}
                      disabled={isSelf}
                      aria-label={
                        isSelf
                          ? `You cannot select your own account (${user.email})`
                          : `Select ${user.email}`
                      }
                      title={isSelf ? 'You cannot select your own account' : undefined}
                      className="h-4 w-4 accent-[rgb(var(--accent))] disabled:opacity-40"
                    />
                  </td>
                  <td>
                    <div className="flex flex-wrap items-center gap-1.5 font-medium text-ink">
                      {user.name ?? '—'}
                      {isSelf ? <span className="badge bg-accent/15 text-accent-text">You</span> : null}
                    </div>
                    <div className="text-xs text-muted">{user.email}</div>
                    {!user.emailVerified ? (
                      <span className="mt-1 inline-block text-[11px] text-warn-text">Unverified email</span>
                    ) : null}
                  </td>
                  <td>{user.role}</td>
                  <td>
                    {user.subscription ? (
                      <PlanBadge plan={user.subscription.plan.code as never} />
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    {user.subscription ? <StatusBadge status={user.subscription.status} /> : '—'}
                  </td>
                  <td className="whitespace-nowrap text-xs">
                    {formatDate(user.subscription?.trialEndsAt ?? null)}
                  </td>
                  <td className="whitespace-nowrap text-xs">
                    {formatDate(user.subscription?.endsAt ?? null)}
                  </td>
                  <td className="whitespace-nowrap text-xs">{formatDate(user.createdAt)}</td>
                  <td>
                    <div className="flex items-center justify-end gap-1.5">
                      <Link href={`/admin/users/${user.id}`} className="btn-secondary px-3 py-1 text-xs">
                        View
                      </Link>
                      <button
                        type="button"
                        onClick={() => openIndividual(user)}
                        disabled={isSelf || pending}
                        title={
                          isSelf
                            ? 'You cannot delete your own administrator account'
                            : `Delete ${user.email}`
                        }
                        className="inline-flex items-center gap-1 rounded-xl border border-danger/30 bg-danger/10 px-2.5 py-1 text-xs font-medium text-danger-text transition-colors hover:bg-danger/20 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <ul className="space-y-3 md:hidden">
        {users.map((user) => {
          const isSelf = user.id === currentAdminId;
          const isSelected = selected.has(user.id);
          return (
            <li
              key={user.id}
              className={`card-pad ${isSelected ? 'border-accent/60 bg-accent/[0.06]' : ''}`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleOne(user)}
                  disabled={isSelf}
                  aria-label={isSelf ? 'You cannot select your own account' : `Select ${user.email}`}
                  className="mt-1 h-4 w-4 shrink-0 accent-[rgb(var(--accent))] disabled:opacity-40"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-1.5 font-medium text-ink">
                        {user.name ?? '—'}
                        {isSelf ? <span className="badge bg-accent/15 text-accent-text">You</span> : null}
                      </p>
                      <p className="truncate text-xs text-muted">{user.email}</p>
                    </div>
                    {user.subscription ? (
                      <PlanBadge plan={user.subscription.plan.code as never} />
                    ) : null}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {user.subscription ? <StatusBadge status={user.subscription.status} /> : null}
                    <span className="text-xs text-muted">{user.role}</span>
                    <span className="text-xs text-muted">Joined {formatDate(user.createdAt)}</span>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Link href={`/admin/users/${user.id}`} className="btn-secondary flex-1 text-xs">
                      View user
                    </Link>
                    <button
                      type="button"
                      onClick={() => openIndividual(user)}
                      disabled={isSelf || pending}
                      title={isSelf ? 'You cannot delete your own account' : `Delete ${user.email}`}
                      className="inline-flex items-center justify-center gap-1 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs font-medium text-danger-text disabled:opacity-40"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {users.length === 0 ? <p className="muted">No users match these filters.</p> : null}

      <dialog
        ref={dialogRef}
        onCancel={(event) => {
          if (pending) {
            event.preventDefault();
            return;
          }
          setConfirmation(null);
          setConfirmationText('');
          setError(null);
        }}
        onClose={() => {
          if (!pending) {
            setConfirmation(null);
            setConfirmationText('');
          }
        }}
        aria-labelledby="delete-user-title"
        aria-describedby="delete-user-description"
        className="m-auto w-[min(92vw,34rem)] rounded-2xl border border-line bg-card p-0 text-ink shadow-lift backdrop:bg-ink/50 backdrop:backdrop-blur-sm"
      >
        {confirmation ? (
          <div className="p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <span className="rounded-xl bg-danger/10 p-2 text-danger-text">
                <Trash2 className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h2 id="delete-user-title" className="font-display text-xl font-semibold text-ink">
                  {confirmation.mode === 'individual'
                    ? 'Delete this user account?'
                    : `Delete ${confirmation.users.length} user account${confirmation.users.length === 1 ? '' : 's'}?`}
                </h2>
                <p id="delete-user-description" className="mt-2 text-sm leading-6 text-muted">
                  {confirmation.mode === 'individual' ? (
                    <>
                      You are about to permanently delete{' '}
                      <strong className="text-ink">{confirmation.users[0]?.email}</strong>. Their
                      account and owned data — jobs, applications, resumes, interview preparation,
                      notifications and subscription records — will be removed. Stored files are
                      deleted or queued for retry. This cannot be easily undone.
                    </>
                  ) : (
                    <>
                      You’re about to delete <strong className="text-ink">{confirmation.users.length}</strong>{' '}
                      user accounts. Their accounts and owned data — jobs, applications, resumes,
                      interview preparation, notifications and subscription records — will be
                      removed. Stored files are deleted or queued for retry. This cannot be easily
                      undone. The operation stops safely on protected accounts.
                    </>
                  )}
                </p>
              </div>
            </div>

            <div className="mt-5">
              <label htmlFor="delete-confirmation" className="block text-sm font-medium text-ink">
                Type <strong>{requiredPhrase}</strong> to confirm
              </label>
              <input
                id="delete-confirmation"
                className="input mt-2"
                value={confirmationText}
                onChange={(event) => setConfirmationText(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                disabled={pending}
                autoFocus
              />
            </div>

            {error ? (
              <p role="alert" className="mt-3 rounded-xl border border-danger/30 bg-danger/[0.06] px-3 py-2 text-sm text-danger-text">
                {error}
              </p>
            ) : null}

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={closeDialog} disabled={pending} className="btn-secondary">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitDelete()}
                disabled={pending || !confirmationMatches}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-danger-solid px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pending ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
                {pending
                  ? 'Deleting…'
                  : confirmation.mode === 'individual'
                    ? 'Delete user'
                    : `Delete ${confirmation.users.length} users`}
              </button>
            </div>
          </div>
        ) : null}
      </dialog>
    </div>
  );
}
