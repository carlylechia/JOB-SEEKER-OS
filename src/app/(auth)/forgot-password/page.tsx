'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { Logo } from '@/components/shared/logo';

function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    const res = await fetch('/api/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    const payload = await res.json();

    if (!res.ok) {
      setError(payload.error || 'Something went wrong. Please try again.');
      setIsSubmitting(false);
      return;
    }

    setSent(true);
  }

  if (sent) {
    return (
      <div className="shell flex min-h-screen items-center justify-center py-12">
        <div className="card-pad w-full max-w-md text-center">
          <div className="mb-6 flex justify-center">
            <Logo centered />
          </div>
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/8 px-4 py-8">
            <div className="text-3xl">📧</div>
            <h2 className="mt-3 text-lg font-semibold text-emerald-300">Check your inbox</h2>
            <p className="mt-2 text-sm text-muted">
              If an account exists for <strong className="text-foreground">{email}</strong>, you'll
              receive a password reset link shortly.
            </p>
            <Link href="/login" className="btn-primary mt-5 inline-block">
              Back to sign in
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

        <h1 className="text-2xl font-semibold">Forgot your password?</h1>
        <p className="muted mt-1">
          Enter your email and we'll send you a reset link valid for 1 hour.
        </p>

        <form className="mt-6 space-y-3" onSubmit={handleSubmit}>
          <input
            className="input"
            placeholder="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          {error ? (
            <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          ) : null}

          <button className="btn-primary w-full" disabled={isSubmitting} type="submit">
            {isSubmitting ? 'Sending...' : 'Send reset link'}
          </button>
        </form>

        <p className="mt-4 text-sm text-muted">
          Remember your password?{' '}
          <Link href="/login" className="text-accent">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="shell flex min-h-screen items-center justify-center py-12">
          <div className="card-pad w-full max-w-md">
            <div className="mb-6 flex justify-center">
              <Logo centered />
            </div>
            <h1 className="text-2xl font-semibold">Forgot your password?</h1>
            <p className="muted mt-1">Loading...</p>
          </div>
        </div>
      }
    >
      <ForgotPasswordForm />
    </Suspense>
  );
}
