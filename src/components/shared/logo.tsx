import Link from 'next/link';
import { BrandMark } from '@/components/shared/brand-mark';

type LogoProps = {
  compact?: boolean;
  href?: string;
  showSubtitle?: boolean;
  centered?: boolean;
  /**
   * Drop the wordmark below the `sm` breakpoint so a navbar keeps the brand
   * mark without crowding small screens. The link is labelled for screen
   * readers either way, so nothing is announced twice or lost.
   */
  hideTextOnSmall?: boolean;
};

/**
 * teChia Jobs logo lockup — brand mark + wordmark.
 * Single source of truth for the product logo across the app.
 */
export function Logo({
  compact = false,
  href = '/',
  showSubtitle = false,
  centered = false,
  hideTextOnSmall = false,
}: LogoProps) {
  const wordmark = hideTextOnSmall
    ? 'hidden sm:inline'
    : 'inline';
  const markSize = hideTextOnSmall ? 30 : compact ? 28 : 36;

  if (compact) {
    return (
      <Link
        href={href}
        aria-label="teChia Jobs home"
        className={`inline-flex min-w-0 items-center gap-2 ${centered ? 'justify-center' : ''}`}
      >
        <BrandMark size={markSize} className="shrink-0" />
        <span className={`text-base font-bold tracking-tight text-ink ${wordmark}`}>
          teChia <span className="text-accent-text">Jobs</span>
        </span>
      </Link>
    );
  }

  return (
    <Link
      href={href}
      aria-label="teChia Jobs home"
      className={`inline-flex min-w-0 flex-col items-center gap-2 ${centered ? 'mx-auto' : ''}`}
    >
      <span className="inline-flex min-w-0 items-center gap-2.5">
        <BrandMark size={markSize} className="shrink-0" />
        <span className={`font-bold tracking-tight text-ink ${hideTextOnSmall ? 'text-lg sm:text-xl' : 'text-xl'} ${wordmark}`}>
          teChia <span className="text-accent-text">Jobs</span>
        </span>
      </span>
      {showSubtitle ? (
        <span className="hidden max-w-48 text-center text-xs text-muted md:block">
          A teChia Digital Solutions product
        </span>
      ) : null}
    </Link>
  );
}