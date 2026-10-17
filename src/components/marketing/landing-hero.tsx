import Link from 'next/link';
import { ArrowRight, CheckCircle2, Menu, X, LayoutDashboard } from 'lucide-react';
import { Logo } from '@/components/shared/logo';
import { ThemeToggle } from '@/components/shared/theme-toggle';
import { SpinnerHeroClient } from '@/components/marketing/spinner-hero.client';
import { auth } from '@/auth';

const navLinks = [
  { href: '#features', label: 'Features' },
  { href: '#how-it-works', label: 'How It Works' },
  { href: '#public-jobs', label: 'Public Jobs' },
  { href: '#faq', label: 'FAQ' },
];

export async function LandingHero() {
  const session = await auth();
  return (
    <section id="top" className="relative flex min-h-screen flex-col overflow-hidden bg-background">
      {/* ── Uniform ominous background ── */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
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

      {/* ── Sticky nav ── */}
      <header className="sticky top-0 z-30 pt-4">
        <div className="shell">
          <div className="rounded-[28px] border border-line bg-background/70 px-4 py-3 shadow-nav backdrop-blur-2xl sm:px-5">
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-4">
                <Logo compact href="/" />
              </div>

              <nav className="hidden lg:flex items-center gap-2 rounded-full border border-line bg-surface-sunken p-1.5">
                {navLinks.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    className="rounded-full px-4 py-2 text-sm font-medium text-ink-2 transition hover:bg-surface-sunken-hover hover:text-ink"
                  >
                    {link.label}
                  </a>
                ))}
                <Link
                  href="/jobs-public"
                  className="rounded-full bg-surface-sunken px-4 py-2 text-sm font-semibold text-ink transition hover:bg-surface-sunken-hover"
                >
                  Browse Public Jobs
                </Link>
              </nav>

              <div className="hidden md:flex items-center gap-2.5">
                <ThemeToggle />
                {session?.user ? (
                  <Link
                    href="/dashboard"
                    className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink shadow-[0_10px_32px_rgb(var(--accent)/0.28)] transition hover:bg-accent-hover"
                  >
                    <LayoutDashboard className="h-3.5 w-3.5" />
                    Go to Dashboard
                  </Link>
                ) : (
                  <>
                    <Link className="inline-flex items-center rounded-full border border-line bg-surface-sunken px-4 py-2 text-sm font-medium text-ink-2 transition hover:bg-surface-sunken hover:text-ink" href="/login">
                      Sign In
                    </Link>
                    <Link className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink shadow-[0_10px_32px_rgb(var(--accent)/0.28)] transition hover:bg-accent-hover" href="/register">
                      Start free
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </>
                )}
              </div>

              {/* Mobile menu (no JS, no client component) */}
              <div className="flex items-center gap-2 md:hidden">
                <ThemeToggle />
                <details className="group relative">
                  <summary className="inline-flex h-10 w-10 list-none items-center justify-center rounded-xl border border-line bg-surface-sunken text-ink transition hover:bg-surface-sunken-hover [&::-webkit-details-marker]:hidden">
                    <Menu className="h-5 w-5 group-open:hidden" />
                    <X className="hidden h-5 w-5 group-open:block" />
                    <span className="sr-only">Open menu</span>
                  </summary>

                  <div className="absolute right-0 top-14 z-30 w-[min(88vw,22rem)] rounded-2xl border border-line bg-background/95 p-3 shadow-lift backdrop-blur">
                    <div className="grid gap-2">
                      {navLinks.map((link) => (
                        <a
                          key={link.href}
                          href={link.href}
                          className="inline-flex items-center justify-center rounded-xl border border-line bg-surface-sunken px-4 py-3 text-sm text-ink transition hover:bg-surface-sunken-hover"
                        >
                          {link.label}
                        </a>
                      ))}

                      <div className="my-1 h-px bg-line" />

                      <Link
                        href="/jobs-public"
                        className="inline-flex items-center justify-center rounded-xl border border-line bg-surface-sunken px-4 py-3 text-sm text-ink transition hover:bg-surface-sunken-hover"
                      >
                        Public Jobs Page
                      </Link>
                      <Link
                        href="/demo"
                        className="inline-flex items-center justify-center rounded-xl border border-line bg-surface-sunken px-4 py-3 text-sm text-ink transition hover:bg-surface-sunken-hover"
                      >
                        Watch demo
                      </Link>
                    {session?.user ? (
                      <Link
                        href="/dashboard"
                        className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-accent-ink shadow-[0_10px_32px_rgb(var(--accent)/0.18)] transition hover:bg-accent-hover"
                      >
                        <LayoutDashboard className="h-4 w-4" />
                        Go to Dashboard
                      </Link>
                    ) : (
                      <>
                        <Link
                          href="/login"
                          className="inline-flex items-center justify-center rounded-xl border border-line bg-surface-sunken px-4 py-3 text-sm text-ink transition hover:bg-surface-sunken-hover"
                        >
                          Sign In
                        </Link>
                        <Link
                          href="/register"
                          className="inline-flex items-center justify-center rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-accent-ink shadow-[0_10px_32px_rgb(var(--accent)/0.18)] transition hover:bg-accent-hover"
                        >
                          Start free
                        </Link>
                      </>
                    )}
                  </div>
                  </div>
                </details>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ── Hero content ── */}
      <div className="relative flex flex-1 items-center">
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
                {['AI fit scoring', 'Smart daily queue', 'Pipeline tracking', 'Interview prep'].map((feat) => (
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
