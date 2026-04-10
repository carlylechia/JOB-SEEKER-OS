'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function SavePublicJobButton({
  jobId,
  isAuthenticated,
}: {
  jobId: string;
  isAuthenticated: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);

  async function handleSave() {
    if (!isAuthenticated) {
      // Redirect to login with callbackUrl that routes through /auth/continue
      // The save API cookie approach is unreliable across auth flows,
      // so we pass the jobId explicitly in the URL.
      router.push(`/login?callbackUrl=${encodeURIComponent(`/auth/continue/import?jobId=${jobId}`)}`);
      return;
    }

    setSaving(true);
    setError(false);

    try {
      const res = await fetch(`/api/public-jobs/${jobId}/save`, {
        method: 'POST',
      });

      const data = await res.json();

      if (!res.ok || !data?.jobId) {
        throw new Error('Save failed');
      }

      setSaved(true);

      // Navigate to the saved job
      router.push(`/jobs/${data.jobId}`);
    } catch {
      setError(true);
      setSaving(false);
    }
  }

  if (saved) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-300">
        ✓ Saved
      </span>
    );
  }

  return (
    <button
      className="btn-primary"
      onClick={handleSave}
      disabled={saving}
    >
      {saving ? 'Saving...' : error ? 'Retry save' : isAuthenticated ? 'Save to workspace' : 'Sign in & save'}
    </button>
  );
}
