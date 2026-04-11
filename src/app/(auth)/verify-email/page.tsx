import { Suspense } from 'react';
import Link from 'next/link';
import { Logo } from '@/components/shared/logo';
import VerifyEmailClient from './verify-email-client';

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="shell flex min-h-screen items-center justify-center py-12">
          <div className="card-pad w-full max-w-md text-center">
            <div className="mb-6 flex justify-center">
              <Logo centered />
            </div>
            <p className="text-muted">Verifying your email…</p>
          </div>
        </div>
      }
    >
      <VerifyEmailClient />
    </Suspense>
  );
}
