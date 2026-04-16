'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

const faqs = [
  {
    q: 'What makes Job Seeker OS different from a spreadsheet or generic tracker?',
    a: 'It combines prioritization, workflow management, recruiter tracking, and preparation into one system instead of leaving those steps scattered across tools. The AI scoring engine gives every lead a fit score based on your personal preferences — something no spreadsheet can do.',
  },
  {
    q: 'Is this just for software engineers?',
    a: 'No. The operating-system style workflow is role-agnostic. Whether you are a designer, product manager, marketer, or data scientist, the scoring and pipeline tools adapt to your preferences and target roles.',
  },
  {
    q: 'Does the app already personalize job rankings?',
    a: 'Yes. The scoring system takes your preferences into account — target seniority, preferred region, role focus, remote tolerance, stack priorities, and salary band. Each job receives a composite fit score you can re-trigger anytime your preferences change.',
  },
  {
    q: 'How does the daily queue work?',
    a: 'The queue engine surfaces the highest-priority actions every day: new applications to consider, follow-ups that are due, stale leads that need a decision, and upcoming interviews. It ranks by fit score, stage, and time-sensitivity.',
  },
  {
    q: 'Is it free?',
    a: 'The core workspace is free. Create an account, set up your preferences, and start capturing jobs immediately — no credit card required.',
  },
  {
    q: 'What is coming next?',
    a: 'The product roadmap includes stronger job ingestion from arbitrary URLs, AI-assisted fit explanations, resume tailoring suggestions per job, and collaboration features for working with career coaches.',
  },
];

function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold: 0.08 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return { ref, visible };
}

function FaqItem({ item, index }: { item: typeof faqs[number]; index: number }) {
  const { ref, visible } = useReveal();
  const [open, setOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={ref}
      className={`reveal-hidden overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] transition-all duration-200 hover:border-white/[0.14] ${open ? 'border-cyan-500/20 bg-white/[0.05]' : ''} ${visible ? 'reveal-visible' : ''}`}
      style={{ transitionDelay: visible ? `${index * 60}ms` : '0ms' }}
    >
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-start justify-between gap-4 px-6 py-5 text-left"
        aria-expanded={open}
      >
        <span className="text-sm font-semibold leading-6 text-white sm:text-base">{item.q}</span>
        <ChevronDown
          className={`mt-0.5 h-5 w-5 flex-shrink-0 text-slate-400 transition-transform duration-300 ${open ? 'rotate-180 text-cyan-400' : ''}`}
        />
      </button>

      <div
        ref={bodyRef}
        className="overflow-hidden transition-all duration-300 ease-in-out"
        style={{
          maxHeight: open ? `${bodyRef.current?.scrollHeight ?? 200}px` : '0px',
          opacity: open ? 1 : 0,
        }}
      >
        <p className="px-6 pb-5 text-sm leading-7 text-slate-400">{item.a}</p>
      </div>
    </div>
  );
}

export function LandingFaq() {
  const { ref: headRef, visible: headVisible } = useReveal();

  return (
    <section id="faq" className="py-24">
      <div
        ref={headRef}
        className={`reveal-hidden mb-12 max-w-2xl ${headVisible ? 'reveal-visible' : ''}`}
      >
        <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-semibold text-slate-300">
          FAQ
        </span>
        <h2 className="mt-5 text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Built to make the search more strategic, not just more organized.
        </h2>
      </div>

      <div className="grid gap-3">
        {faqs.map((item, i) => (
          <FaqItem key={item.q} item={item} index={i} />
        ))}
      </div>
    </section>
  );
}

