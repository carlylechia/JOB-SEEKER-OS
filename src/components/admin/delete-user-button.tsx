'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Admin, destructive, user deletion.
 *
 * The backend enforces the real safety rules (self-deletion, last-admin,
 * rate limit, audit log). The client only asks for a DELETE and offers an
 * email-confirmation escape hatch because this action is irreversible.
 */
export function DeleteUserButton({
  userId,
  userEmail,
  isSelf,
}: {
  userId: string;
  userEmail: string;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleDelete() {
    if (pending) return;
    setPending(true);
    setError(null);
    setSuccess(false);
    try {
      const response = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setError(
          payload?.error?.message ?? 'Unable to delete this user right now. Please try again.',
        );
        return;
      }

      setSuccess(true);
      router.push('/admin/users');
      router.refresh();
    } catch {
      setError('We could not reach the server. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  }

  if (isSelf) {
    return (
      <p className="text-sm text-muted">
        You cannot delete your own administrator account.
      </p>
    );
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="btn-danger"
        disabled={pending}
      >
        Delete user
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-danger-text">
        This permanently deletes the user and all of their jobs, resumes and notes. Type the
        email <strong>{userEmail}</strong> to confirm.
      </p>
      <input
        className="input"
        value={confirmation}
        onChange={(event) => setConfirmation(event.target.value)}
        placeholder={userEmail}
        autoComplete="off"
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void handleDelete()}
          disabled={pending || confirmation.trim() !== userEmail}
          className="btn-danger"
        >
          {pending ? 'Deleting…' : 'Permanently delete'}
        </button>
        <button
          type="button"
          onClick={() => {
            setConfirming(false);
            setConfirmation('');
          }}
          className="btn-secondary"
          disabled={pending}
        >
          Cancel
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger-text">{error}</p>
      ) : null}
      {success ? (
        <p role="status" className="text-sm text-success-text">User deleted.</p>
      ) : null}
    </div>
  );
}
