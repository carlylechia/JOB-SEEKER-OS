import { Suspense } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { LandingHero } from '@/components/marketing/landing-hero';
import { LandingNav } from '@/components/marketing/landing-nav';
import { LandingFeatureMarquee } from '@/components/marketing/landing-feature-marquee';
import { LandingStats } from '@/components/marketing/landing-stats';
import { LandingHowItWorks } from '@/components/marketing/landing-how-it-works';
import { LandingDashboardPreview } from '@/components/marketing/landing-dashboard-preview';
import { LandingFaq } from '@/components/marketing/landing-faq';
import { LandingCta } from '@/components/marketing/landing-cta';
import { SiteFooter } from '@/components/marketing/site-footer';
import { PlatformJobsPreview } from '@/components/marketing/platform-jobs-preview';
import { QuickJumpNav } from '@/components/marketing/quick-jump-nav';

function LandingStatsFallback() {
  return (
    <section className="w-full min-w-0 py-12 sm:py-16">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 lg:gap-5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-line bg-card p-5 shadow-soft sm:p-6">
            <div className="h-9 w-24 rounded bg-surface-sunken animate-pulse" />
            <div className="mt-3 h-4 w-28 rounded bg-surface-sunken animate-pulse" />
            <div className="mt-2 h-3 w-32 rounded bg-surface-sunken animate-pulse" />
          </div>
        ))}
      </div>
    </section>
  );
}

function PlatformJobsPreviewFallback() {
  return (
    <section id="public-jobs" className="py-20">
      <div className="grid gap-8 rounded-3xl border border-line bg-surface-sunken p-5 lg:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)] lg:p-7">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent-text">Platform Jobs</p>
          <h2 className="mt-4 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            Explore jobs that platform users are actively capturing and working through.
          </h2>
          <p className="mt-4 max-w-xl text-sm leading-7 text-muted sm:text-base">
            A few recent opportunities already being tracked across the platform. Browse more, save what fits, and move it
            into your own workflow.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link className="btn-primary gap-2" href="/jobs-public">
              View more public jobs <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-line bg-surface-sunken p-4">
              <div className="h-4 w-2/3 rounded bg-surface-sunken animate-pulse" />
              <div className="mt-3 h-3 w-1/2 rounded bg-surface-sunken animate-pulse" />
              <div className="mt-6 h-3 w-3/4 rounded bg-surface-sunken animate-pulse" />
              <div className="mt-2 h-3 w-1/3 rounded bg-surface-sunken animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function LandingPage() {
  return (
    <>
      {/* Nav is a sibling of the content, not a child of the hero, so it stays
          pinned for the whole document instead of unpinning with the hero. */}
      <LandingNav />
      {/* The landing document owns its horizontal overflow. `overflow-x-clip`
          (rather than `hidden`) prevents a wide card track from widening the
          mobile viewport without turning this wrapper into a scroll container,
          which would break the sticky section headers inside it. */}
      <div className="relative w-full overflow-x-clip">
        {/* Full-viewport hero with its own nav */}
        <LandingHero />

        {/* Single feature marquee directly beneath the hero. */}
        <LandingFeatureMarquee />

        {/* Animated catalog metrics directly beneath the marquee. */}
        <div className="shell">
          <Suspense fallback={<LandingStatsFallback />}>
            <LandingStats />
          </Suspense>
        </div>

        {/* Remaining sections inside centered shell */}
        <div className="shell">
          <LandingHowItWorks />
          <LandingDashboardPreview />
          <Suspense fallback={<PlatformJobsPreviewFallback />}>
            <PlatformJobsPreview />
          </Suspense>

          <LandingFaq />
          <LandingCta />
        </div>

        <QuickJumpNav />
        <SiteFooter />
      </div>
    </>
  );
}