'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, Sparkles, Briefcase, Users, TrendingUp, Zap } from 'lucide-react';
import { Logo } from '@/components/shared/logo';
import { JobSeekerHeroVideo } from '@/components/marketing/job-seeker-hero-video';
import { LandingMobileMenu } from '@/components/marketing/landing-mobile-menu';

const navLinks = [
  { href: '#features', label: 'Features' },
  { href: '#how-it-works', label: 'How It Works' },
  { href: '#public-jobs', label: 'Public Jobs' },
  { href: '#faq', label: 'FAQ' },
];

const queueItems = [
  { company: 'Stripe', role: 'Senior Engineer', score: 94, tier: 'Strong Fit', color: 'text-emerald-400', bar: 'bg-emerald-400' },
  { company: 'Linear', role: 'Product Engineer', score: 87, tier: 'Good Fit', color: 'text-cyan-400', bar: 'bg-cyan-400' },
  { company: 'Vercel', role: 'DX Engineer', score: 82, tier: 'Good Fit', color: 'text-cyan-400', bar: 'bg-cyan-400' },
  { company: 'Notion', role: 'Frontend Engineer', score: 71, tier: 'Moderate', color: 'text-amber-400', bar: 'bg-amber-400' },
];

const statsRow = [
  { icon: Briefcase, label: 'Applied', value: '12' },
  { icon: Users, label: 'Contacts', value: '8' },
  { icon: TrendingUp, label: 'Streak', value: '7d' },
];

export function LandingHero() {
  const [activeSection, setActiveSection] = useState<string>(navLinks[0].href);

  useEffect(() => {
    const sectionIds = navLinks.map((link) => link.href.replace('#', ''));

    function updateActiveSection() {
      const scrollAnchor = window.scrollY + 180;
      let currentSection = navLinks[0].href;

      for (const link of navLinks) {
        const section = document.getElementById(link.href.replace('#', ''));
        if (!section) continue;

        if (section.offsetTop <= scrollAnchor) {
          currentSection = link.href;
        }
      }

      const pageBottom = window.scrollY + window.innerHeight;
      const docHeight = document.documentElement.scrollHeight;
      if (docHeight - pageBottom < 120) {
        currentSection = navLinks[navLinks.length - 1].href;
      }

      setActiveSection(currentSection);
    }

    updateActiveSection();
    window.addEventListener('scroll', updateActiveSection, { passive: true });
    window.addEventListener('resize', updateActiveSection);

    for (const id of sectionIds) {
      const section = document.getElementById(id);
      if (section) {
        section.style.scrollMarginTop = '140px';
      }
    }

    return () => {
      window.removeEventListener('scroll', updateActiveSection);
      window.removeEventListener('resize', updateActiveSection);
    };
  }, []);

  return (
    <section id="top" className="relative min-h-screen flex flex-col overflow-hidden">
      {/* ── Animated background ── */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="absolute inset-0 opacity-[0.78]">
          <JobSeekerHeroVideo />
        </div>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(251,191,36,0.18),transparent_28%),radial-gradient(circle_at_78%_16%,rgba(249,115,22,0.14),transparent_22%),linear-gradient(180deg,rgba(8,17,31,0.16)_0%,rgba(8,17,31,0.52)_40%,rgba(8,17,31,0.95)_100%)]" />
        {/* orbs */}
        <div className="orb-drift-1 absolute -top-32 -right-24 h-[640px] w-[640px] rounded-full bg-amber-300/[0.18] blur-[115px]" />
        <div className="orb-drift-2 absolute top-1/2 -left-48 h-[520px] w-[520px] rounded-full bg-orange-400/[0.12] blur-[108px]" />
        <div className="orb-drift-3 absolute bottom-0 right-1/4 h-[420px] w-[420px] rounded-full bg-sky-300/[0.1] blur-[92px]" />
        {/* subtle dot grid */}
        <div
          className="absolute inset-0 opacity-35"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(99,179,237,0.07) 1px, transparent 1px)',
            backgroundSize: '36px 36px',
          }}
        />
        {/* vignette */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_28%,rgba(8,17,31,0.24)_62%,rgba(8,17,31,0.72)_100%)]" />
      </div>

      {/* ── Sticky nav ── */}
      <header className="sticky top-0 z-30 pt-4">
        <div className="shell">
          <div className="rounded-[28px] border border-white/12 bg-[#08111f]/66 px-4 py-3 shadow-[0_18px_60px_rgba(1,8,20,0.34)] backdrop-blur-2xl sm:px-5">
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-4">
                <Logo compact href="/" />
              </div>

              <nav className="hidden lg:flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] p-1.5">
                {navLinks.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    aria-current={activeSection === link.href ? 'page' : undefined}
                    className={`rounded-full px-4 py-2 text-sm font-medium transition-all ${
                      activeSection === link.href
                        ? 'bg-gradient-to-r from-amber-300/20 to-orange-300/18 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_10px_30px_rgba(251,191,36,0.12)]'
                        : 'text-slate-300 hover:bg-white/8 hover:text-white'
                    }`}
                  >
                    {link.label}
                  </a>
                ))}
                <Link
                  href="/jobs-public"
                  className="rounded-full bg-white/[0.06] px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-white/[0.12]"
                >
                  Browse Public Jobs
                </Link>
              </nav>

              <div className="hidden md:flex items-center gap-2.5">
                <Link className="inline-flex items-center rounded-full border border-white/12 bg-white/[0.04] px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/[0.08] hover:text-white" href="/login">
                  Sign In
                </Link>
                <Link className="inline-flex items-center gap-1.5 rounded-full bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 shadow-[0_10px_32px_rgba(34,211,238,0.28)] transition hover:bg-cyan-300" href="/register">
                  Start free
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>

              <LandingMobileMenu />
            </div>
          </div>
        </div>
      </header>

      {/* ── Hero content ── */}
      <div className="relative flex flex-1 items-center shell py-16 lg:py-20">
        <div className="grid w-full gap-12 lg:grid-cols-2 lg:items-center">

          {/* Left column */}
          <div>
            <span className="hero-l1 inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-300">
              <Sparkles className="h-3 w-3" />
              AI-powered job search OS
            </span>

            <h1 className="hero-l2 mt-6 text-4xl font-bold leading-[1.07] tracking-tight text-white sm:text-5xl xl:text-[3.6rem]">
              Your entire job search.{' '}
              <span className="relative inline-block">
                <span className="shimmer-text">One command center.</span>
              </span>
            </h1>

            <p className="hero-l3 mt-6 max-w-xl text-base leading-8 text-slate-300/90 sm:text-lg">
              Replace scattered tabs, notes, and reminders with an intelligent workspace that scores, prioritizes, and
              guides your applications — so you focus on the right opportunities at the right time.
            </p>

            <div className="hero-l4 mt-8 flex flex-wrap gap-3">
              <Link href="/register" className="btn-primary gap-2 px-5 py-2.5 text-[0.9rem] shadow-lg shadow-accent/25">
                Create free workspace <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/demo" className="btn-secondary px-5 py-2.5 text-[0.9rem]">
                Watch demo
              </Link>
            </div>

            <div className="hero-l5 mt-8 flex flex-wrap gap-x-6 gap-y-3">
              {['AI fit scoring', 'Smart daily queue', 'Pipeline tracking', 'Interview prep'].map((feat) => (
                <div key={feat} className="flex items-center gap-2 text-sm text-slate-300">
                  <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-cyan-400" />
                  {feat}
                </div>
              ))}
            </div>
          </div>

          {/* Right column — mock dashboard card */}
          <div className="hero-r1 relative hidden lg:block">
            <div className="relative mx-auto h-[540px] w-full max-w-[620px]">
              {/* Main frosted glass card */}
              <div className="absolute inset-x-6 inset-y-6 rounded-3xl border border-white/[0.12] bg-white/[0.04] p-6 backdrop-blur-2xl shadow-[0_24px_80px_rgba(0,0,0,0.4)]">
                {/* Header row */}
                <div className="mb-5 flex items-center justify-between">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-400">Today&apos;s Queue</div>
                    <div className="mt-0.5 text-xs text-slate-400">4 jobs need attention</div>
                  </div>
                  <div className="flex items-center gap-1.5 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-[10px] font-semibold text-cyan-300">
                    <Zap className="h-3 w-3" /> AI Ranked
                  </div>
                </div>

                {/* Job rows */}
                <div className="space-y-2.5">
                  {queueItems.map((item, i) => (
                    <div
                      key={i}
                      className="group flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.04] px-4 py-3 transition-colors hover:border-white/[0.14] hover:bg-white/[0.07]"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.07] text-xs font-bold text-slate-300">
                          {item.company[0]}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-white">{item.company}</p>
                          <p className="text-[11px] text-slate-400">{item.role}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="hidden w-16 sm:block">
                          <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
                            <div className={`h-full rounded-full ${item.bar}`} style={{ width: `${item.score}%` }} />
                          </div>
                        </div>
                        <div className="text-right">
                          <span className={`text-sm font-bold ${item.color}`}>{item.score}</span>
                          <p className={`text-[10px] ${item.color} opacity-75`}>{item.tier}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Stats row */}
                <div className="mt-5 grid grid-cols-3 gap-3">
                  {statsRow.map(({ icon: Icon, label, value }) => (
                    <div key={label} className="rounded-xl border border-white/[0.07] bg-white/[0.04] p-3 text-center">
                      <Icon className="mx-auto mb-1.5 h-4 w-4 text-cyan-400" />
                      <p className="text-base font-bold text-white">{value}</p>
                      <p className="text-[10px] text-slate-400">{label}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Floating badge — top right */}
              <div className="float-soft absolute right-2 top-3 rounded-2xl border border-cyan-500/25 bg-[#08111f]/95 px-3 py-2.5 shadow-xl shadow-cyan-500/10 backdrop-blur">
                <p className="text-[10px] font-semibold text-cyan-300">AI Score</p>
                <p className="text-xl font-bold text-white">94<span className="text-sm text-slate-400">/100</span></p>
              </div>

              {/* Floating badge — bottom left */}
              <div className="float-soft-delayed absolute bottom-4 left-2 rounded-2xl border border-emerald-500/25 bg-[#08111f]/95 px-3 py-2.5 shadow-xl shadow-emerald-500/10 backdrop-blur">
                <p className="text-[10px] font-semibold text-emerald-400">Applications</p>
                <p className="text-xl font-bold text-white">+3 <span className="text-sm text-slate-400">today</span></p>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* ── Scroll indicator ── */}
      <div className="relative pb-10 flex justify-center">
        <div className="flex flex-col items-center gap-2 text-slate-500">
          <span className="text-xs tracking-wide">Scroll to explore</span>
          <div className="h-8 w-px bg-gradient-to-b from-transparent via-slate-500/60 to-transparent animate-pulse" />
        </div>
      </div>
    </section>
  );
}
