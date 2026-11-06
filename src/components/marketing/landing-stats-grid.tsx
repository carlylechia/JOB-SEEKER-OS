'use client';

import { useEffect, useRef, useState } from 'react';

export type LandingStatItem = {
  label: string;
  value: number;
  caption?: string;
};

type StatCardProps = {
  item: LandingStatItem;
  started: boolean;
  index: number;
};

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function StatCard({ item, started, index }: StatCardProps) {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!started) return;

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReduced) {
      setDisplay(item.value);
      return;
    }

    const final = item.value;
    const duration = 1500 + index * 140;
    let displayed = 0;
    const startAt = performance.now();

    const run = () => {
      const tick = (now: number) => {
        const progress = Math.min(1, (now - startAt) / duration);
        // Ease-out cubic for a natural deceleration.
        const eased = 1 - Math.pow(1 - progress, 3);
        const easedTarget = Math.round(eased * final);

        if (displayed < easedTarget) {
          const remaining = easedTarget - displayed;
          // Random, non-uniform increments so the value appears to "load".
          const step = Math.max(
            1,
            Math.round(Math.random() * Math.max(1, remaining * 0.4) + 1),
          );
          displayed = Math.min(easedTarget, displayed + step);
        }

        if (progress >= 1) {
          displayed = final;
        }

        setDisplay(displayed);

        if (progress < 1 || displayed < final) {
          rafRef.current = requestAnimationFrame(tick);
        }
      };
      rafRef.current = requestAnimationFrame(tick);
    };

    timerRef.current = setTimeout(run, index * 110);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [started, item.value, index]);

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-line bg-card p-5 shadow-soft transition duration-300 hover:-translate-y-0.5 hover:shadow-lift sm:p-6">
      <div
        className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-accent/[0.06] blur-2xl transition group-hover:bg-accent/[0.10]"
        aria-hidden
      />
      <p className="relative text-3xl font-semibold tracking-tight text-ink tabular-nums sm:text-4xl">
        {formatNumber(display)}
      </p>
      <p className="relative mt-2 text-sm font-semibold text-ink">{item.label}</p>
      {item.caption ? (
        <p className="relative mt-1 text-xs leading-5 text-muted">{item.caption}</p>
      ) : null}
    </div>
  );
}

export function LandingStatsGrid({ items }: { items: LandingStatItem[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReduced) {
      setStarted(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setStarted(true);
          observer.disconnect();
        }
      },
      { threshold: 0.25, rootMargin: '0px 0px -10% 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 lg:gap-5"
    >
      {items.map((item, index) => (
        <StatCard key={item.label} item={item} started={started} index={index} />
      ))}
    </div>
  );
}
