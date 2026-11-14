'use client';

import dynamic from 'next/dynamic';

type SpinnerHeroClientProps = {
  className?: string;
};

import { BrandLoader } from '@/components/shared/brand-loader';

const SpinnerHero = dynamic(() => import('@/components/marketing/spinner-hero').then((m) => m.default), {
  ssr: false,
  loading: () => <BrandLoader className="!min-h-[300px]" message="Loading 3D preview" />,
});

export function SpinnerHeroClient({ className }: SpinnerHeroClientProps) {
  return <SpinnerHero className={className} />;
}
