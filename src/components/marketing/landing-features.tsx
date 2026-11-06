import { ArrowRight, Zap } from 'lucide-react';
import { FEATURE_SHOWCASE } from './feature-showcase-data';

function FeatureCard({ feature }: { feature: (typeof FEATURE_SHOWCASE)[number] }) {
  const Icon = feature.icon;

  return (
    <article
      role="listitem"
      className={`group flex w-[78vw] max-w-[20rem] shrink-0 snap-start flex-col rounded-2xl border border-line bg-card p-5 shadow-soft transition duration-300 hover:-translate-y-0.5 hover:shadow-lift ${feature.border} sm:w-[19rem] lg:w-[21rem]`}
    >
      <div
        className={`mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface-sunken ${feature.accent}`}
      >
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="text-base font-semibold text-ink">{feature.title}</h3>
      <p className="mt-2 text-sm leading-6 text-muted">{feature.description}</p>
    </article>
  );
}

export function LandingFeatures() {
  return (
    <section id="features" className="w-full min-w-0 py-20 sm:py-24">
      <div className="text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/[0.08] px-3 py-1.5 text-xs font-semibold text-accent-text">
          <Zap className="h-3 w-3" /> Everything you need
        </span>
        <h2 className="mt-5 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
          One platform. Every layer of the search.
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-muted">
          Purpose-built tools that work together — from the first job capture to the final offer. No
          external spreadsheets, no forgotten follow-ups.
        </p>
      </div>

      <div className="relative mt-10 w-full min-w-0">
        <div
          className="flex w-full overflow-x-auto snap-x snap-mandatory no-scrollbar gap-4 overscroll-x-contain scroll-px-4 pb-4"
          role="list"
          aria-label="All teChia Jobs features"
        >
          {FEATURE_SHOWCASE.map((feature) => (
            <FeatureCard key={feature.title} feature={feature} />
          ))}
        </div>
        <div className="mt-2 flex items-center justify-center gap-1.5 text-xs text-muted sm:hidden">
          Swipe to see every feature <ArrowRight className="h-3.5 w-3.5" />
        </div>
      </div>
    </section>
  );
}
