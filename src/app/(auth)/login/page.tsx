'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
import { Logo } from '@/components/shared/logo';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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

          <div className="relative">
            <input
              className="input pr-10"
              placeholder="Password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
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

        <p className="mt-2 text-sm text-muted">
          <Link href="/forgot-password" className="text-accent">
            Forgot your password?
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
