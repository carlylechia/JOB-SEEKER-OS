import { ArrowRight } from 'lucide-react';
import { HERO_FEATURES } from './feature-showcase-data';

/**
 * Compact feature track that sits directly beneath the interactive spinner on
 * mobile. It deliberately scrolls horizontally at every breakpoint so the hero
 * never turns into a tall vertical list of capabilities.
 */
export function HeroFeatureTrack() {
  return (
    <section aria-labelledby="hero-features-heading" className="w-full min-w-0">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p
            id="hero-features-heading"
            className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent-text"
          >
            Key features
          </p>
          <p className="mt-1 text-sm text-muted">
            Swipe through the workflow — everything is connected.
          </p>
        </div>
        <span className="hidden items-center gap-1.5 text-xs font-medium text-muted sm:inline-flex">
          Scroll to explore <ArrowRight className="h-3.5 w-3.5" />
        </span>
      </div>

      <div
        className="mt-4 flex w-full overflow-x-auto snap-x snap-mandatory no-scrollbar gap-3 overscroll-x-contain scroll-px-4 pb-2"
        role="list"
        aria-label="Core teChia Jobs features"
      >
        {HERO_FEATURES.map((feature) => {
          const Icon = feature.icon;
          return (
            <article
              key={feature.title}
              role="listitem"
              className={`group w-[76vw] max-w-[18rem] shrink-0 snap-start rounded-2xl border border-line bg-card p-4 shadow-soft transition duration-300 hover:-translate-y-0.5 hover:shadow-lift ${feature.border} sm:w-64 lg:w-[17.5rem]`}
            >
              <div
                className={`inline-flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-surface-sunken ${feature.accent}`}
              >
                <Icon className="h-4 w-4" />
              </div>
              <h3 className="mt-3 text-sm font-semibold leading-5 text-ink">{feature.title}</h3>
              <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-muted">
                {feature.description}
              </p>
            </article>
          );
        })}
      </div>
    </section>
  );
}
