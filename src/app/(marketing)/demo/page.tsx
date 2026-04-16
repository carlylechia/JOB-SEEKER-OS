import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Logo } from '@/components/shared/logo';
import { LandingMobileMenu } from '@/components/marketing/landing-mobile-menu';
import { ProductOverviewClient } from '@/components/marketing/product-overview-client';
import { SiteFooter } from '@/components/marketing/site-footer';

const navLinks = [
  { href: '/#features', label: 'Features' },
  { href: '/#how-it-works', label: 'How It Works' },
  { href: '/jobs-public', label: 'Public Jobs' },
  { href: '/#faq', label: 'FAQ' },
];

export const metadata = {
  title: 'Product Overview — Job Seeker OS',
  description:
    'A full walkthrough of every tool inside Job Seeker OS: AI scoring, daily queue, pipeline, recruiter CRM, interview prep, and more.',
};

export default function DemoPage() {
  return (
    <div className="relative overflow-x-hidden">
      {/* ── Nav ── */}
      <header className="shell pt-5">
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-[#08111f]/80 px-4 py-3 backdrop-blur-xl sm:px-6">
          <Logo showSubtitle href="/" />
          <nav className="hidden items-center gap-6 xl:flex">
            {navLinks.map((link) => (
              <Link key={link.href} href={link.href} className="text-sm text-muted transition-colors hover:text-ink">
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="hidden items-center gap-3 md:flex">
            <Link className="btn-secondary" href="/login">Sign In</Link>
            <Link className="btn-primary" href="/register">Get Started</Link>
          </div>
          <LandingMobileMenu />
        </div>
      </header>

      {/* ── Page header ── */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[400px] bg-[radial-gradient(ellipse_at_top_right,rgba(6,182,212,0.1),transparent_50%),radial-gradient(ellipse_at_top_left,rgba(99,102,241,0.08),transparent_45%)]" aria-hidden />

      <div className="shell relative pt-14 pb-4">
        <div className="max-w-3xl">
          <Link href="/" className="inline-flex items-center gap-2 text-xs text-slate-500 hover:text-slate-300 transition-colors mb-6">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to home
          </Link>
          <span className="inline-flex items-center gap-2 rounded-full border border-cyan-500/25 bg-cyan-500/[0.08] px-3 py-1.5 text-xs font-semibold text-cyan-300 mb-5">
            Product Overview
          </span>
          <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
            Every tool, explained.
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-300/80">
            Job Seeker OS is a complete operating system for the job search — AI scoring, a smart daily queue, pipeline tracking, recruiter CRM, interview prep, and engagement features, all wired together into one coherent workflow.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/register" className="btn-primary gap-2">
              Create free workspace
            </Link>
            <Link href="/login" className="btn-secondary">
              Sign in
            </Link>
          </div>
        </div>
      </div>

      {/* ── All feature sections ── */}
      <div className="shell">
        <ProductOverviewClient />
      </div>

      <SiteFooter />
    </div>
  );
}

