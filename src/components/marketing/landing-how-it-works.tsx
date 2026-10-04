'use client';

import { useEffect, useRef, useState } from 'react';
import { Upload, Sliders, Layers, Rocket } from 'lucide-react';

const steps = [
  {
    number: '01',
    icon: Upload,
    title: 'Capture every opportunity',
    description:
      'Paste a job URL or description to ingest it instantly. The system extracts company, role, skills, salary, and location — no manual entry required.',
    detail: 'LinkedIn, job boards, company pages — anywhere you find a role.',
    accent: 'border-[#D4AF37]/40 bg-[#D4AF37]/10 text-[#8A6D1F]',
    connector: 'bg-gradient-to-b from-[#D4AF37]/40 to-[#D4AF37]/15',
  },
  {
    number: '02',
    icon: Sliders,
    title: 'Configure your fit profile',
    description:
      'Set your target stack, seniority level, preferred locations, remote tolerance, and salary band. The scoring engine uses these to rank every lead.',
    detail: 'Preferences persist and can be updated at any time.',
    accent: 'border-[#C9CED6] bg-[#C9CED6]/30 text-[#3A4048]',
    connector: 'bg-gradient-to-b from-[#C9CED6] to-[#C9CED6]/40',
  },
  {
    number: '03',
    icon: Layers,
    title: 'Prioritize with AI scores',
    description:
      'Every job gets a composite fit score — core stack match, seniority alignment, location, and compensation overlap. See who deserves effort at a glance.',
    detail: 'Re-score anytime after updating your preferences.',
    accent: 'border-[#C9CED6] bg-[#C9CED6]/30 text-[#5B6472]',
    connector: 'bg-gradient-to-b from-[#C9CED6] to-emerald-500/20',
  },
  {
    number: '04',
    icon: Rocket,
    title: 'Execute with discipline',
    description:
      'Work your daily queue, move leads through the pipeline, track contacts, prep for interviews, and maintain your application streak — all in one system.',
    detail: 'Built for candidates who run their search like a professional.',
    accent: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-800',
    connector: null,
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
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return { ref, visible };
}

function TimelineStep({
  step,
  index,
  isLast,
}: {
  step: typeof steps[number];
  index: number;
  isLast: boolean;
}) {
  const { ref, visible } = useReveal();
  const Icon = step.icon;

  return (
    <div
      ref={ref}
      className={`reveal-hidden relative flex gap-6 ${visible ? 'reveal-visible' : ''}`}
      style={{ transitionDelay: visible ? `${index * 120}ms` : '0ms' }}
    >
      {/* Left: number + connecting line */}
      <div className="flex flex-col items-center">
        <div
          className={`relative z-10 flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl border-2 backdrop-blur-sm ${step.accent} text-base font-bold transition-transform duration-300 group-hover:scale-105`}
        >
          {step.number}
        </div>
        {!isLast && (
          <div className={`mt-3 w-px flex-1 ${step.connector ?? 'bg-black/[0.05]'} min-h-[48px]`} />
        )}
      </div>

      {/* Right: content */}
      <div className={`pb-10 ${isLast ? '' : ''}`}>
        <div className="mb-3 inline-flex items-center gap-2 rounded-xl border border-[#E2E5EA] bg-black/[0.035] px-3 py-1.5">
          <Icon className="h-4 w-4 text-[#4A505A]" />
          <span className="text-xs font-semibold text-[#4A505A]">{step.title}</span>
        </div>
        <p className="text-base leading-7 text-[#4A505A]">{step.description}</p>
        <p className="mt-2 text-sm text-[#686F7B]">{step.detail}</p>
      </div>
    </div>
  );
}

export function LandingHowItWorks() {
  const { ref: headRef, visible: headVisible } = useReveal();

  return (
    <section id="how-it-works" className="py-24">
      <div className="grid gap-16 lg:grid-cols-[1fr_1fr] lg:gap-24 lg:items-start">

        {/* Left: sticky header */}
        <div
          ref={headRef}
          className={`reveal-hidden lg:sticky lg:top-28 ${headVisible ? 'reveal-visible' : ''}`}
        >
          <span className="inline-flex items-center gap-2 rounded-full border border-[#C9CED6] bg-[#C9CED6]/20 px-3 py-1.5 text-xs font-semibold text-[#5B6472]">
            How it works
          </span>
          <h2 className="mt-5 text-3xl font-bold tracking-tight text-[#17191E] sm:text-4xl">
            From job capture to signed offer — a disciplined workflow.
          </h2>
          <p className="mt-5 text-base leading-7 text-[#686F7B]">
            teChia Jobs structures the search into four deliberate stages. Each step reduces friction and keeps you focused on what actually moves the needle.
          </p>

          {/* Visual accent */}
          <div className="mt-10 rounded-2xl border border-[#E2E5EA] bg-black/[0.03] p-5">
            <div className="text-xs font-semibold uppercase tracking-widest text-[#8A6D1F] mb-3">
              Average user outcome
            </div>
            <div className="space-y-3">
              {[
                { label: 'Fewer missed follow-ups', pct: 94 },
                { label: 'Faster application decisions', pct: 78 },
                { label: 'Clearer priority ranking', pct: 88 },
              ].map(({ label, pct }) => (
                <div key={label}>
                  <div className="mb-1 flex justify-between text-xs text-[#686F7B]">
                    <span>{label}</span>
                    <span className="text-[#8A6D1F] font-semibold">{pct}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/[0.05]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#D4AF37] to-[#F1D78A]"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: timeline steps */}
        <div>
          {steps.map((step, i) => (
            <TimelineStep key={step.number} step={step} index={i} isLast={i === steps.length - 1} />
          ))}
        </div>
      </div>
    </section>
  );
}
