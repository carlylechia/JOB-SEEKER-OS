import Link from 'next/link';
import { ArrowRight, LayoutDashboard } from 'lucide-react';
import { Logo } from '@/components/shared/logo';
import { ThemeSwitch } from '@/components/shared/theme-switch';
import { LandingMobileMenu } from './landing-mobile-menu';
import { auth } from '@/auth';

const navLinks = [
  { href: '#features', label: 'Features' },
  { href: '#how-it-works', label: 'How It Works' },
  { href: '#public-jobs', label: 'Public Jobs' },
  { href: '#faq', label: 'FAQ' },
];

/**
 * Landing-page navigation.
 *
 * Rendered as a sibling of the page content rather than inside the hero: a
 * `position: sticky` element can only travel within its containing block, so a
 * nav nested in the `min-h-screen` hero unpins the moment the hero scrolls out.
 * `fixed` keeps it on screen for the whole document.
 */
export async function LandingNav() {
  const session = await auth();

  return (
    <header className="fixed inset-x-0 top-0 z-40 pt-4">
      <div className="shell">
        <div className="rounded-[28px] border border-line bg-[color:var(--nav-scrim)] px-4 py-3 shadow-nav backdrop-blur-2xl sm:px-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-4">
              {/* Mark only below sm so the pill nav fits small phones. */}
              <Logo compact hideTextOnSmall href="/" />
            </div>

            <nav className="hidden items-center gap-1 rounded-full border border-line bg-surface-sunken p-1 lg:flex">
              {navLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="rounded-full px-4 py-2 text-sm font-medium text-ink-2 transition hover:bg-surface-sunken-hover hover:text-ink"
                >
                  {link.label}
                </a>
              ))}
              <Link
                href="/jobs-public"
                className="rounded-full bg-surface-sunken px-4 py-2 text-sm font-semibold text-ink transition hover:bg-surface-sunken-hover"
              >
                Browse Public Jobs
              </Link>
            </nav>

            <div className="hidden shrink-0 items-center gap-2.5 md:flex">
              <ThemeSwitch size="sm" />
              {session?.user ? (
                <Link
                  href="/dashboard"
                  className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink shadow-[0_10px_32px_rgb(var(--accent)/0.28)] transition hover:bg-accent-hover"
                >
                  <LayoutDashboard className="h-3.5 w-3.5" />
                  Go to Dashboard
                </Link>
              ) : (
                <>
                  <Link
                    href="/login"
                    className="inline-flex items-center rounded-full border border-line bg-surface-sunken px-4 py-2 text-sm font-medium text-ink-2 transition hover:bg-surface-sunken-hover hover:text-ink"
                  >
                    Sign In
                  </Link>
                  <Link
                    href="/register"
                    className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink shadow-[0_10px_32px_rgb(var(--accent)/0.28)] transition hover:bg-accent-hover"
                  >
                    Start free
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-2 md:hidden">
              <ThemeSwitch size="xs" className="sm:hidden" />
              <ThemeSwitch size="sm" className="hidden sm:flex" />
              <LandingMobileMenu isSignedIn={!!session?.user} />
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}