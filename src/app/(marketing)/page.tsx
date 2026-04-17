import { Suspense } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { LandingHero } from '@/components/marketing/landing-hero';
import { LandingFeatures } from '@/components/marketing/landing-features';
import { LandingHowItWorks } from '@/components/marketing/landing-how-it-works';
import { LandingDashboardPreview } from '@/components/marketing/landing-dashboard-preview';
import { LandingTestimonials } from '@/components/marketing/landing-testimonials';
import { LandingFaq } from '@/components/marketing/landing-faq';
import { LandingCta } from '@/components/marketing/landing-cta';
import { SiteFooter } from '@/components/marketing/site-footer';
import { PlatformJobsPreview } from '@/components/marketing/platform-jobs-preview';
import { QuickJumpNav } from '@/components/marketing/quick-jump-nav';

function PlatformJobsPreviewFallback() {
  return (
    <section id="public-jobs" className="py-20">
      <div className="grid gap-8 rounded-3xl border border-white/[0.08] bg-white/[0.03] p-5 lg:grid-cols-[0.88fr_1.12fr] lg:p-7">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-400">Platform Jobs</p>
          <h2 className="mt-4 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Explore jobs that platform users are actively capturing and working through.
          </h2>
          <p className="mt-4 max-w-xl text-sm leading-7 text-slate-400 sm:text-base">
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
            <div key={i} className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4">
              <div className="h-4 w-2/3 rounded bg-white/10 animate-pulse" />
              <div className="mt-3 h-3 w-1/2 rounded bg-white/10 animate-pulse" />
              <div className="mt-6 h-3 w-3/4 rounded bg-white/10 animate-pulse" />
              <div className="mt-2 h-3 w-1/3 rounded bg-white/10 animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function LandingPage() {
  return (
    <div className="relative overflow-x-hidden">
      {/* Full-viewport hero with its own nav */}
      <LandingHero />

      {/* Remaining sections inside centered shell */}
      <div className="shell">
        <LandingFeatures />
        <LandingHowItWorks />
        <LandingDashboardPreview />
        <LandingTestimonials />

        <Suspense fallback={<PlatformJobsPreviewFallback />}>
          <PlatformJobsPreview />
        </Suspense>

        <LandingFaq />
        <LandingCta />
      </div>

      <QuickJumpNav />
      <SiteFooter />
    </div>
  );
}