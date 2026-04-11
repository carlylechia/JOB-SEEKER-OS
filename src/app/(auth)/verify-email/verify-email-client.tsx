'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Logo } from '@/components/shared/logo';

type State = 'loading' | 'success' | 'already' | 'error';

export default function VerifyEmailClient() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [state, setState] = useState<State>('loading');
  const [errorMessage, setErrorMessage] = useState('Invalid or expired verification link.');

  useEffect(() => {
    if (!token) {
      setState('error');
      return;
    }

    fetch(`/api/verify-email?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok && data.alreadyVerified) setState('already');
        else if (data.ok) setState('success');
        else {
          setErrorMessage(data.error ?? 'Verification failed.');
          setState('error');
        }
      })
      .catch(() => {
        setErrorMessage('Something went wrong. Please try again.');
        setState('error');
      });
  }, [token]);

  return (
    <div className="shell flex min-h-screen items-center justify-center py-12">
      <div className="card-pad w-full max-w-md text-center">
        <div className="mb-6 flex justify-center">
          <Logo centered />
        </div>

        {state === 'loading' && (
          <>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent/10">
              <svg className="h-6 w-6 animate-spin text-accent" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
            <h1 className="text-xl font-semibold">Verifying your email…</h1>
            <p className="mt-2 text-sm text-muted">This will only take a moment.</p>
          </>
        )}

        {state === 'success' && (
          <>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 text-2xl">
              ✅
            </div>
            <h1 className="text-xl font-semibold text-emerald-300">Email verified!</h1>
            <p className="mt-2 text-sm text-muted">
              Your account is now active. You can sign in and start using Job Seeker OS.
            </p>
            <Link href="/login" className="btn-primary mt-6 inline-block">
              Sign in
            </Link>
          </>
        )}

        {state === 'already' && (
          <>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-sky-500/15 text-2xl">
              ✔️
            </div>
            <h1 className="text-xl font-semibold">Already verified</h1>
            <p className="mt-2 text-sm text-muted">
              Your email has already been verified. Sign in to access your workspace.
            </p>
            <Link href="/login" className="btn-primary mt-6 inline-block">
              Sign in
            </Link>
          </>
        )}

        {state === 'error' && (
          <>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/15 text-2xl">
              ✗
            </div>
            <h1 className="text-xl font-semibold text-red-300">Verification failed</h1>
            <p className="mt-2 text-sm text-muted">{errorMessage}</p>
            <div className="mt-6 flex justify-center gap-3">
              <Link href="/register" className="btn-primary">
                Register again
              </Link>
              <Link href="/login" className="btn-secondary">
                Sign in
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
