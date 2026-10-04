'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';

function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold: 0.12 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return { ref, visible };
}

export function LandingCta() {
  const { ref, visible } = useReveal();

  return (
    <section className="py-24">
      <div
        ref={ref}
        className={`reveal-hidden relative overflow-hidden rounded-3xl border border-[#DFE3E9] bg-gradient-to-br from-[#F1F2F5] via-[#FAFAF7] to-[#FFFFFF] p-10 text-center shadow-[0_32px_80px_rgba(17,19,24,0.1)] sm:p-16 ${visible ? 'reveal-visible' : ''}`}
      >
        {/* Background orbs */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
          <div className="orb-drift-1 absolute -top-20 -right-20 h-[320px] w-[320px] rounded-full bg-[#D4AF37]/[0.1] blur-[80px]" />
          <div className="orb-drift-2 absolute -bottom-20 -left-20 h-[280px] w-[280px] rounded-full bg-[#C9CED6]/30 blur-[70px]" />
        </div>

        {/* Subtle grid */}
        <div
          className="pointer-events-none absolute inset-0 opacity-20"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(99,179,237,0.08) 1px, transparent 1px)',
            backgroundSize: '32px 32px',
          }}
          aria-hidden
        />

        <div className="relative">
          <span className="inline-flex items-center gap-2 rounded-full border border-[#D4AF37]/30 bg-[#D4AF37]/10 px-3 py-1.5 text-xs font-semibold text-[#8A6D1F]">
            <Sparkles className="h-3 w-3" />
            Start today — it&apos;s free
          </span>

          <h2 className="mx-auto mt-6 max-w-2xl text-3xl font-bold tracking-tight text-[#17191E] sm:text-4xl lg:text-[2.75rem]">
            Stop running your search in scattered notes.{' '}
            <span className="shimmer-text">Start running it like a system.</span>
          </h2>

          <p className="mx-auto mt-5 max-w-xl text-base leading-7 text-[#4A505A]/80 sm:text-lg">
            Create your free workspace, configure your fit preferences, and have your first AI-scored job
            queue ready in under 10 minutes.
          </p>

          <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link
              href="/register"
              className="btn-primary gap-2 px-7 py-3 text-base shadow-xl shadow-accent/25"
            >
              Create your workspace — it&apos;s free
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/demo" className="btn-secondary px-7 py-3 text-base">
              See it in action first
            </Link>
          </div>

          <p className="mt-6 text-xs text-[#686F7B]">
            No credit card required · Takes under 2 minutes · Cancel anytime
          </p>
        </div>
      </div>
    </section>
  );
}
