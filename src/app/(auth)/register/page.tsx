'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Logo } from '@/components/shared/logo';

function RegisterForm() {
  const searchParams = useSearchParams();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const callbackUrl = searchParams.get('callbackUrl') || '/onboarding';

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    const response = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password, confirmPassword }),
    });

    const payload = await response.json();

    if (!response.ok) {
      setError(payload.error || 'Unable to create your account.');
      setIsSubmitting(false);
      return;
    }

    setSuccess(true);
  }

  if (success) {
    return (
      <div className="shell flex min-h-screen items-center justify-center py-12">
        <div className="card-pad w-full max-w-md text-center">
          <div className="mb-6 flex justify-center">
            <Logo centered />
          </div>
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/8 px-4 py-8">
            <div className="text-3xl">📧</div>
            <h2 className="mt-3 text-lg font-semibold text-emerald-300">Check your inbox!</h2>
            <p className="mt-2 text-sm text-muted">
              We sent a verification link to <strong className="text-foreground">{email}</strong>.
              Click it to activate your account.
            </p>
            <Link href="/login" className="btn-primary mt-5 inline-block">
              Go to sign in
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

        <h1 className="text-2xl font-semibold">Create your workspace</h1>
        <p className="muted mt-1">
          We’ll create a seeded starter workspace so you can explore the product immediately.
        </p>

        <form className="mt-6 space-y-3" onSubmit={handleSubmit}>
          <input
            className="input"
            placeholder="Full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />

          <input
            className="input"
            placeholder="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <input
            className="input"
            placeholder="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />

          <input
            className="input"
            placeholder="Confirm password"
            type="password"
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

          <button
            className="btn-primary w-full"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting ? 'Creating account...' : 'Create account'}
          </button>
        </form>

        <p className="mt-4 text-sm text-muted">
          Already have an account?{' '}
          <Link href={callbackUrl && callbackUrl !== '/onboarding' ? `/login?callbackUrl=${encodeURIComponent(callbackUrl)}` : '/login'} className="text-accent">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <div className="shell flex min-h-screen items-center justify-center py-12">
          <div className="card-pad w-full max-w-md">
            <div className="mb-6 flex justify-center">
              <Logo centered />
            </div>
            <h1 className="text-2xl font-semibold">Create your workspace</h1>
            <p className="muted mt-1">Loading...</p>
          </div>
        </div>
      }
    >
      <RegisterForm />
    </Suspense>
  );
}
