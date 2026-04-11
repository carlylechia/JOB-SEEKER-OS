'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Logo } from '@/components/shared/logo';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const callbackUrl = searchParams.get('callbackUrl') || '/dashboard';

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    const result = await signIn('credentials', {
      email,
      password,
      redirect: false,
    });

    if (result?.error) {
      if (result.error === 'EMAIL_NOT_VERIFIED') {
        setError('EMAIL_NOT_VERIFIED');
      } else {
        setError('Invalid email or password.');
      }
      setIsSubmitting(false);
      return;
    }

    // ✅ Redirect correctly
    router.push(callbackUrl);
    router.refresh();
  }

  return (
    <div className="shell flex min-h-screen items-center justify-center py-12">
      <div className="card-pad w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Logo centered />
        </div>

        <h1 className="text-2xl font-semibold">Sign in</h1>
        <p className="muted mt-1">
          Access your saved workspace, dashboard, and personalized rankings.
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

          <input
            className="input"
            placeholder="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          {error === 'EMAIL_NOT_VERIFIED' ? (
            <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-3 text-sm text-amber-200">
              Please verify your email before signing in.{' '}
              <strong>Check your inbox</strong> for the verification link.
            </div>
          ) : error ? (
            <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          ) : null}

          <button
            className="btn-primary w-full"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting ? 'Signing in...' : 'Continue to app'}
          </button>
        </form>

        <p className="mt-4 text-sm text-muted">
          No account yet?{' '}
          <Link href={callbackUrl && callbackUrl !== '/dashboard' ? `/register?callbackUrl=${encodeURIComponent(callbackUrl)}` : '/register'} className="text-accent">
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="shell flex min-h-screen items-center justify-center py-12">
          <div className="card-pad w-full max-w-md">
            <div className="mb-6 flex justify-center">
              <Logo centered />
            </div>
            <h1 className="text-2xl font-semibold">Sign in</h1>
            <p className="muted mt-1">Loading...</p>
          </div>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
