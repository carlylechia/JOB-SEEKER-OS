'use client';

import { useEffect, useRef, useState } from 'react';
import { TrendingUp, Flame, Clock, CheckCircle2, Briefcase } from 'lucide-react';

function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) { setVisible(true); obs.disconnect(); }
      },
      { threshold: 0.1, rootMargin: '0px 0px -40px 0px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return { ref, visible };
}

const pipeline = [
  { stage: 'Saved', count: 14, color: 'bg-slate-400' },
  { stage: 'Applied', count: 8, color: 'bg-accent' },
  { stage: 'Phone Screen', count: 4, color: 'bg-amber-400' },
  { stage: 'Interview', count: 2, color: 'bg-violet-400' },
  { stage: 'Offer', count: 1, color: 'bg-emerald-400' },
];

const queueMini = [
  { company: 'Stripe', role: 'Senior Engineer', score: 94, color: 'bg-emerald-400' },
  { company: 'Linear', role: 'Product Engineer', score: 87, color: 'bg-cyan-400' },
  { company: 'Vercel', role: 'DX Engineer', score: 82, color: 'bg-cyan-400' },
];

export function LandingDashboardPreview() {
  const { ref, visible } = useReveal();
  const { ref: cardRef, visible: cardVisible } = useReveal();

  return (
    <section className="py-24">
      <div className="grid gap-16 lg:grid-cols-2 lg:items-center">

        {/* Left: copy */}
        <div ref={ref} className={`reveal-hidden ${visible ? 'reveal-visible' : ''}`}>
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/[0.08] px-3 py-1.5 text-xs font-semibold text-emerald-300">
            <TrendingUp className="h-3 w-3" /> Unified dashboard
          </span>
          <h2 className="mt-5 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Everything in one view. Nothing hidden.
          </h2>
          <p className="mt-5 text-base leading-7 text-slate-400">
            Your dashboard surfaces your streak, today's priorities, pipeline health, and upcoming follow-ups — so you can
            start each session knowing exactly what to do.
          </p>

          <div className="mt-8 grid gap-4">
            {[
              { icon: Flame, heading: 'Streak tracking', body: 'Consecutive days of activity build your streak and surface engagement milestones.', color: 'text-amber-400' },
              { icon: Clock, heading: 'Follow-up reminders', body: 'Automatic notifications when leads are going stale or follow-ups are overdue.', color: 'text-cyan-400' },
              { icon: CheckCircle2, heading: 'Priority scoring', body: 'AI score + application stage determines your daily priority ranking automatically.', color: 'text-emerald-400' },
            ].map(({ icon: Icon, heading, body, color }) => (
              <div key={heading} className="flex gap-4 rounded-xl border border-white/[0.07] bg-white/[0.03] p-4">
                <div className={`flex-shrink-0 mt-0.5 ${color}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">{heading}</p>
                  <p className="mt-1 text-sm leading-6 text-slate-400">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: frosted glass mock UI */}
        <div ref={cardRef} className={`reveal-hidden ${cardVisible ? 'reveal-visible' : ''}`} style={{ transitionDelay: '150ms' }}>
          <div className="relative overflow-hidden rounded-3xl border border-white/[0.1] bg-white/[0.02] p-1 shadow-[0_32px_100px_rgba(0,0,0,0.5)] backdrop-blur-xl">

            {/* Window chrome */}
            <div className="flex items-center gap-2 border-b border-white/[0.07] px-4 py-3">
              <div className="h-2.5 w-2.5 rounded-full bg-rose-500/70" />
              <div className="h-2.5 w-2.5 rounded-full bg-amber-500/70" />
              <div className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
              <div className="ml-3 text-xs text-slate-500">dashboard · job-seeker-os.app</div>
            </div>

            <div className="p-5 space-y-5">

              {/* KPI row */}
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: 'Total Leads', value: '29', change: '+3', pos: true },
                  { label: 'Applied', value: '8', change: '+1', pos: true },
                  { label: 'Streak', value: '7d', change: '🔥', pos: true },
                  { label: 'Avg Score', value: '81', change: '↑', pos: true },
                ].map(({ label, value, change, pos }) => (
                  <div key={label} className="rounded-xl border border-white/[0.07] bg-white/[0.04] p-3">
                    <p className="text-[10px] text-slate-500">{label}</p>
                    <p className="mt-1 text-lg font-bold text-white">{value}</p>
                    <p className={`text-[10px] font-medium ${pos ? 'text-emerald-400' : 'text-rose-400'}`}>{change}</p>
                  </div>
                ))}
              </div>

              {/* Pipeline */}
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Briefcase className="h-4 w-4 text-cyan-400" />
                  <span className="text-xs font-semibold text-slate-300">Pipeline Overview</span>
                </div>
                <div className="flex items-end gap-1">
                  {pipeline.map((s) => {
                    const h = Math.round((s.count / 14) * 48) + 16;
                    return (
                      <div key={s.stage} className="flex flex-1 flex-col items-center gap-1.5">
                        <span className="text-[9px] font-bold text-slate-300">{s.count}</span>
                        <div
                          className={`w-full rounded-t-md ${s.color} opacity-80`}
                          style={{ height: `${h}px` }}
                        />
                        <span className="text-[8px] text-slate-500 text-center leading-tight">{s.stage}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Today's queue preview */}
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-4">
                <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-cyan-400">
                  Today&apos;s Queue
                </div>
                <div className="space-y-2.5">
                  {queueMini.map((item) => (
                    <div key={item.company} className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.07] text-[10px] font-bold text-slate-300">
                          {item.company[0]}
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-white">{item.company}</p>
                          <p className="text-[10px] text-slate-500">{item.role}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-12 h-1 overflow-hidden rounded-full bg-white/10">
                          <div className={`h-full ${item.color} rounded-full`} style={{ width: `${item.score}%` }} />
                        </div>
                        <span className="text-xs font-bold text-white">{item.score}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </div>
        </div>

      </div>
    </section>
  );
}
