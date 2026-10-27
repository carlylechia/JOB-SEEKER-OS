import Link from 'next/link';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { SpinnerHeroClient } from '@/components/marketing/spinner-hero.client';

/**
 * Landing hero. Deliberately contains no navigation: `LandingNav` is rendered
 * by the page so it can stay pinned across the whole document rather than
 * being bounded by this section.
 */
export function LandingHero() {
  return (
    <section id="top" className="relative flex min-h-screen flex-col bg-background">
      {/* ── Uniform ominous background ── */}
      {/* The clip belongs on this layer, not on <section>: an `overflow` other
          than `visible` on any ancestor turns it into a scroll container. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(circle at 18% 12%, var(--hero-orb-1), transparent 42%), radial-gradient(circle at 76% 22%, var(--hero-orb-2), transparent 46%)',
          }}
        />
        <div
          className="absolute -inset-[55%] hero-beam-pan blur-[80px] opacity-[0.42]"
          style={{
            backgroundImage:
              'conic-gradient(from 120deg, rgba(0,0,0,0), var(--hero-beam), var(--hero-orb-1), rgba(0,0,0,0))',
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(circle at center, transparent 30%, var(--hero-vignette) 100%)',
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-background" />
      </div>

      {/* ── Hero content ── */}
      {/* Extra top padding clears the fixed LandingNav that floats above. */}
      <div className="relative flex flex-1 items-center pt-24 sm:pt-28">
        <div className="shell py-14 lg:py-20">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            {/* Left column */}
            <div className="max-w-xl">
              <p className="hero-l1 inline-flex items-center rounded-full border border-line bg-surface-sunken px-3 py-1.5 text-xs font-semibold tracking-wide text-ink-2">
                A teChia Digital Solutions product
              </p>

              <h1 className="hero-l2 mt-6 text-4xl font-semibold leading-[1.08] tracking-tight text-ink sm:text-5xl xl:text-6xl">
                The AI-powered operating system for <span className="shimmer-text">your job search.</span>
              </h1>

              <p className="hero-l3 mt-5 text-base leading-7 text-ink-2 sm:text-lg">
                Track opportunities, score fit, and work the right next step each day — without losing momentum across tabs,
                notes, and reminders.
              </p>

              <div className="hero-l4 mt-8 flex flex-wrap gap-3">
                <Link
                  href="/register"
                  className="btn-primary gap-2 px-5 py-2.5 text-[0.95rem] shadow-lg shadow-accent/20"
                >
                  Create free workspace <ArrowRight className="h-4 w-4" />
                </Link>
                <Link href="/demo" className="btn-secondary px-5 py-2.5 text-[0.95rem]">
                  Watch demo
                </Link>
              </div>

              <div className="hero-l5 mt-8 grid gap-3 sm:grid-cols-2">
                {['AI fit scoring', 'Daily Top 5 discovery', 'Resume intelligence', 'AI job intelligence', 'Resume builder', 'Application materials', 'Interview prep', 'Pipeline tracking'].map((feat) => (
                  <div key={feat} className="flex items-center gap-2 text-sm text-ink-2">
                    <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-accent-text" />
                    {feat}
                  </div>
                ))}
              </div>
            </div>

            {/* Right column (client-only spinner, no separate background panel) */}
            <div className="hero-r1">
              <div className="mx-auto w-[min(440px,88vw)] sm:w-[480px] lg:w-[520px]">
                <SpinnerHeroClient className="w-full" />
              </div>
              <p className="mt-5 text-center text-xs leading-5 text-muted">
                Relax and trust the process.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Scroll indicator ── */}
      <div className="relative pb-10 flex justify-center">
        <div className="flex flex-col items-center gap-2 text-muted">
          <span className="text-xs tracking-wide">Scroll to explore</span>
          <div className="h-8 w-px bg-gradient-to-b from-transparent via-line-strong/60 to-transparent animate-pulse" />
        </div>
      </div>
    </section>
  );
}
