import Link from 'next/link';
import { ArrowRight, CheckCircle2, Sparkles } from 'lucide-react';
import { Logo } from '@/components/shared/logo';
import { LandingMobileMenu } from '@/components/marketing/landing-mobile-menu';
import { HeroProductPreview } from '@/components/marketing/hero-product-preview';
import { FeatureBentoGrid } from '@/components/marketing/feature-bento-grid';
import { WorkflowSection } from '@/components/marketing/workflow-section';
import { PersonalizationSection } from '@/components/marketing/personalization-section';
import { FutureIntelligenceSection } from '@/components/marketing/future-intelligence-section';
import { LandingFaq } from '@/components/marketing/landing-faq';
import { DemoVideo } from '@/components/marketing/demo-video';

const navLinks = [
  { href: '#features', label: 'Features' },
  { href: '#workflow', label: 'Workflow' },
  { href: '#faq', label: 'FAQ' },
];

const heroBullets = [
  'Capture jobs, contacts, and prep in one workspace',
  'Prioritize what to apply to based on personal fit',
  'Replace scattered docs, tabs, and trackers with one system',
];

const signalChips = ['SEO-conscious build', 'Database-backed workflows', 'Production-ready foundation'];

export default function LandingPage() {
  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[540px] bg-[radial-gradient(circle_at_top_right,rgba(79,140,255,0.14),transparent_38%),radial-gradient(circle_at_top_left,rgba(99,102,241,0.12),transparent_32%)]" />
      <div className="shell relative py-8 sm:py-12">
        <header className="sticky top-0 z-20 rounded-2xl border border-white/10 bg-[#08111f]/70 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-[#08111f]/60 sm:px-5">
          <div className="flex items-center justify-between gap-4">
            <Logo showSubtitle href="/" />

            <nav className="hidden items-center gap-6 xl:flex">
              {navLinks.map((link) => (
                <Link key={link.href} href={link.href} className="text-sm text-muted transition hover:text-ink">
                  {link.label}
                </Link>
              ))}
            </nav>

            <div className="hidden items-center gap-3 md:flex">
              <Link className="btn-secondary" href="/demo">
                Live Demo
              </Link>
              <Link className="btn-secondary" href="/login">
                Sign In
              </Link>
              <Link className="btn-primary" href="/register">
                Create Account
              </Link>
            </div>

            <LandingMobileMenu />
          </div>
        </header>

        <section className="grid gap-12 py-16 lg:grid-cols-[1.02fr_0.98fr] lg:items-center lg:py-24">
          <div>
            <span className="badge bg-accent/15 text-sky-200">A more serious way to run the search</span>
            <h1 className="mt-6 max-w-4xl text-4xl font-semibold leading-tight text-ink sm:text-5xl xl:text-6xl">
              The operating system for candidates who want clearer decisions, calmer execution, and better outcomes.
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-8 text-muted sm:text-lg">
              Job Seeker OS transforms the job hunt from a scattered collection of links, notes, and reminders into one
              focused workflow: scoring, prioritization, outreach, follow-ups, interview prep, and execution.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link className="btn-primary gap-2" href="/register">
                Create your workspace
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link className="btn-secondary" href="/demo">
                Watch the product walkthrough
              </Link>
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-1">
              {heroBullets.map((bullet) => (
                <div key={bullet} className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 text-sky-300" />
                  <p className="text-sm leading-7 text-slate-200">{bullet}</p>
                </div>
              ))}
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              {signalChips.map((chip) => (
                <span key={chip} className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-muted">
                  <Sparkles className="mr-2 h-3.5 w-3.5 text-sky-300" />
                  {chip}
                </span>
              ))}
            </div>
          </div>

          <HeroProductPreview />
        </section>

        <section className="py-8 sm:py-10">
          <div className="grid gap-4 rounded-[2rem] border border-white/10 bg-white/5 p-5 shadow-soft lg:grid-cols-[0.95fr_1.05fr] lg:p-7">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-300">See it in motion</p>
              <h2 className="mt-4 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
                A product demo built to feel like the real app, not a static placeholder.
              </h2>
              <p className="mt-4 max-w-xl text-sm leading-7 text-muted sm:text-base">
                This lightweight motion preview shows the dashboard, scoring workflow, and queue system without blocking the
                rest of the page. It is lazy-loaded for better performance and designed to give visitors a faster sense of
                how the product works.
              </p>
            </div>
            <DemoVideo />
          </div>
        </section>

        <FeatureBentoGrid />
        <WorkflowSection />
        <PersonalizationSection />
        <FutureIntelligenceSection />
        <LandingFaq />

        <section className="py-24">
          <div className="card-pad overflow-hidden bg-[linear-gradient(135deg,rgba(79,140,255,0.16),rgba(99,102,241,0.1))]">
            <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
              <div>
                <span className="badge bg-white/10 text-sky-100">Ready to stop job hunting blindly?</span>
                <h2 className="mt-4 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
                  Move from scattered applications to a disciplined, decision-friendly workflow.
                </h2>
                <p className="mt-4 max-w-2xl text-base leading-7 text-slate-200/85 sm:text-lg">
                  Set up your workspace, tailor your preferences, and start running your search with more clarity, less
                  friction, and better visibility into what deserves effort.
                </p>
              </div>

              <div className="flex flex-wrap gap-3 lg:justify-end">
                <Link className="btn-primary" href="/register">
                  Create Account
                </Link>
                <Link className="btn-secondary" href="/login">
                  Sign In
                </Link>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
