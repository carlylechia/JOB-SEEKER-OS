import { Star } from 'lucide-react';
import { FEATURE_SHOWCASE } from './feature-showcase-data';

/**
 * A single, thin, endlessly scrolling marquee of the product's core features.
 *
 * Replaces both the old hero feature track and the full landing feature slider.
 * Content is duplicated so the CSS loop is seamless; the second copy is hidden
 * from assistive tech. Hover/focus pauses the animation; reduced-motion users
 * get a static, horizontally scrollable strip instead.
 */
export function LandingFeatureMarquee() {
  return (
    <section
      id="features"
      aria-label="Core teChia Jobs features"
      className="landing-marquee relative w-full overflow-hidden border-y border-line bg-surface-sunken/60 py-3.5"
    >
      <div className="landing-marquee-track flex w-max items-center gap-7 px-6 sm:gap-9 sm:px-8">
        {[0, 1].map((copy) => (
          <div
            key={copy}
            className="flex shrink-0 items-center gap-7 sm:gap-9"
            aria-hidden={copy === 1}
          >
            {FEATURE_SHOWCASE.map((feature) => {
              const Icon = feature.icon;
              return (
                <span
                  key={feature.title}
                  className="flex shrink-0 items-center gap-2.5 whitespace-nowrap"
                >
                  <Icon className={`h-4 w-4 ${feature.accent}`} aria-hidden />
                  <span className="text-sm font-medium tracking-tight text-ink">
                    {feature.shortTitle}
                  </span>
                  <Star
                    className="h-3 w-3 fill-accent/40 text-accent/60"
                    aria-hidden
                  />
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}
