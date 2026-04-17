'use client';

import dynamic from 'next/dynamic';

type SpinnerHeroClientProps = {
  className?: string;
};

const SpinnerHero = dynamic(() => import('@/components/marketing/spinner-hero').then((m) => m.default), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center min-h-[300px]" aria-hidden>
      <div className="h-[300px] w-[300px] rounded-full border border-white/10 bg-white/[0.03]" />
    </div>
  ),
});

export function SpinnerHeroClient({ className }: SpinnerHeroClientProps) {
  return <SpinnerHero className={className} />;
}
