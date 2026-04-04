'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { ChevronLeft, ChevronRight } from 'lucide-react';

type Slide = {
  eyebrow: string;
  title: string;
  description: string;
  image: string;
  alt: string;
  accent: string;
};

const slides: Slide[] = [
  {
    eyebrow: 'Run the search with clarity',
    title: 'See the dashboard that tells you what deserves effort next.',
    description:
      'Track best-fit roles, follow-ups, interviews, and momentum in one calm operating view instead of scattered tabs and guesswork.',
    image: '/marketing/hero-dashboard.png',
    alt: 'Job Seeker OS dashboard preview with fit metrics and queue prioritization',
    accent: 'From scattered to structured',
  },
  {
    eyebrow: 'Work each role like a system',
    title: 'Turn every opportunity into a detailed workspace, not just a row in a tracker.',
    description:
      'Save context, update status, keep notes, prep for conversations, and move through the search with much less friction.',
    image: '/marketing/workspace-preview.png',
    alt: 'Job Seeker OS workspace preview for managing a single role',
    accent: 'Role-by-role execution',
  },
  {
    eyebrow: 'Prioritize with confidence',
    title: 'Use personalized fit logic to focus on the roles most worth your time.',
    description:
      'Queue higher-quality opportunities first, avoid blind applications, and create a more disciplined search rhythm around real fit.',
    image: '/marketing/queue-preview.png',
    alt: 'Job Seeker OS priority queue preview showing ranked opportunities',
    accent: 'Personalized ranking',
  },
];

export function HeroCarousel() {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeSlide = useMemo(() => slides[activeIndex], [activeIndex]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % slides.length);
    }, 5200);

    return () => window.clearInterval(timer);
  }, []);

  function goTo(index: number) {
    setActiveIndex(index);
  }

  function goPrev() {
    setActiveIndex((current) => (current - 1 + slides.length) % slides.length);
  }

  function goNext() {
    setActiveIndex((current) => (current + 1) % slides.length);
  }

  return (
    <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(8,17,31,0.92),rgba(10,20,39,0.96))] p-4 shadow-soft sm:p-5">
      <div className="pointer-events-none absolute inset-x-10 top-0 h-32 rounded-full bg-sky-500/10 blur-3xl" />
      <div className="pointer-events-none absolute -right-12 bottom-8 h-40 w-40 rounded-full bg-indigo-500/15 blur-3xl" />

      <div className="relative rounded-[1.5rem] border border-white/10 bg-white/5 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#0d1628] px-4 py-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-300">
              {activeSlide.eyebrow}
            </p>
            <h3 className="mt-2 max-w-2xl text-xl font-semibold tracking-tight text-ink sm:text-2xl">
              {activeSlide.title}
            </h3>
          </div>
          <span className="inline-flex rounded-full border border-sky-400/30 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-100">
            {activeSlide.accent}
          </span>
        </div>

        <p className="mt-4 max-w-2xl text-sm leading-7 text-muted sm:text-base">
          {activeSlide.description}
        </p>

        <div className="mt-5 overflow-hidden rounded-[1.4rem] border border-white/10 bg-[#09111f]">
          <Image
            src={activeSlide.image}
            alt={activeSlide.alt}
            width={1600}
            height={1000}
            priority={activeIndex === 0}
            sizes="(min-width: 1280px) 42vw, (min-width: 1024px) 48vw, 100vw"
            className="h-auto w-full"
          />
        </div>

        <div className="mt-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            {slides.map((slide, index) => (
              <button
                key={slide.title}
                type="button"
                onClick={() => goTo(index)}
                aria-label={`Go to slide ${index + 1}`}
                aria-pressed={activeIndex === index}
                className={`h-2.5 rounded-full transition-all ${
                  activeIndex === index ? 'w-8 bg-sky-300' : 'w-2.5 bg-white/25 hover:bg-white/40'
                }`}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={goPrev}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-ink transition hover:bg-white/10"
              aria-label="Previous slide"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={goNext}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-ink transition hover:bg-white/10"
              aria-label="Next slide"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
