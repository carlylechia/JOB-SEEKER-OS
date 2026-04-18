'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Bot,
  BrainCircuit,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  FileText,
  Network,
  Rocket,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import { Logo } from '@/components/shared/logo';

const AUTO_ADVANCE_MS = 12000;

type Slide = {
  id: string;
  kicker: string;
  title: string;
  description: string;
  bullets: string[];
  accent: 'cyan' | 'indigo' | 'emerald' | 'amber';
  status?: 'Now' | 'Coming soon';
  icon: React.ComponentType<{ className?: string }>;
};

function accentStyles(accent: Slide['accent']) {
  switch (accent) {
    case 'emerald':
      return {
        chip: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200',
        glow: 'bg-emerald-400/20',
        ring: 'ring-emerald-400/20',
        dot: 'bg-emerald-300',
      };
    case 'amber':
      return {
        chip: 'border-amber-300/25 bg-amber-300/10 text-amber-100',
        glow: 'bg-amber-300/18',
        ring: 'ring-amber-300/20',
        dot: 'bg-amber-200',
      };
    case 'indigo':
      return {
        chip: 'border-indigo-300/25 bg-indigo-300/10 text-indigo-100',
        glow: 'bg-indigo-400/18',
        ring: 'ring-indigo-300/20',
        dot: 'bg-indigo-200',
      };
    case 'cyan':
    default:
      return {
        chip: 'border-cyan-300/25 bg-cyan-300/10 text-cyan-100',
        glow: 'bg-cyan-400/18',
        ring: 'ring-cyan-300/20',
        dot: 'bg-cyan-200',
      };
  }
}

function SlideGraphic({ slide }: { slide: Slide }) {
  const a = accentStyles(slide.accent);
  const Icon = slide.icon;

  return (
    <div className="relative mx-auto w-full max-w-[560px]">
      <div className={`absolute -inset-8 rounded-[40px] blur-[56px] opacity-80 sm:-inset-14 sm:rounded-[56px] sm:blur-[76px] ${a.glow}`} aria-hidden />
      <div className="absolute inset-x-[10%] -top-6 h-16 rounded-full bg-white/8 blur-3xl sm:-top-10 sm:h-24" aria-hidden />

      <div className={`relative overflow-hidden rounded-[28px] border border-white/14 bg-[linear-gradient(180deg,rgba(255,255,255,0.09),rgba(255,255,255,0.03))] shadow-[0_24px_80px_rgba(0,0,0,0.52)] backdrop-blur-2xl ring-1 sm:rounded-[40px] sm:shadow-[0_32px_110px_rgba(0,0,0,0.58)] ${a.ring}`}>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.14),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.06),transparent_30%)]" />
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:gap-4 sm:px-6 sm:py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] sm:h-10 sm:w-10">
              <Icon className="h-4 w-4 text-white sm:h-5 sm:w-5" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">{slide.kicker}</p>
              <p className="mt-0.5 line-clamp-2 text-sm font-semibold text-white">{slide.title}</p>
            </div>
          </div>
          <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold sm:px-3 sm:text-[11px] ${a.chip}`}>
            {slide.status ?? 'Now'}
          </span>
        </div>

        <div className="p-4 sm:p-6">
          {slide.id === 'scoring' ? (
            <div className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-3xl border border-white/10 bg-white/[0.05] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                  <p className="text-xs text-slate-400">Fit score</p>
                  <p className="mt-2 text-3xl font-bold text-white sm:text-4xl">92</p>
                  <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/10">
                    <div className="h-full w-[78%] rounded-full bg-cyan-300/80" />
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                    {[
                      ['Stack', '96'],
                      ['Remote', '100'],
                      ['Comp', '85'],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-2xl border border-white/8 bg-black/20 px-2 py-2">
                        <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{label}</p>
                        <p className="mt-1 text-sm font-semibold text-white">{value}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-3xl border border-white/10 bg-white/[0.05] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                  <p className="text-xs text-slate-400">Confidence</p>
                  <p className="mt-2 text-3xl font-bold text-white sm:text-4xl">High</p>
                  <div className="mt-3 grid gap-2">
                    {['Skills match', 'Scope alignment', 'Seniority'].map((label) => (
                      <div key={label} className="flex items-center justify-between gap-3">
                        <span className="text-xs text-slate-300">{label}</span>
                        <span className="text-xs text-slate-400">✓</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/[0.05] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                <p className="text-xs text-slate-400">Why this match is strong</p>
                <div className="mt-3 grid gap-2">
                  {['Role aligns with your recent projects', 'Requirements match your core stack', 'High signal description + clear outcomes'].map((x) => (
                    <div key={x} className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 text-cyan-300" />
                      <p className="text-sm text-slate-200/90">{x}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : slide.id === 'queue' ? (
            <div className="grid gap-3">
              {[
                { title: 'Follow up — recruiter reply', tag: 'Today', value: 'High', tone: 'bg-rose-400/70' },
                { title: 'Tailor resume — role fit', tag: 'Next', value: 'Medium', tone: 'bg-cyan-300/70' },
                { title: 'Schedule screen — prep notes', tag: 'This week', value: 'High', tone: 'bg-indigo-300/70' },
              ].map((row) => (
                <div key={row.title} className="flex flex-col gap-3 rounded-3xl border border-white/10 bg-white/[0.05] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full ${row.tone}`} />
                      <p className="truncate text-sm font-semibold text-white">{row.title}</p>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">{row.tag}</p>
                  </div>
                  <div className="flex items-center justify-between gap-3 sm:justify-start">
                    <div className="h-2 w-full max-w-24 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full w-[70%] rounded-full bg-indigo-300/80" />
                    </div>
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold text-slate-200">
                      {row.value}
                    </span>
                  </div>
                </div>
              ))}
              <div className="mt-2 rounded-3xl border border-white/10 bg-white/[0.05] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                <p className="text-xs text-slate-400">Outcome</p>
                <p className="mt-2 text-sm text-slate-200/90">
                  Your next actions are always obvious: do the highest-impact thing now, then move on.
                </p>
              </div>
            </div>
          ) : slide.id === 'pipeline' ? (
            <div className="grid gap-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {['Saved', 'Applied', 'Interview', 'Offer'].map((stage, i) => (
                  <div key={stage} className="rounded-3xl border border-white/10 bg-white/[0.05] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                    <p className="text-xs font-semibold text-slate-200">{stage}</p>
                    <p className="mt-2 text-2xl font-bold text-white">{[9, 6, 2, 1][i]}</p>
                    <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                      <div className="h-full rounded-full bg-cyan-300/80" style={{ width: `${[72, 56, 24, 12][i]}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/[0.05] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                <p className="text-xs text-slate-400">One timeline across everything</p>
                <div className="mt-3 grid gap-2">
                  {['Applied · Mon 9:18am', 'Recruiter reply · Tue 2:10pm', 'Interview scheduled · Thu 11:30am'].map((x) => (
                    <div key={x} className="flex items-center gap-3">
                      <span className={`h-2 w-2 rounded-full ${a.dot}`} />
                      <p className="text-sm text-slate-200/90">{x}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : slide.id === 'onboarding' ? (
            <div className="grid gap-4">
              <div className="grid gap-3 sm:grid-cols-[1.1fr_0.9fr]">
                <div className="rounded-3xl border border-white/10 bg-white/[0.05] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                  <p className="text-xs text-slate-400">Guided setup</p>
                  <div className="mt-3 space-y-2.5">
                    {[
                      'Basic info + account identity',
                      'Profile photo + resume upload',
                      'Location, timezone, remote preference',
                      'Titles, skills, salary, target level',
                    ].map((step, idx) => (
                      <div key={step} className="flex items-center gap-3 rounded-2xl border border-white/8 bg-black/20 px-3 py-2.5">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full border border-cyan-300/20 bg-cyan-300/10 text-xs font-bold text-cyan-100">
                          {idx + 1}
                        </div>
                        <p className="text-sm text-slate-200/90">{step}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-3xl border border-white/10 bg-white/[0.05] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                  <p className="text-xs text-slate-400">What happens automatically</p>
                  <div className="mt-4 space-y-3">
                    {[
                      ['Resume parsed', 'Titles, links, and stack detected'],
                      ['Progress saved', 'Users can leave and resume later'],
                      ['Workspace ready', 'Queue and scoring adapt to the profile'],
                    ].map(([title, desc]) => (
                      <div key={title} className="rounded-2xl border border-white/8 bg-black/20 p-3">
                        <p className="text-sm font-semibold text-white">{title}</p>
                        <p className="mt-1 text-xs leading-5 text-slate-400">{desc}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : slide.id === 'contacts' ? (
            <div className="grid gap-3">
              {[
                { name: 'Avery — Recruiting', note: 'Met at meetup · follow up' },
                { name: 'Jordan — Eng Manager', note: 'Warm intro · send portfolio' },
                { name: 'Sam — Talent Partner', note: 'Resume submitted · waiting' },
              ].map((c) => (
                <div key={c.name} className="flex flex-col gap-3 rounded-3xl border border-white/10 bg-white/[0.05] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] text-sm font-bold text-white">
                      {c.name[0]}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">{c.name}</p>
                      <p className="mt-1 truncate text-xs text-slate-400">{c.note}</p>
                    </div>
                  </div>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold text-slate-200">
                    Next
                  </span>
                </div>
              ))}
              <div className="mt-2 rounded-3xl border border-white/10 bg-white/[0.05] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                <p className="text-xs text-slate-400">Always know who to nudge</p>
                <p className="mt-2 text-sm text-slate-200/90">
                  Follow-ups and context stay attached to people — not lost in inboxes.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid gap-4">
              <div className="grid gap-3 rounded-3xl border border-white/10 bg-white/[0.05] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                {[
                  { title: 'Smart resume builder', desc: 'Generate and refine role-specific resumes from your tracked experience and target role.' },
                  { title: 'AI job fetching', desc: 'Continuously pull, filter, and score fresh roles that match your preferences before you go looking.' },
                  { title: 'Auto-apply + suggestions', desc: 'AI-assisted application drafting, workflow suggestions, and deeper daily decision support.' },
                ].map((x) => (
                  <div key={x.title} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <p className="text-sm font-semibold text-white">{x.title}</p>
                    <p className="mt-2 text-sm text-slate-300/90">{x.desc}</p>
                  </div>
                ))}
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/[0.05] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                <p className="text-xs text-slate-400">Next releases</p>
                <p className="mt-2 text-sm text-slate-200/90">
                  The next wave is intentionally AI-heavy: stronger resume generation, proactive job discovery, AI auto-apply assistance,
                  and smart suggestions that reduce busywork without hiding the workflow.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function DemoSlideshow() {
  const slides: Slide[] = useMemo(
    () => [
      {
        id: 'scoring',
        kicker: 'Core feature',
        title: 'AI fit scoring you can trust',
        description: 'Understand exactly why a role is a match — and what to do next to increase your odds.',
        bullets: ['Explainable scoring', 'Strengths + gaps', 'Actionable next steps'],
        accent: 'cyan',
        status: 'Now',
        icon: Sparkles,
      },
      {
        id: 'queue',
        kicker: 'Daily execution',
        title: 'A smart queue that keeps you moving',
        description: 'Your best next action, ranked by impact. No more guessing what matters today.',
        bullets: ['Fit + urgency ranking', 'Follow-up reminders', 'Clear outcomes'],
        accent: 'indigo',
        status: 'Now',
        icon: ClipboardList,
      },
      {
        id: 'pipeline',
        kicker: 'Clarity',
        title: 'Pipeline tracking, end-to-end',
        description: 'Every stage visible. Every step captured. Your job search stops feeling chaotic.',
        bullets: ['Stages + timelines', 'Notes and artifacts', 'Fast status updates'],
        accent: 'emerald',
        status: 'Now',
        icon: Network,
      },
      {
        id: 'onboarding',
        kicker: 'Setup flow',
        title: 'Onboarding that builds the workspace for you',
        description: 'Users can upload a resume, set fit preferences, save progress between sessions, and land in a workspace that already knows what to prioritize.',
        bullets: ['Resume parsing', 'Autosaved setup steps', 'Profile-aware queue and scoring'],
        accent: 'emerald',
        status: 'Now',
        icon: Rocket,
      },
      {
        id: 'contacts',
        kicker: 'Relationships',
        title: 'Contact CRM with real context',
        description: 'Treat relationships like first-class objects — with follow-ups that don’t slip.',
        bullets: ['People + history', 'Follow-up cadence', 'Attachments and notes'],
        accent: 'cyan',
        status: 'Now',
        icon: Users,
      },
      {
        id: 'coming',
        kicker: 'AI roadmap',
        title: 'The next releases get far more AI-intensive',
        description: 'We’re pushing beyond tracking into real AI assistance: smarter resumes, proactive job fetching, auto-apply support, and suggestion engines that help users move faster.',
        bullets: ['Smart resume building', 'AI job fetching', 'Auto-apply and AI suggestions'],
        accent: 'amber',
        status: 'Coming soon',
        icon: BrainCircuit,
      },
    ],
    [],
  );

  const [index, setIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [progressActive, setProgressActive] = useState(false);

  const go = useCallback(
    (nextIndex: number) => {
      const total = slides.length;
      const wrapped = ((nextIndex % total) + total) % total;
      setIndex(wrapped);
    },
    [slides.length],
  );

  const next = useCallback(() => go(index + 1), [go, index]);
  const prev = useCallback(() => go(index - 1), [go, index]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        next();
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        prev();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [next, prev]);

  useEffect(() => {
    if (isPaused) return;

    const timer = window.setTimeout(() => {
      setIndex((current) => (current + 1) % slides.length);
    }, AUTO_ADVANCE_MS);

    return () => window.clearTimeout(timer);
  }, [index, isPaused, slides.length]);

  useEffect(() => {
    setProgressActive(false);
    if (isPaused) return;

    const frame = window.requestAnimationFrame(() => {
      setProgressActive(true);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [index, isPaused]);

  const active = slides[index];
  const a = accentStyles(active.accent);

  return (
    <div className="relative min-h-[100svh] overflow-x-hidden overscroll-none lg:h-screen lg:overflow-hidden">
      {/* background */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="absolute inset-0 bg-[#040812]" />
        <div className="absolute -inset-[40%] hero-beam-pan bg-[conic-gradient(from_140deg,rgba(34,211,238,0.0),rgba(34,211,238,0.16),rgba(59,130,246,0.14),rgba(34,211,238,0.0),rgba(99,102,241,0.18),rgba(34,211,238,0.0))] blur-[86px] opacity-[0.55]" />
        <div className="absolute left-[8%] top-[12%] h-64 w-64 rounded-full bg-cyan-400/10 blur-[110px] animate-pulse" />
        <div className="absolute right-[10%] top-[18%] h-72 w-72 rounded-full bg-indigo-500/12 blur-[120px] animate-pulse" />
        <div className="absolute bottom-[8%] left-[34%] h-64 w-64 rounded-full bg-emerald-400/8 blur-[110px] animate-pulse" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(34,211,238,0.14),transparent_28%),radial-gradient(circle_at_82%_14%,rgba(99,102,241,0.16),transparent_28%),radial-gradient(circle_at_50%_62%,rgba(16,185,129,0.10),transparent_34%)]" />
        <div className="absolute inset-0 opacity-[0.12] bg-[linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(0deg,rgba(255,255,255,0.06)_1px,transparent_1px)] bg-[size:110px_110px]" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,6,12,0.15),rgba(2,6,12,0.48),rgba(2,6,12,0.92))]" />
      </div>

      {/* top bar */}
      <header className="relative z-20 px-3 pt-3 sm:px-0 sm:pt-4">
        <div className="shell">
          <div className="rounded-[24px] border border-white/12 bg-[#08111f]/66 px-3 py-3 shadow-[0_18px_60px_rgba(1,8,20,0.34)] backdrop-blur-2xl sm:rounded-[28px] sm:px-5">
            <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4">
              <div className="flex items-center gap-3">
                <Link
                  href="/"
                  className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/[0.08] hover:text-white sm:px-4"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Home
                </Link>
                <div className="hidden sm:block md:block">
                  <Logo compact href="/" />
                </div>
              </div>

              <div className="order-3 flex w-full items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.04] p-1.5 sm:order-none sm:w-auto md:flex">
                {slides.map((s, i) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => go(i)}
                    aria-label={`Go to slide ${i + 1}: ${s.title}`}
                    className={`h-2.5 w-2.5 rounded-full transition ${i === index ? a.dot : 'bg-white/20 hover:bg-white/35'}`}
                  />
                ))}
              </div>

              <div className="flex items-center gap-2">
                <Link
                  href="/jobs-public"
                  className="hidden md:inline-flex items-center rounded-full border border-white/12 bg-white/[0.04] px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/[0.08] hover:text-white"
                >
                  Browse public jobs
                </Link>
                <Link
                  href="/register"
                  className="inline-flex items-center gap-2 rounded-full bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 shadow-[0_10px_32px_rgba(34,211,238,0.28)] transition hover:bg-cyan-300"
                >
                  Start free
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* content */}
      <main
        className="relative z-10 flex min-h-[calc(100svh-88px)] items-start py-6 sm:py-8 lg:h-[calc(100vh-88px)] lg:min-h-0 lg:items-center lg:py-0"
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
        onFocusCapture={() => setIsPaused(true)}
        onBlurCapture={() => setIsPaused(false)}
      >
        <div className="shell w-full">
          <div className="grid items-start gap-8 pb-8 lg:grid-cols-2 lg:items-center lg:gap-10 lg:pb-0">
            <div key={active.id} className="demo-enter max-w-xl px-1 sm:px-0">
              <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${a.chip}`}>
                <BadgeCheck className="h-3.5 w-3.5" />
                {active.status ?? 'Now'}
              </span>

              <h1 className="mt-4 text-3xl font-bold tracking-tight text-white sm:mt-5 sm:text-5xl">
                {active.title}
              </h1>
              <p className="mt-4 text-sm leading-7 text-slate-300/90 sm:mt-5 sm:text-lg sm:leading-8">
                {active.description}
              </p>

              <div className="mt-6 grid gap-2 sm:mt-7">
                {active.bullets.map((b) => (
                  <div key={b} className="flex items-start gap-2 text-sm text-slate-200/90">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-cyan-300" />
                    {b}
                  </div>
                ))}
              </div>

              <div className="mt-8 flex flex-col gap-3 sm:mt-9 sm:flex-row sm:flex-wrap">
                <button
                  type="button"
                  onClick={prev}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-5 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-white/[0.08] hover:text-white sm:w-auto"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Prev
                </button>
                <button
                  type="button"
                  onClick={next}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-cyan-400 px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-[0_10px_32px_rgba(34,211,238,0.28)] transition hover:bg-cyan-300 sm:w-auto"
                >
                  Next
                  <ArrowRight className="h-4 w-4" />
                </button>
                <Link
                  href="/login"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-white/12 bg-white/[0.02] px-5 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-white/[0.08] hover:text-white sm:w-auto"
                >
                  <ShieldCheck className="h-4 w-4" />
                  Sign in
                </Link>
              </div>

              <div className="mt-6 max-w-sm rounded-2xl border border-white/10 bg-white/[0.035] p-4 backdrop-blur-xl">
                <div className="flex items-center justify-between gap-4 text-xs text-slate-400">
                  <span className="inline-flex items-center gap-2">
                    <Bot className="h-3.5 w-3.5 text-cyan-300" />
                    {isPaused ? 'Autoplay paused' : `Autoplay every ${AUTO_ADVANCE_MS / 1000}s`}
                  </span>
                  <span>{index + 1} / {slides.length}</span>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div
                    key={`${active.id}-${isPaused ? 'paused' : 'running'}`}
                    className={`h-full rounded-full ${a.dot}`}
                    style={{
                      width: isPaused ? '38%' : progressActive ? '100%' : '0%',
                      transition: isPaused ? 'none' : `width ${AUTO_ADVANCE_MS}ms linear`,
                    }}
                  />
                </div>
              </div>

              <p className="mt-4 text-xs leading-5 text-slate-500">
                Tip: use ← and → to navigate, or hover to pause the auto tour.
              </p>
            </div>

            <div key={`${active.id}-graphic`} className="demo-enter float-soft px-1 sm:px-0" style={{ animationDelay: '110ms' }}>
              <SlideGraphic slide={active} />
            </div>
          </div>
        </div>
      </main>

      {/* bottom progress */}
      <div className="pointer-events-none absolute bottom-6 left-0 right-0 z-10 hidden justify-center md:flex" aria-hidden>
        <div className="rounded-full border border-white/10 bg-[#08111f]/70 px-4 py-2 text-xs text-slate-400 backdrop-blur-xl">
          {index + 1} / {slides.length}
        </div>
      </div>
    </div>
  );
}
