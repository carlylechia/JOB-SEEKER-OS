import Link from 'next/link';

const productLinks = [
  { href: '/#features', label: 'Features' },
  { href: '/#workflow', label: 'Workflow' },
  { href: '/#faq', label: 'FAQ' },
  { href: '/demo', label: 'Product Overview' },
];

const accountLinks = [
  { href: '/login', label: 'Sign In' },
  { href: '/register', label: 'Create Account' },
];

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-white/10 bg-[#07101d]">
      <div className="shell py-12 sm:py-14">
        <div className="grid gap-10 lg:grid-cols-[1.2fr_0.8fr_0.8fr]">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-300">Job Seeker OS</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
              A more disciplined way to run the modern job search.
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-muted sm:text-base">
              Job Seeker OS brings scoring, prioritization, outreach, interview preparation, and follow-up workflows into
              one cleaner operating system for serious candidates.
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-ink">Product</h3>
            <div className="mt-4 grid gap-3 text-sm text-muted">
              {productLinks.map((link) => (
                <Link key={link.href} href={link.href} className="transition hover:text-ink">
                  {link.label}
                </Link>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-ink">Access</h3>
            <div className="mt-4 grid gap-3 text-sm text-muted">
              {accountLinks.map((link) => (
                <Link key={link.href} href={link.href} className="transition hover:text-ink">
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-10 grid gap-4 border-t border-white/10 pt-6 text-xs leading-6 text-muted sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <p>© {year} Job Seeker OS. All rights reserved.</p>
            <p className="mt-2 max-w-3xl">
              Job Seeker OS is a workflow and decision-support platform. Users remain responsible for the accuracy of
              their application materials, communications, and compliance with the terms of third-party job platforms.
            </p>
          </div>
          <div className="sm:text-right">
            <p>Built with a server-first public experience, performance-conscious media, and a production-ready app core.</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
