import Link from 'next/link';
import { BrandMark } from '@/components/shared/brand-mark';

type LogoProps = {
  compact?: boolean;
  href?: string;
  showSubtitle?: boolean;
  centered?: boolean;
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
}: LogoProps) {
  if (compact) {
    return (
      <Link
        href={href}
        aria-label="teChia Jobs home"
        className={`inline-flex items-center gap-2 ${centered ? 'justify-center' : ''}`}
      >
        <BrandMark size={28} className="shrink-0" />
        <span className="text-base font-bold tracking-tight text-charcoal">
          teChia <span className="text-[#A8842C]">Jobs</span>
        </span>
      </Link>
    );
  }

  return (
    <Link
      href={href}
      aria-label="teChia Jobs home"
      className={`inline-flex flex-col items-center gap-2 ${centered ? 'mx-auto' : ''}`}
    >
      <span className="inline-flex items-center gap-2.5">
        <BrandMark size={36} className="shrink-0" />
        <span className="text-xl font-bold tracking-tight text-charcoal">
          teChia <span className="text-[#A8842C]">Jobs</span>
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