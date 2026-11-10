import Link from 'next/link';

const PARENT_COMPANY_URL = 'https://www.techiadigital.com';
const PARENT_COMPANY_NAME = 'teChia Digital Solutions';

const footerSections = [
  {
    title: 'Product',
    links: [
      { href: '/#features', label: 'Features' },
      { href: '/#workflow', label: 'Workflow' },
      { href: '/#faq', label: 'FAQ' },
    ],
  },
  {
    title: 'Explore',
    links: [
      { href: '/jobs-public', label: 'Public Jobs' },
      { href: '/demo', label: 'Product Overview' },
    ],
  },
  {
    title: 'Access',
    links: [
      { href: '/login', label: 'Sign In' },
      { href: '/register', label: 'Create Account' },
    ],
  },
] as const;

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="w-full max-w-full overflow-x-clip border-t border-line bg-background pb-24 md:pb-[max(1.25rem,env(safe-area-inset-bottom))]">
      <div className="shell w-full py-10 sm:py-12">
        <div className="grid w-full gap-10 sm:grid-cols-3 sm:gap-x-10 sm:gap-y-12 lg:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(0,1fr))] lg:gap-14">
          <div className="min-w-0 sm:col-span-3 lg:col-span-1">
            <p className="text-sm font-semibold tracking-[0.06em] text-accent-text">teChia Jobs</p>
            <h2 className="mt-3 max-w-xl text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
              The AI-powered operating system for your job search.
            </h2>
            <p className="mt-4 max-w-xl text-sm leading-7 text-muted sm:text-base">
              teChia Jobs brings scoring, prioritization, outreach, interview preparation, and
              follow-up workflows into one operating system for serious candidates.
            </p>
            <p className="mt-5 text-xs font-medium tracking-[0.04em] text-muted">
              A{' '}
              <a
                href={PARENT_COMPANY_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-text underline decoration-accent/50 underline-offset-4 transition hover:text-ink hover:decoration-accent"
              >
                {PARENT_COMPANY_NAME}
              </a>{' '}
              product
            </p>
          </div>

          {footerSections.map((section) => (
            <section key={section.title} className="min-w-0">
              <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-ink">
                {section.title}
              </h3>
              <div className="mt-4 grid w-fit gap-3 text-sm text-muted">
                {section.links.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="w-fit break-words transition hover:text-ink"
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="mt-10 border-t border-line pt-6 text-xs leading-6 text-muted">
          <p className="[overflow-wrap:anywhere]">
            © {year}{' '}
            <a
              href={PARENT_COMPANY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-ink underline decoration-accent/50 underline-offset-4 transition hover:decoration-accent"
            >
              {PARENT_COMPANY_NAME}
            </a>
            . teChia Jobs. All rights reserved.
          </p>
          <p className="mt-2 max-w-3xl">
            teChia Jobs is a workflow and decision-support platform. Users remain responsible for
            the accuracy of their application materials, communications, and compliance with the
            terms of third-party job platforms.
          </p>
        </div>
      </div>
    </footer>
  );
}
