'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Network,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import { Logo } from '@/components/shared/logo';

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
      <div className={`absolute -inset-10 rounded-[48px] blur-[60px] opacity-70 ${a.glow}`} aria-hidden />

      <div className={`relative overflow-hidden rounded-[40px] border border-white/12 bg-white/[0.035] shadow-[0_28px_90px_rgba(0,0,0,0.45)] backdrop-blur-2xl ring-1 ${a.ring}`}>
        <div className="flex items-center justify-between gap-4 border-b border-white/10 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05]">
              <Icon className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">{slide.kicker}</p>
              <p className="mt-0.5 text-sm font-semibold text-white">{slide.title}</p>
            </div>
          </div>
          <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold ${a.chip}`}>
            {slide.status ?? 'Now'}
          </span>
        </div>

        <div className="p-6">
          {slide.id === 'scoring' ? (
            <div className="grid gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-xs text-slate-400">Fit score</p>
                  <p className="mt-2 text-4xl font-bold text-white">92</p>
                  <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/10">
                    <div className="h-full w-[78%] rounded-full bg-cyan-300/80" />
                  </div>
                </div>
                <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-xs text-slate-400">Confidence</p>
                  <p className="mt-2 text-4xl font-bold text-white">High</p>
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
              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
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
                { title: 'Follow up — recruiter reply', tag: 'Today', value: 'High' },
                { title: 'Tailor resume — role fit', tag: 'Next', value: 'Medium' },
                { title: 'Schedule screen — prep notes', tag: 'This week', value: 'High' },
              ].map((row) => (
                <div key={row.title} className="flex items-center justify-between gap-4 rounded-3xl border border-white/10 bg-white/[0.03] px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{row.title}</p>
                    <p className="mt-1 text-xs text-slate-400">{row.tag}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="hidden sm:block h-2 w-24 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full w-[70%] rounded-full bg-indigo-300/80" />
                    </div>
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold text-slate-200">
                      {row.value}
                    </span>
                  </div>
                </div>
              ))}
              <div className="mt-2 rounded-3xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-xs text-slate-400">Outcome</p>
                <p className="mt-2 text-sm text-slate-200/90">
                  Your next actions are always obvious: do the highest-impact thing now, then move on.
                </p>
              </div>
            </div>
          ) : slide.id === 'pipeline' ? (
            <div className="grid gap-4">
              <div className="grid grid-cols-4 gap-3">
                {['Saved', 'Applied', 'Interview', 'Offer'].map((stage, i) => (
                  <div key={stage} className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
                    <p className="text-xs font-semibold text-slate-200">{stage}</p>
                    <p className="mt-2 text-2xl font-bold text-white">{[9, 6, 2, 1][i]}</p>
                    <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                      <div className="h-full rounded-full bg-cyan-300/80" style={{ width: `${[72, 56, 24, 12][i]}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
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
          ) : slide.id === 'contacts' ? (
            <div className="grid gap-3">
              {[
                { name: 'Avery — Recruiting', note: 'Met at meetup · follow up' },
                { name: 'Jordan — Eng Manager', note: 'Warm intro · send portfolio' },
                { name: 'Sam — Talent Partner', note: 'Resume submitted · waiting' },
              ].map((c) => (
                <div key={c.name} className="flex items-center justify-between gap-4 rounded-3xl border border-white/10 bg-white/[0.03] px-4 py-3">
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
              <div className="mt-2 rounded-3xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-xs text-slate-400">Always know who to nudge</p>
                <p className="mt-2 text-sm text-slate-200/90">
                  Follow-ups and context stay attached to people — not lost in inboxes.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid gap-4">
              <div className="grid gap-3 rounded-3xl border border-white/10 bg-white/[0.03] p-4">
                {[
                  { title: 'Autopilot follow-ups', desc: 'AI timing + templates, still fully controllable.' },
                  { title: 'Trend & progress analytics', desc: 'See what works across weeks, not days.' },
                  { title: 'Inbox-to-pipeline capture', desc: 'Turn emails into structured steps instantly.' },
                ].map((x) => (
                  <div key={x.title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <p className="text-sm font-semibold text-white">{x.title}</p>
                    <p className="mt-2 text-sm text-slate-300/90">{x.desc}</p>
                  </div>
                ))}
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-xs text-slate-400">Built to stay calm</p>
                <p className="mt-2 text-sm text-slate-200/90">
                  The next wave of features will reduce busywork — without turning your job search into a black box.
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
        kicker: 'Next',
        title: 'What we’re building next',
        description: 'More automation, more signal — while staying transparent, controllable, and calm.',
        bullets: ['Autopilot follow-ups', 'Trend analytics', 'Inbox capture'],
        accent: 'amber',
        status: 'Coming soon',
        icon: CalendarClock,
      },
    ],
    [],
  );

  const [index, setIndex] = useState(0);

  const go = useCallback(
    (nextIndex: number) => {
      const clamped = Math.max(0, Math.min(slides.length - 1, nextIndex));
      setIndex(clamped);
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

  const active = slides[index];
  const a = accentStyles(active.accent);

  return (
    <div className="relative h-screen overflow-hidden">
      {/* background */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute -inset-[40%] hero-beam-pan bg-[conic-gradient(from_140deg,rgba(34,211,238,0.0),rgba(34,211,238,0.22),rgba(167,139,250,0.16),rgba(34,211,238,0.0),rgba(99,102,241,0.16),rgba(34,211,238,0.0))] blur-[70px] opacity-[0.6]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_22%_14%,rgba(34,211,238,0.18),transparent_34%),radial-gradient(circle_at_78%_12%,rgba(99,102,241,0.16),transparent_30%),radial-gradient(circle_at_56%_50%,rgba(16,185,129,0.10),transparent_40%)]" />
        <div className="absolute inset-0 opacity-[0.22] bg-[linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(0deg,rgba(255,255,255,0.06)_1px,transparent_1px)] bg-[size:120px_120px]" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#08111f]" />
      </div>

      {/* top bar */}
      <header className="relative z-20 pt-4">
        <div className="shell">
          <div className="rounded-[28px] border border-white/12 bg-[#08111f]/66 px-4 py-3 shadow-[0_18px_60px_rgba(1,8,20,0.34)] backdrop-blur-2xl sm:px-5">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Link
                  href="/"
                  className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/[0.08] hover:text-white"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Home
                </Link>
                <div className="hidden md:block">
                  <Logo compact href="/" />
                </div>
              </div>

              <div className="hidden md:flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] p-1.5">
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

              <div className="flex items-center gap-2.5">
                <Link
                  href="/jobs-public"
                  className="hidden sm:inline-flex items-center rounded-full border border-white/12 bg-white/[0.04] px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/[0.08] hover:text-white"
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
      <main className="relative z-10 flex h-[calc(100vh-88px)] items-center">
        <div className="shell w-full">
          <div className="grid items-center gap-10 lg:grid-cols-2">
            <div key={active.id} className="demo-enter max-w-xl">
              <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${a.chip}`}>
                <BadgeCheck className="h-3.5 w-3.5" />
                {active.status ?? 'Now'}
              </span>

              <h1 className="mt-5 text-4xl font-bold tracking-tight text-white sm:text-5xl">
                {active.title}
              </h1>
              <p className="mt-5 text-base leading-8 text-slate-300/90 sm:text-lg">
                {active.description}
              </p>

              <div className="mt-7 grid gap-2">
                {active.bullets.map((b) => (
                  <div key={b} className="flex items-start gap-2 text-sm text-slate-200/90">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-cyan-300" />
                    {b}
                  </div>
                ))}
              </div>

              <div className="mt-9 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={prev}
                  disabled={index === 0}
                  className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-5 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-40"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Prev
                </button>
                <button
                  type="button"
                  onClick={next}
                  disabled={index === slides.length - 1}
                  className="inline-flex items-center gap-2 rounded-full bg-cyan-400 px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-[0_10px_32px_rgba(34,211,238,0.28)] transition hover:bg-cyan-300 disabled:opacity-40"
                >
                  Next
                  <ArrowRight className="h-4 w-4" />
                </button>
                <Link
                  href="/login"
                  className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.02] px-5 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-white/[0.08] hover:text-white"
                >
                  <ShieldCheck className="h-4 w-4" />
                  Sign in
                </Link>
              </div>

              <p className="mt-5 text-xs text-slate-500">
                Tip: use ← and → arrow keys to navigate.
              </p>
            </div>

            <div key={`${active.id}-graphic`} className="demo-enter float-soft" style={{ animationDelay: '110ms' }}>
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
