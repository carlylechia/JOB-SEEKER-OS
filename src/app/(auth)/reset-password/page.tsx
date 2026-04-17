'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
import { Logo } from '@/components/shared/logo';

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (!token) {
    return (
      <div className="shell flex min-h-screen items-center justify-center py-12">
        <div className="card-pad w-full max-w-md text-center">
          <div className="mb-6 flex justify-center">
            <Logo centered />
          </div>
          <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-8">
            <div className="text-3xl">❌</div>
            <h2 className="mt-3 text-lg font-semibold text-red-300">Invalid reset link</h2>
            <p className="mt-2 text-sm text-muted">
              This link is missing a reset token. Please request a new one.
            </p>
            <Link href="/forgot-password" className="btn-primary mt-5 inline-block">
              Request new link
            </Link>
          </div>
        </div>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    const res = await fetch('/api/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password, confirmPassword }),
    });

    const payload = await res.json();

    if (!res.ok) {
      const msg = payload.details?.[0] ?? payload.error ?? 'Something went wrong.';
      setError(msg);
      setIsSubmitting(false);
      return;
    }

    setSuccess(true);
    setTimeout(() => router.push('/login'), 3000);
  }

  if (success) {
    return (
      <div className="shell flex min-h-screen items-center justify-center py-12">
        <div className="card-pad w-full max-w-md text-center">
          <div className="mb-6 flex justify-center">
            <Logo centered />
          </div>
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/8 px-4 py-8">
            <div className="text-3xl">✅</div>
            <h2 className="mt-3 text-lg font-semibold text-emerald-300">Password updated!</h2>
            <p className="mt-2 text-sm text-muted">
              Your password has been changed. Redirecting you to sign in…
            </p>
            <Link href="/login" className="btn-primary mt-5 inline-block">
              Sign in now
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="shell flex min-h-screen items-center justify-center py-12">
      <div className="card-pad w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Logo centered />
        </div>

        <h1 className="text-2xl font-semibold">Set a new password</h1>
        <p className="muted mt-1">Choose a strong password (at least 8 characters).</p>

        <form className="mt-6 space-y-3" onSubmit={handleSubmit}>
          <div className="relative">
            <input
              className="input pr-10"
              placeholder="New password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          <input
            className="input"
            placeholder="Confirm new password"
            type={showPassword ? 'text' : 'password'}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={8}
          />

          {error ? (
            <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          ) : null}

          <button className="btn-primary w-full" disabled={isSubmitting} type="submit">
            {isSubmitting ? 'Updating password...' : 'Update password'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="shell flex min-h-screen items-center justify-center py-12">
          <div className="card-pad w-full max-w-md">
            <div className="mb-6 flex justify-center">
              <Logo centered />
            </div>
            <h1 className="text-2xl font-semibold">Set a new password</h1>
            <p className="muted mt-1">Loading...</p>
          </div>
        </div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
