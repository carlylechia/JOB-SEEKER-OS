'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Quote } from 'lucide-react';

const testimonials = [
  {
    quote:
      "I was applying to 15+ jobs a week with zero system. teChia Jobs helped me cut that down to 7 — the right 7. I had my first offer in 5 weeks.",
    author: 'Sarah K.',
    role: 'Product Manager',
    company: 'Previously @ Series B startup',
    initials: 'SK',
    accent: 'bg-[#D4AF37]/20 text-[#8A6D1F]',
  },
  {
    quote:
      "The AI scoring completely reframed how I thought about my search. I stopped wasting time on stretch roles and focused on where I actually had leverage. Landed a senior role in 6 weeks.",
    author: 'Marcus T.',
    role: 'Software Engineer',
    company: 'Placed at fintech scale-up',
    initials: 'MT',
    accent: 'bg-[#C9CED6]/40 text-[#3A4048]',
  },
  {
    quote:
      "As a career changer, I needed structure. The daily queue told me exactly what to do each morning. No decision fatigue, no rabbit holes. Just execution.",
    author: 'Priya M.',
    role: 'Data Scientist',
    company: 'Career transitioned from consulting',
    initials: 'PM',
    accent: 'bg-[#C9CED6]/40 text-[#5B6472]',
  },
  {
    quote:
      "The recruiter CRM alone is worth it. I was tracking 30+ contacts in a spreadsheet. Having it all attached to the job lead changed how I followed up.",
    author: 'Jordan R.',
    role: 'UX Designer',
    company: '18 interviews, 3 final rounds',
    initials: 'JR',
    accent: 'bg-emerald-500/20 text-emerald-800',
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
      { threshold: 0.1 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return { ref, visible };
}

export function LandingTestimonials() {
  const { ref, visible } = useReveal();
  const [active, setActive] = useState(0);
  const [animating, setAnimating] = useState(false);

  const go = useCallback((next: number) => {
    if (animating) return;
    setAnimating(true);
    setTimeout(() => {
      setActive((next + testimonials.length) % testimonials.length);
      setAnimating(false);
    }, 180);
  }, [animating]);

  // Auto-advance
  useEffect(() => {
    const timer = setInterval(() => go(active + 1), 5000);
    return () => clearInterval(timer);
  }, [active, go]);

  const t = testimonials[active];

  return (
    <section className="py-24">
      <div ref={ref} className={`reveal-hidden ${visible ? 'reveal-visible' : ''}`}>

        {/* Header */}
        <div className="text-center mb-14">
          <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/25 bg-amber-500/[0.08] px-3 py-1.5 text-xs font-semibold text-amber-800">
            Real outcomes
          </span>
          <h2 className="mt-5 text-3xl font-bold tracking-tight text-[#17191E] sm:text-4xl">
            Built for candidates who take the search seriously.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base text-[#686F7B]">
            From career changers to senior engineers — here&apos;s what focused execution looks like.
          </p>
        </div>

        {/* Carousel */}
        <div className="relative mx-auto max-w-3xl">
          {/* Main card */}
          <div
            className={`rounded-3xl border border-[#DFE3E9] bg-black/[0.03] p-8 backdrop-blur-sm transition-opacity duration-180 sm:p-10 ${animating ? 'opacity-0' : 'opacity-100'}`}
          >
            <div className="mb-6 flex h-10 w-10 items-center justify-center rounded-xl border border-[#DFE3E9] bg-black/[0.05] text-[#686F7B]">
              <Quote className="h-5 w-5" />
            </div>

            <blockquote className="text-lg leading-8 text-[#3A4048] sm:text-xl sm:leading-9">
              &ldquo;{t.quote}&rdquo;
            </blockquote>

            <div className="mt-8 flex items-center gap-4">
              <div className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold ${t.accent}`}>
                {t.initials}
              </div>
              <div>
                <p className="text-sm font-semibold text-[#17191E]">{t.author}</p>
                <p className="text-sm text-[#686F7B]">{t.role} · {t.company}</p>
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="mt-8 flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={() => go(active - 1)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[#DFE3E9] bg-black/[0.04] text-[#686F7B] transition hover:bg-black/[0.05] hover:text-ink"
              aria-label="Previous testimonial"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>

            <div className="flex gap-2">
              {testimonials.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => go(i)}
                  className={`h-1.5 rounded-full transition-all duration-300 ${i === active ? 'w-6 bg-[#D4AF37]' : 'w-1.5 bg-black/[0.09] hover:bg-black/[0.12]'}`}
                  aria-label={`Go to testimonial ${i + 1}`}
                />
              ))}
            </div>

            <button
              type="button"
              onClick={() => go(active + 1)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[#DFE3E9] bg-black/[0.04] text-[#686F7B] transition hover:bg-black/[0.05] hover:text-ink"
              aria-label="Next testimonial"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

      </div>
    </section>
  );
}
