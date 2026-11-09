import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Compass, Home } from 'lucide-react';
import { auth } from '@/auth';
import { BackButton } from '@/components/shared/back-button';
import { Logo } from '@/components/shared/logo';

export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false, follow: false },
};

/**
 * Global not-found boundary.
 *
 * Next.js still returns HTTP 404 for genuinely unknown routes; this file only
 * changes what the user sees. Authentication is read here so the primary
 * action points at the workspace for signed-in users and the public home page
 * for everyone else.
 */
export default async function NotFound() {
  const session = await auth().catch(() => null);
  const signedIn = Boolean(session?.user?.id);
  const primaryHref = signedIn ? '/dashboard' : '/';
  const primaryLabel = signedIn ? 'Back to dashboard' : 'Back to home';

  return (
    <main className="ambient-canvas relative flex min-h-dvh w-full items-center justify-center overflow-hidden px-4 py-12">
      {/* Decorative field — behind the content and never interactive. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="ambient-orb absolute -left-24 top-16 h-72 w-72 opacity-60" />
        <div className="ambient-orb ambient-orb--sand absolute -right-20 bottom-6 h-80 w-80 opacity-50" />
        <div className="dot-field absolute inset-x-0 top-0 h-1/2 opacity-40 [mask-image:linear-gradient(to_bottom,black,transparent)]" />
      </div>

      <div className="relative w-full max-w-3xl text-center">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>

        <div className="relative mx-auto w-fit">
          <span
            aria-hidden="true"
            className="absolute inset-0 translate-x-1 translate-y-1 text-[clamp(6.5rem,24vw,13rem)] font-display font-semibold leading-none tracking-[-0.07em] text-accent/35 blur-[1px]"
          >
            404
          </span>
          <p className="relative bg-gradient-to-b from-ink via-ink-2 to-muted bg-clip-text text-[clamp(6.5rem,24vw,13rem)] font-display font-semibold leading-none tracking-[-0.07em] text-transparent">
            404
          </p>
        </div>

        <h1 className="mt-2 font-display text-3xl font-semibold text-ink sm:text-4xl">
          This page slipped out of the pipeline.
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-muted sm:text-base">
          We could not find the page you asked for. It may have moved, been renamed, or never
          existed. Your jobs, applications and resumes are untouched.
        </p>

        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href={primaryHref} className="btn-primary w-full gap-2 sm:w-auto">
            <Compass className="h-4 w-4" aria-hidden="true" />
            {primaryLabel}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          <BackButton fallbackHref={primaryHref} label="Go back" className="btn-secondary w-full sm:w-auto" />
          {signedIn ? (
            <Link href="/" className="btn-secondary w-full gap-2 sm:w-auto">
              <Home className="h-4 w-4" aria-hidden="true" />
              Home
            </Link>
          ) : null}
        </div>

        <p className="mt-8 text-xs text-muted">
          If a link inside teChia Jobs brought you here, it may have been removed.
        </p>
      </div>
    </main>
  );
}
