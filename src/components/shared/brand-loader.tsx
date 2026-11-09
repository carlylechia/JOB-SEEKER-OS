import { BrandMark } from '@/components/shared/brand-mark';

type BrandLoaderProps = {
  /**
   * `full` fills a route/panel with the complete brand moment.
   * `inline` is the compact companion for buttons, cards and in-place fetches.
   */
  variant?: 'full' | 'inline';
  message?: string;
  className?: string;
};

/**
 * Branded loading experience shared by route boundaries and in-page fetches.
 *
 * It deliberately uses the real SVG brand mark, a single quiet orbit, the
 * wordmark and a lime progress rail instead of a generic spinner. Animations
 * are transform/opacity only and collapse to a still frame under
 * `prefers-reduced-motion`.
 */
export function BrandLoader({
  variant = 'full',
  message = 'Preparing your workspace',
  className = '',
}: BrandLoaderProps) {
  if (variant === 'inline') {
    return (
      <span
        role="status"
        aria-live="polite"
        className={`inline-flex items-center gap-2 align-middle ${className}`}
      >
        <span className="relative inline-flex items-center justify-center">
          <BrandMark size={20} />
          <span
            aria-hidden="true"
            className="brand-loader-dot absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-accent ring-2 ring-card"
          />
        </span>
        <span className={message ? 'text-sm text-muted' : 'sr-only'}>{message || 'Loading'}</span>
      </span>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex min-h-[55vh] w-full items-center justify-center px-4 py-12 ${className}`}
    >
      <div className="relative w-full max-w-sm text-center">
        <div
          aria-hidden="true"
          className="ambient-orb absolute left-1/2 top-2 h-24 w-36 -translate-x-1/2 opacity-50"
        />

        <div className="relative mx-auto flex h-20 w-20 items-center justify-center">
          <span
            aria-hidden="true"
            className="brand-loader-glow absolute inset-1 rounded-full bg-accent/30 blur-xl"
          />
          <span
            aria-hidden="true"
            className="brand-loader-orbit absolute -inset-1 rounded-full border border-line border-r-transparent border-t-accent"
          />
          <span className="relative rounded-2xl border border-line bg-card p-1.5 shadow-lift">
            <BrandMark size={50} />
          </span>
        </div>

        <p className="mt-6 font-display text-2xl font-semibold text-ink">
          teChia <span className="text-accent-text">Jobs</span>
        </p>
        <p className="mt-1 text-sm text-muted">{message}</p>

        <div
          aria-hidden="true"
          className="brand-loader-rail relative mx-auto mt-5 h-1 w-40 overflow-hidden rounded-full bg-surface-sunken"
        />
      </div>
    </div>
  );
}
