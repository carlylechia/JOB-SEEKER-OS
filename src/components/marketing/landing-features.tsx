'use client';

import { useEffect, useRef, useState } from 'react';
import {
  LayoutDashboard, Star, ListChecks, Users, BookOpen,
  GitBranch, BellRing, BarChart2, Zap,
} from 'lucide-react';

const features = [
  {
    icon: Star,
    title: 'AI Fit Scoring',
    description:
      'Every job receives a fit score based on your preferences — stack, seniority, location, and remote priorities — so you know exactly what to focus on.',
    accent: 'text-amber-400',
    glow: 'shadow-amber-500/10',
    border: 'hover:border-amber-500/30',
  },
  {
    icon: ListChecks,
    title: 'Daily Smart Queue',
    description:
      'A curated, AI-ranked list of jobs that need your attention today. Follow-ups, new applications, and stale leads — organized and actionable.',
    accent: 'text-cyan-400',
    glow: 'shadow-cyan-500/10',
    border: 'hover:border-cyan-500/30',
  },
  {
    icon: GitBranch,
    title: 'Application Pipeline',
    description:
      'A visual Kanban board that moves your leads through every stage — from Saved to Offer — with drag-and-drop simplicity.',
    accent: 'text-indigo-400',
    glow: 'shadow-indigo-500/10',
    border: 'hover:border-indigo-500/30',
  },
  {
    icon: Users,
    title: 'Recruiter CRM',
    description:
      'Track every contact associated with a lead, log outreach, set follow-up reminders, and never let a warm connection go cold.',
    accent: 'text-emerald-400',
    glow: 'shadow-emerald-500/10',
    border: 'hover:border-emerald-500/30',
  },
  {
    icon: BookOpen,
    title: 'Interview Prep',
    description:
      'Attach notes, role-specific questions, and preparation materials directly to each job — so you walk into every interview fully prepared.',
    accent: 'text-violet-400',
    glow: 'shadow-violet-500/10',
    border: 'hover:border-violet-500/30',
  },
  {
    icon: BellRing,
    title: 'Smart Notifications',
    description:
      'Automated reminders for follow-ups, deadlines, and stale applications — so nothing falls through the cracks.',
    accent: 'text-rose-400',
    glow: 'shadow-rose-500/10',
    border: 'hover:border-rose-500/30',
  },
  {
    icon: BarChart2,
    title: 'Search Analytics',
    description:
      'See your application velocity, response rate, and pipeline health at a glance. Know whether you\'re executing with discipline.',
    accent: 'text-sky-400',
    glow: 'shadow-sky-500/10',
    border: 'hover:border-sky-500/30',
  },
  {
    icon: LayoutDashboard,
    title: 'Unified Dashboard',
    description:
      'One view for your streak, daily queue, top priorities, and upcoming milestones. Your search at a glance — nothing hidden.',
    accent: 'text-cyan-300',
    glow: 'shadow-cyan-400/10',
    border: 'hover:border-cyan-400/30',
  },
];

function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { threshold: 0.08, rootMargin: '0px 0px -40px 0px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return { ref, visible };
}

function FeatureCard({ feature, index }: { feature: typeof features[number]; index: number }) {
  const { ref, visible } = useReveal();
  const Icon = feature.icon;

  return (
    <div
      ref={ref}
      className={`reveal-hidden group rounded-2xl border border-white/[0.08] bg-white/[0.03] p-6 backdrop-blur-sm transition-all duration-300 ${feature.border} hover:bg-white/[0.06] hover:shadow-lg ${feature.glow} ${visible ? 'reveal-visible' : ''}`}
      style={{ transitionDelay: visible ? `${(index % 4) * 80}ms` : '0ms' }}
    >
      <div className={`mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.06] ${feature.accent}`}>
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="text-base font-semibold text-white">{feature.title}</h3>
      <p className="mt-2.5 text-sm leading-6 text-slate-400">{feature.description}</p>
    </div>
  );
}

export function LandingFeatures() {
  const { ref: headRef, visible: headVisible } = useReveal();

  return (
    <section id="features" className="py-24">
      {/* Section header */}
      <div
        ref={headRef}
        className={`reveal-hidden text-center ${headVisible ? 'reveal-visible' : ''}`}
      >
        <span className="inline-flex items-center gap-2 rounded-full border border-cyan-500/25 bg-cyan-500/[0.08] px-3 py-1.5 text-xs font-semibold text-cyan-300">
          <Zap className="h-3 w-3" /> Everything you need
        </span>
        <h2 className="mt-5 text-3xl font-bold tracking-tight text-white sm:text-4xl">
          One platform. Every layer of the search.
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-slate-400">
          Purpose-built tools that work together — from the first job capture to the final offer. No external spreadsheets, no forgotten follow-ups.
        </p>
      </div>

      {/* Feature grid */}
      <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {features.map((feature, i) => (
          <FeatureCard key={feature.title} feature={feature} index={i} />
        ))}
      </div>
    </section>
  );
}
