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
    accent: 'border-accent/40 bg-accent/10 text-accent-text',
    connector: 'bg-gradient-to-b from-accent/40 to-accent/15',
  },
  {
    number: '02',
    icon: Sliders,
    title: 'Configure your fit profile',
    description:
      'Set your target stack, seniority level, preferred locations, remote tolerance, and salary band. The scoring engine uses these to rank every lead.',
    detail: 'Preferences persist and can be updated at any time.',
    accent: 'border-line-strong bg-line-strong/30 text-ink-2',
    connector: 'bg-gradient-to-b from-line-strong to-line-strong/40',
  },
  {
    number: '03',
    icon: Layers,
    title: 'Prioritize with AI scores',
    description:
      'Every job gets a composite fit score — core stack match, seniority alignment, location, and compensation overlap. See who deserves effort at a glance.',
    detail: 'Re-score anytime after updating your preferences.',
    accent: 'border-line-strong bg-line-strong/30 text-muted',
    connector: 'bg-gradient-to-b from-line-strong to-success/20',
  },
  {
    number: '04',
    icon: Rocket,
    title: 'Execute with discipline',
    description:
      'Work your daily queue, move leads through the pipeline, track contacts, prep for interviews, and maintain your application streak — all in one system.',
    detail: 'Built for candidates who run their search like a professional.',
    accent: 'border-success/40 bg-success/10 text-success-text',
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
          <div className={`mt-3 w-px flex-1 ${step.connector ?? 'bg-surface-sunken'} min-h-[48px]`} />
        )}
      </div>

      {/* Right: content */}
      <div className={`pb-10 ${isLast ? '' : ''}`}>
        <div className="mb-3 inline-flex items-center gap-2 rounded-xl border border-line bg-surface-sunken px-3 py-1.5">
          <Icon className="h-4 w-4 text-ink-2" />
          <span className="text-xs font-semibold text-ink-2">{step.title}</span>
        </div>
        <p className="text-base leading-7 text-ink-2">{step.description}</p>
        <p className="mt-2 text-sm text-muted">{step.detail}</p>
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
          <span className="inline-flex items-center gap-2 rounded-full border border-line-strong bg-line-strong/20 px-3 py-1.5 text-xs font-semibold text-muted">
            How it works
          </span>
          <h2 className="mt-5 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
            From job capture to signed offer — a disciplined workflow.
          </h2>
          <p className="mt-5 text-base leading-7 text-muted">
            teChia Jobs structures the search into four deliberate stages. Each step reduces friction and keeps you focused on what actually moves the needle.
          </p>

          {/* Visual accent */}
          <div className="mt-10 rounded-2xl border border-line bg-surface-sunken p-5">
            <div className="text-xs font-semibold uppercase tracking-widest text-accent-text mb-3">
              What the workflow covers
            </div>
            <ul className="space-y-2 text-sm text-muted">
              <li>Discover and import relevant jobs</li>
              <li>Understand fit and gaps</li>
              <li>Prepare resumes and application materials</li>
              <li>Practise interviews</li>
              <li>Track, follow up, and review progress</li>
            </ul>
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
