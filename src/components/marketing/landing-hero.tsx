import Link from 'next/link';
import { ArrowRight, CheckCircle2, Menu, X, LayoutDashboard } from 'lucide-react';
import { Logo } from '@/components/shared/logo';
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
    <section id="top" className="relative flex min-h-screen flex-col overflow-hidden bg-[#FAFAF7]">
      {/* ── Uniform ominous background ── */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(201,206,214,0.14),transparent_42%),radial-gradient(circle_at_76%_22%,rgba(212,175,55,0.10),transparent_46%)]" />
        <div className="absolute -inset-[55%] hero-beam-pan bg-[conic-gradient(from_120deg,rgba(212,175,55,0.0),rgba(212,175,55,0.12),rgba(201,206,214,0.12),rgba(212,175,55,0.0))] blur-[80px] opacity-[0.42]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_30%,rgba(17,19,24,0.05)_70%,rgba(17,19,24,0.10)_100%)]" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#FAFAF7]" />
      </div>

      {/* ── Sticky nav ── */}
      <header className="sticky top-0 z-30 pt-4">
        <div className="shell">
          <div className="rounded-[28px] border border-[#DFE3E9] bg-[#FAFAF7]/66 px-4 py-3 shadow-[0_18px_60px_rgba(17,19,24,0.12)] backdrop-blur-2xl sm:px-5">
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-4">
                <Logo compact href="/" />
              </div>

              <nav className="hidden lg:flex items-center gap-2 rounded-full border border-[#DFE3E9] bg-black/[0.035] p-1.5">
                {navLinks.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    className="rounded-full px-4 py-2 text-sm font-medium text-[#4A505A] transition hover:bg-black/[0.06] hover:text-ink"
                  >
                    {link.label}
                  </a>
                ))}
                <Link
                  href="/jobs-public"
                  className="rounded-full bg-black/[0.05] px-4 py-2 text-sm font-semibold text-[#17191E] transition hover:bg-black/[0.06]"
                >
                  Browse Public Jobs
                </Link>
              </nav>

              <div className="hidden md:flex items-center gap-2.5">
                {session?.user ? (
                  <Link
                    href="/dashboard"
                    className="inline-flex items-center gap-1.5 rounded-full bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-[#17191E] shadow-[0_10px_32px_rgba(212,175,55,0.28)] transition hover:bg-[#E8C85C]"
                  >
                    <LayoutDashboard className="h-3.5 w-3.5" />
                    Go to Dashboard
                  </Link>
                ) : (
                  <>
                    <Link className="inline-flex items-center rounded-full border border-[#DFE3E9] bg-black/[0.035] px-4 py-2 text-sm font-medium text-[#3A4048] transition hover:bg-black/[0.05] hover:text-ink" href="/login">
                      Sign In
                    </Link>
                    <Link className="inline-flex items-center gap-1.5 rounded-full bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-[#17191E] shadow-[0_10px_32px_rgba(212,175,55,0.28)] transition hover:bg-[#E8C85C]" href="/register">
                      Start free
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </>
                )}
              </div>

              {/* Mobile menu (no JS, no client component) */}
              <details className="group relative md:hidden">
                <summary className="inline-flex h-10 w-10 list-none items-center justify-center rounded-xl border border-[#DFE3E9] bg-black/[0.035] text-[#17191E] transition hover:bg-black/[0.05] [&::-webkit-details-marker]:hidden">
                  <Menu className="h-5 w-5 group-open:hidden" />
                  <X className="hidden h-5 w-5 group-open:block" />
                  <span className="sr-only">Open menu</span>
                </summary>

                <div className="absolute right-0 top-14 z-30 w-[min(88vw,22rem)] rounded-2xl border border-[#DFE3E9] bg-[#FAFAF7]/95 p-3 shadow-[0_24px_70px_rgba(17,19,24,0.12)] backdrop-blur">
                  <div className="grid gap-2">
                    {navLinks.map((link) => (
                      <a
                        key={link.href}
                        href={link.href}
                        className="inline-flex items-center justify-center rounded-xl border border-[#DFE3E9] bg-black/[0.035] px-4 py-3 text-sm text-[#17191E] transition hover:bg-black/[0.05]"
                      >
                        {link.label}
                      </a>
                    ))}

                    <div className="my-1 h-px bg-black/[0.05]" />

                    <Link
                      href="/jobs-public"
                      className="inline-flex items-center justify-center rounded-xl border border-[#DFE3E9] bg-black/[0.035] px-4 py-3 text-sm text-[#17191E] transition hover:bg-black/[0.05]"
                    >
                      Public Jobs Page
                    </Link>
                    <Link
                      href="/demo"
                      className="inline-flex items-center justify-center rounded-xl border border-[#DFE3E9] bg-black/[0.035] px-4 py-3 text-sm text-[#17191E] transition hover:bg-black/[0.05]"
                    >
                      Watch demo
                    </Link>
                    {session?.user ? (
                      <Link
                        href="/dashboard"
                        className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#D4AF37] px-4 py-3 text-sm font-semibold text-[#17191E] shadow-[0_10px_32px_rgba(212,175,55,0.18)] transition hover:bg-[#E8C85C]"
                      >
                        <LayoutDashboard className="h-4 w-4" />
                        Go to Dashboard
                      </Link>
                    ) : (
                      <>
                        <Link
                          href="/login"
                          className="inline-flex items-center justify-center rounded-xl border border-[#DFE3E9] bg-black/[0.035] px-4 py-3 text-sm text-[#17191E] transition hover:bg-black/[0.05]"
                        >
                          Sign In
                        </Link>
                        <Link
                          href="/register"
                          className="inline-flex items-center justify-center rounded-xl bg-[#D4AF37] px-4 py-3 text-sm font-semibold text-[#17191E] shadow-[0_10px_32px_rgba(212,175,55,0.18)] transition hover:bg-[#E8C85C]"
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
      </header>

      {/* ── Hero content ── */}
      <div className="relative flex flex-1 items-center">
        <div className="shell py-14 lg:py-20">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            {/* Left column */}
            <div className="max-w-xl">
              <p className="hero-l1 inline-flex items-center rounded-full border border-[#DFE3E9] bg-black/[0.035] px-3 py-1.5 text-xs font-semibold tracking-wide text-[#3A4048]">
                A teChia Digital Solutions product
              </p>

              <h1 className="hero-l2 mt-6 text-4xl font-semibold leading-[1.08] tracking-tight text-[#17191E] sm:text-5xl xl:text-6xl">
                The AI-powered operating system for <span className="shimmer-text">your job search.</span>
              </h1>

              <p className="hero-l3 mt-5 text-base leading-7 text-[#4A505A] sm:text-lg">
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
                  <div key={feat} className="flex items-center gap-2 text-sm text-[#4A505A]">
                    <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-[#8A6D1F]" />
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
              <p className="mt-5 text-center text-xs leading-5 text-[#686F7B]">
                Relax and trust the process.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Scroll indicator ── */}
      <div className="relative pb-10 flex justify-center">
        <div className="flex flex-col items-center gap-2 text-[#686F7B]">
          <span className="text-xs tracking-wide">Scroll to explore</span>
          <div className="h-8 w-px bg-gradient-to-b from-transparent via-[#C9CED6]/60 to-transparent animate-pulse" />
        </div>
      </div>
    </section>
  );
}
