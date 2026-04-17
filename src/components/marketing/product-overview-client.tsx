'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  LayoutDashboard, Star, ListChecks, GitBranch,
  Users, BookOpen, BellRing, BarChart2, Zap,
  ArrowRight, CheckCircle2, ChevronDown, Flame,
  Clock, Upload, Target, TrendingUp, Shield,
  Cpu, Calendar,
} from 'lucide-react';

/* ── Shared reveal hook ─────────────────────────────────────────────── */
function useReveal(threshold = 0.1) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold, rootMargin: '0px 0px -40px 0px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, visible };
}

/* ── Feature sections data ──────────────────────────────────────────── */
const sections = [
  {
    id: 'dashboard',
    badge: 'Command center',
    badgeColor: 'border-cyan-500/25 bg-cyan-500/[0.08] text-cyan-300',
    icon: LayoutDashboard,
    iconColor: 'text-cyan-400',
    heading: 'Your entire search at a glance.',
    body: 'The dashboard shows exactly where your search stands: streak, today\'s priorities, top-ranked leads, upcoming follow-ups, and pipeline health — all in one view. No hunting through multiple tabs.',
    bullets: [
      'Daily queue ranked by AI fit score + application stage',
      'Application streak tracking with milestone alerts',
      'KPI cards for totals, response rates, and activity',
      'Upcoming interviews and follow-up deadlines surface automatically',
    ],
    mock: <DashboardMock />,
    flip: false,
  },
  {
    id: 'scoring',
    badge: 'AI Fit Scoring',
    badgeColor: 'border-amber-500/25 bg-amber-500/[0.08] text-amber-300',
    icon: Star,
    iconColor: 'text-amber-400',
    heading: 'Know which jobs deserve your energy.',
    body: 'Every lead gets a composite fit score calculated from your personal preference profile — tech stack overlap, seniority alignment, location match, remote tolerance, and compensation band. Re-score anytime your priorities shift.',
    bullets: [
      'Core stack match (0–100) based on your target technologies',
      'Seniority + location + remote + compensation sub-scores',
      'Composite priority flag: Strong Fit, Good Fit, Moderate, Stretch',
      'Re-score any job on demand after preference changes',
    ],
    mock: <ScoringMock />,
    flip: true,
  },
  {
    id: 'pipeline',
    badge: 'Application Pipeline',
    badgeColor: 'border-indigo-500/25 bg-indigo-500/[0.08] text-indigo-300',
    icon: GitBranch,
    iconColor: 'text-indigo-400',
    heading: 'Move leads through every stage with clarity.',
    body: 'A drag-and-drop Kanban board tracks every application from first save to signed offer. See your full pipeline at a glance and never lose track of where a job stands.',
    bullets: [
      'Stages: Saved → Applied → Phone Screen → Interview → Offer → Rejected',
      'Drag-and-drop between columns with instant DB sync',
      'Per-card at-a-glance view: company, role, score, last activity',
      'Filter by fit tier, date added, or current stage',
    ],
    mock: <PipelineMock />,
    flip: false,
  },
  {
    id: 'queue',
    badge: 'Daily Queue',
    badgeColor: 'border-emerald-500/25 bg-emerald-500/[0.08] text-emerald-300',
    icon: ListChecks,
    iconColor: 'text-emerald-400',
    heading: 'Every morning, know exactly what to do.',
    body: 'The smart queue engine surfaces your most important actions each day — ranked by fit score, application stage, and time sensitivity. It eliminates decision fatigue so you can execute instead of plan.',
    bullets: [
      'AI-ranked list of jobs needing immediate attention',
      'Surfaces follow-up-due, stale, and high-priority leads automatically',
      'Mark complete, snooze, or move to pipeline from the queue',
      'Queue resets daily based on live application state',
    ],
    mock: <QueueMock />,
    flip: true,
  },
  {
    id: 'crm',
    badge: 'Recruiter CRM',
    badgeColor: 'border-violet-500/25 bg-violet-500/[0.08] text-violet-300',
    icon: Users,
    iconColor: 'text-violet-400',
    heading: 'Never let a warm contact go cold.',
    body: 'Each job lead has a full contact ledger. Log every recruiter, hiring manager, and referral, track outreach history, and set follow-up reminders directly tied to the role — not buried in a separate tool.',
    bullets: [
      'Contacts attached directly to each job lead',
      'Log name, title, LinkedIn, email, phone',
      'Track outreach history and last-contact date',
      'Follow-up reminder integrates with daily queue',
    ],
    mock: <CrmMock />,
    flip: false,
  },
  {
    id: 'prep',
    badge: 'Interview Prep',
    badgeColor: 'border-sky-500/25 bg-sky-500/[0.08] text-sky-300',
    icon: BookOpen,
    iconColor: 'text-sky-400',
    heading: 'Walk in prepared. Every time.',
    body: 'Attach structured prep packs to any job. Store role-specific questions, company research, talking points, and preparation checklists — all organized per application so you always know where to find them.',
    bullets: [
      'Per-job prep notes and question banks',
      'Checklist items with completion tracking',
      'Reusable templates for common interview formats',
      'Notes surface on the job detail page before the interview',
    ],
    mock: <PrepMock />,
    flip: true,
  },
];

/* ── Individual mock UI components ─────────────────────────────────── */

function DashboardMock() {
  return (
    <MockShell title="dashboard">
      <div className="grid grid-cols-4 gap-2 mb-4">
        {[['29', 'Total Leads'], ['8', 'Applied'], ['7d 🔥', 'Streak'], ['81', 'Avg Score']].map(([v, l]) => (
          <div key={l} className="rounded-xl border border-white/[0.07] bg-white/[0.04] p-2.5 text-center">
            <p className="text-base font-bold text-white">{v}</p>
            <p className="text-[9px] text-slate-500 mt-0.5">{l}</p>
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-3 mb-3">
        <p className="text-[10px] font-semibold text-cyan-400 uppercase tracking-widest mb-2">Today&apos;s Top Priorities</p>
        {[
          { co: 'Stripe', role: 'Sr. Engineer', score: 94, color: 'bg-emerald-400' },
          { co: 'Linear', role: 'Product Eng.', score: 87, color: 'bg-cyan-400' },
          { co: 'Vercel', role: 'DX Engineer', score: 82, color: 'bg-cyan-400' },
        ].map((r) => (
          <div key={r.co} className="flex items-center justify-between py-1.5">
            <div className="flex items-center gap-2">
              <div className="h-5 w-5 rounded-md bg-white/[0.08] text-[9px] font-bold text-slate-300 flex items-center justify-center">{r.co[0]}</div>
              <span className="text-[11px] text-slate-200">{r.co}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-12 h-1 rounded-full bg-white/10 overflow-hidden"><div className={`h-full ${r.color}`} style={{ width: `${r.score}%` }} /></div>
              <span className="text-[11px] font-bold text-white">{r.score}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-3">
        <p className="text-[10px] font-semibold text-amber-400 uppercase tracking-widest mb-2">Upcoming</p>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px]"><span className="text-slate-300">Follow-up → Figma</span><span className="text-slate-500">Today</span></div>
          <div className="flex items-center justify-between text-[11px]"><span className="text-slate-300">Interview → Notion</span><span className="text-slate-500">Apr 17</span></div>
        </div>
      </div>
    </MockShell>
  );
}

function ScoringMock() {
  return (
    <MockShell title="jobs / stripe-sr-engineer">
      <div className="mb-4 rounded-xl border border-white/[0.07] bg-white/[0.04] p-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <p className="text-sm font-semibold text-white">Senior Software Engineer</p>
            <p className="text-[11px] text-slate-400">Stripe · Remote (US)</p>
          </div>
          <div className="text-right">
            <p className="text-xl font-bold text-emerald-400">94</p>
            <p className="text-[10px] text-emerald-400/70">Strong Fit</p>
          </div>
        </div>
        <div className="space-y-2.5">
          {[
            { label: 'Core Stack Match', val: 96, color: 'from-emerald-500 to-emerald-300' },
            { label: 'Seniority Alignment', val: 90, color: 'from-cyan-500 to-cyan-300' },
            { label: 'Location / Remote', val: 100, color: 'from-cyan-500 to-cyan-300' },
            { label: 'Compensation Band', val: 85, color: 'from-amber-500 to-amber-300' },
          ].map(({ label, val, color }) => (
            <div key={label}>
              <div className="flex justify-between text-[10px] mb-1"><span className="text-slate-400">{label}</span><span className="text-white font-semibold">{val}</span></div>
              <div className="h-1.5 rounded-full bg-white/10 overflow-hidden"><div className={`h-full rounded-full bg-gradient-to-r ${color}`} style={{ width: `${val}%` }} /></div>
            </div>
          ))}
        </div>
      </div>
      <button className="w-full rounded-xl border border-cyan-500/20 bg-cyan-500/10 py-2 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/20 transition-colors">
        <Cpu className="inline h-3.5 w-3.5 mr-1.5" />Re-score with current preferences
      </button>
    </MockShell>
  );
}

function PipelineMock() {
  const cols = [
    { label: 'Saved', count: 14, items: ['Stripe', 'Figma', 'Loom'], color: 'border-slate-500/30 bg-slate-500/5' },
    { label: 'Applied', count: 8, items: ['Linear', 'Notion'], color: 'border-accent/30 bg-accent/5' },
    { label: 'Interview', count: 2, items: ['Vercel'], color: 'border-violet-500/30 bg-violet-500/5' },
  ];
  return (
    <MockShell title="pipeline">
      <div className="grid grid-cols-3 gap-2">
        {cols.map((col) => (
          <div key={col.label} className={`rounded-xl border ${col.color} p-2.5`}>
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-[10px] font-semibold text-slate-300">{col.label}</span>
              <span className="text-[10px] text-slate-500">{col.count}</span>
            </div>
            <div className="space-y-1.5">
              {col.items.map((item) => (
                <div key={item} className="rounded-lg border border-white/[0.07] bg-white/[0.05] px-2 py-1.5">
                  <p className="text-[10px] font-semibold text-white">{item}</p>
                  <p className="text-[9px] text-slate-500 mt-0.5">Engineer</p>
                </div>
              ))}
              <div className="rounded-lg border border-dashed border-white/10 px-2 py-1.5 text-center">
                <p className="text-[9px] text-slate-600">+ drag here</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </MockShell>
  );
}

function QueueMock() {
  const items = [
    { co: 'Stripe', label: 'Follow-up due', score: 94, tier: 'Strong Fit', tagColor: 'bg-rose-500/20 text-rose-300', scoreColor: 'text-emerald-400' },
    { co: 'Linear', label: 'High priority, not applied', score: 87, tier: 'Good Fit', tagColor: 'bg-amber-500/20 text-amber-300', scoreColor: 'text-cyan-400' },
    { co: 'Vercel', label: 'Review before applying', score: 82, tier: 'Good Fit', tagColor: 'bg-cyan-500/20 text-cyan-300', scoreColor: 'text-cyan-400' },
  ];
  return (
    <MockShell title="queue">
      <p className="text-[10px] font-semibold text-cyan-400 uppercase tracking-widest mb-3">3 actions for today</p>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.co} className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="h-7 w-7 rounded-lg bg-white/[0.07] text-[10px] font-bold text-slate-300 flex items-center justify-center">{item.co[0]}</div>
                <div>
                  <p className="text-[11px] font-semibold text-white">{item.co}</p>
                  <span className={`inline-block rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${item.tagColor}`}>{item.label}</span>
                </div>
              </div>
              <div className="text-right">
                <p className={`text-sm font-bold ${item.scoreColor}`}>{item.score}</p>
                <p className="text-[9px] text-slate-500">{item.tier}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-xl border border-white/[0.05] bg-white/[0.02] p-2.5 text-center text-[10px] text-slate-600">
        Queue resets at midnight · based on live pipeline state
      </div>
    </MockShell>
  );
}

function CrmMock() {
  return (
    <MockShell title="jobs / stripe-sr-engineer / contacts">
      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-3">3 contacts</p>
      <div className="space-y-2 mb-4">
        {[
          { name: 'Alex Rivera', title: 'Technical Recruiter', contact: 'arivera@stripe.com', last: '3 days ago', dot: 'bg-emerald-400' },
          { name: 'Jordan Kim', title: 'Engineering Manager', contact: 'jkim@stripe.com', last: '1 week ago', dot: 'bg-amber-400' },
          { name: 'Sam Patel', title: 'Referral (friend)', contact: 'LinkedIn', last: 'Today', dot: 'bg-cyan-400' },
        ].map((c) => (
          <div key={c.name} className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5">
            <div className="flex items-center gap-2.5">
              <div className="relative h-7 w-7 rounded-full bg-white/[0.08] flex items-center justify-center text-[10px] font-bold text-slate-300">
                {c.name[0]}
                <span className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-[#08111f] ${c.dot}`} />
              </div>
              <div>
                <p className="text-[11px] font-semibold text-white">{c.name}</p>
                <p className="text-[9px] text-slate-500">{c.title}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[9px] text-slate-400">{c.last}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-dashed border-white/10 p-2.5 text-center text-[10px] text-slate-600">
        + Add contact
      </div>
    </MockShell>
  );
}

function PrepMock() {
  return (
    <MockShell title="jobs / vercel-dx-engineer / prep">
      <p className="text-[10px] font-semibold text-sky-400 uppercase tracking-widest mb-3">Interview prep pack</p>
      <div className="space-y-2 mb-4">
        {[
          { label: 'Tell me about yourself', done: true },
          { label: 'Why Vercel specifically?', done: true },
          { label: 'Describe a hard debugging session', done: false },
          { label: 'System design: CDN at scale', done: false },
          { label: 'Questions to ask the team', done: false },
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-2.5 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2">
            <div className={`h-4 w-4 flex-shrink-0 rounded-md border ${item.done ? 'border-emerald-500/40 bg-emerald-500/20' : 'border-white/10 bg-white/[0.04]'} flex items-center justify-center`}>
              {item.done && <CheckCircle2 className="h-2.5 w-2.5 text-emerald-400" />}
            </div>
            <span className={`text-[11px] ${item.done ? 'text-slate-500 line-through' : 'text-slate-200'}`}>{item.label}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2">
        <div className="h-full w-0.5 rounded bg-sky-500/40" />
        <p className="text-[10px] text-slate-400 italic">Research note: focus on edge network architecture — role is infrastructure-adjacent.</p>
      </div>
    </MockShell>
  );
}

function MockShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.09] bg-white/[0.02] shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl">
      <div className="flex items-center gap-2 border-b border-white/[0.07] px-4 py-2.5">
        <div className="h-2 w-2 rounded-full bg-rose-500/70" />
        <div className="h-2 w-2 rounded-full bg-amber-500/70" />
        <div className="h-2 w-2 rounded-full bg-emerald-500/70" />
        <span className="ml-2 text-[10px] text-slate-600">{title} · job-seeker-os.app</span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

/* ── Feature Section ────────────────────────────────────────────────── */
function FeatureSection({ section, index }: { section: typeof sections[number]; index: number }) {
  const { ref: textRef, visible: textVisible } = useReveal(0.1);
  const { ref: mockRef, visible: mockVisible } = useReveal(0.08);
  const Icon = section.icon;

  const textCol = (
    <div ref={textRef} className={`reveal-hidden ${textVisible ? 'reveal-visible' : ''}`} style={{ transitionDelay: '0ms' }}>
      <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${section.badgeColor}`}>
        <Icon className="h-3 w-3" />
        {section.badge}
      </span>
      <h2 className="mt-5 text-2xl font-bold tracking-tight text-white sm:text-3xl">{section.heading}</h2>
      <p className="mt-4 text-base leading-7 text-slate-400">{section.body}</p>
      <ul className="mt-6 space-y-3">
        {section.bullets.map((b) => (
          <li key={b} className="flex items-start gap-3 text-sm text-slate-300">
            <CheckCircle2 className={`mt-0.5 h-4 w-4 flex-shrink-0 ${section.iconColor}`} />
            {b}
          </li>
        ))}
      </ul>
    </div>
  );

  const mockCol = (
    <div ref={mockRef} className={`reveal-hidden ${mockVisible ? 'reveal-visible' : ''}`} style={{ transitionDelay: '120ms' }}>
      {section.mock}
    </div>
  );

  return (
    <div id={section.id} className="grid gap-12 py-20 lg:grid-cols-2 lg:items-center lg:gap-16">
      {section.flip ? (
        <>{mockCol}{textCol}</>
      ) : (
        <>{textCol}{mockCol}</>
      )}
    </div>
  );
}

/* ── Stats bar ─────────────────────────────────────────────────────── */
function StatsBar() {
  const { ref, visible } = useReveal(0.15);
  const stats = [
    { icon: Target, value: '10 min', label: 'Setup time', color: 'text-cyan-400' },
    { icon: BarChart2, value: '8 modules', label: 'Fully integrated', color: 'text-indigo-400' },
    { icon: Cpu, value: 'AI-scored', label: 'Every lead', color: 'text-amber-400' },
    { icon: Shield, value: 'Auth + DB', label: 'Production-grade', color: 'text-emerald-400' },
    { icon: Calendar, value: 'Daily queue', label: 'Zero decision fatigue', color: 'text-violet-400' },
  ];
  return (
    <div ref={ref} className={`reveal-hidden border-y border-white/[0.07] py-10 ${visible ? 'reveal-visible' : ''}`}>
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-5">
        {stats.map(({ icon: Icon, value, label, color }) => (
          <div key={label} className="text-center">
            <Icon className={`mx-auto mb-2 h-5 w-5 ${color}`} />
            <p className="text-lg font-bold text-white">{value}</p>
            <p className="text-xs text-slate-500">{label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Notification / Streak callout ─────────────────────────────────── */
function EngagementSection() {
  const { ref, visible } = useReveal(0.1);
  return (
    <div ref={ref} className={`reveal-hidden py-20 ${visible ? 'reveal-visible' : ''}`}>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {[
          {
            icon: BellRing, color: 'text-rose-400', border: 'hover:border-rose-500/30',
            title: 'Smart notifications',
            body: 'Automatic alerts for follow-ups that are due, stale applications, and upcoming interviews — delivered via the notification bell in the app.',
          },
          {
            icon: Flame, color: 'text-amber-400', border: 'hover:border-amber-500/30',
            title: 'Application streak',
            body: 'Consecutive days of activity build your streak. Milestones surface in the dashboard and trigger notifications to keep momentum high.',
          },
          {
            icon: TrendingUp, color: 'text-emerald-400', border: 'hover:border-emerald-500/30',
            title: 'Progress analytics',
            body: 'Track your weekly application velocity, pipeline stage distribution, and average fit score to understand where your search is strong and where it needs attention.',
          },
          {
            icon: Upload, color: 'text-cyan-400', border: 'hover:border-cyan-500/30',
            title: 'Job ingestion',
            body: 'Paste a job URL or description and the system extracts company, role, skills, salary, and location automatically. No manual entry required.',
          },
          {
            icon: Clock, color: 'text-violet-400', border: 'hover:border-violet-500/30',
            title: 'Follow-up engine',
            body: 'Set a follow-up date on any lead. The queue surfaces it on the right day, and notifications remind you before the window closes.',
          },
          {
            icon: Zap, color: 'text-indigo-400', border: 'hover:border-indigo-500/30',
            title: 'LinkedIn & password auth',
            body: 'Sign up with email or continue with LinkedIn. Password reset, email verification, and post-OAuth workspace import are all handled.',
          },
        ].map(({ icon: Icon, color, border, title, body }, i) => (
          <div
            key={title}
            className={`reveal-hidden rounded-2xl border border-white/[0.07] bg-white/[0.03] p-5 transition-colors ${border} ${visible ? 'reveal-visible' : ''}`}
            style={{ transitionDelay: visible ? `${i * 60}ms` : '0ms' }}
          >
            <Icon className={`mb-3 h-5 w-5 ${color}`} />
            <h3 className="text-sm font-semibold text-white">{title}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-400">{body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Main export ────────────────────────────────────────────────────── */
export function ProductOverviewClient() {
  return (
    <div>
      <StatsBar />
      {sections.map((section, i) => (
        <FeatureSection key={section.id} section={section} index={i} />
      ))}
      <div className="border-t border-white/[0.07]">
        <EngagementSection />
      </div>

      {/* Final CTA */}
      <div className="relative overflow-hidden rounded-3xl border border-white/[0.1] bg-gradient-to-br from-[#0f1f3d] via-[#0a1828] to-[#08111f] p-10 text-center shadow-[0_32px_80px_rgba(0,0,0,0.4)] sm:p-14 mb-20">
        <div className="pointer-events-none absolute -top-20 -right-20 h-[280px] w-[280px] orb-drift-1 rounded-full bg-cyan-500/[0.1] blur-[80px]" aria-hidden />
        <div className="pointer-events-none absolute -bottom-20 -left-20 h-[240px] w-[240px] orb-drift-2 rounded-full bg-indigo-500/[0.08] blur-[70px]" aria-hidden />
        <div className="relative">
          <h2 className="text-2xl font-bold text-white sm:text-3xl">Ready to run a more disciplined search?</h2>
          <p className="mx-auto mt-4 max-w-lg text-base text-slate-300/80">
            Set up your workspace, configure your preferences, and have an AI-scored queue ready in under 10 minutes.
          </p>
          <div className="mt-7 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link href="/register" className="btn-primary gap-2 px-7 py-2.5 text-sm shadow-lg shadow-accent/25">
              Create free workspace <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/login" className="btn-secondary px-7 py-2.5 text-sm">
              Sign in
            </Link>
          </div>
          <p className="mt-4 text-xs text-slate-600">No credit card required · Takes under 2 minutes</p>
        </div>
      </div>
    </div>
  );
}
