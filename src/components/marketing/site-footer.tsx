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
    <footer className="w-full max-w-full overflow-x-clip border-t border-line bg-background pb-[max(1.25rem,env(safe-area-inset-bottom))]">
      <div className="shell w-full py-10 sm:py-12">
        <div className="grid w-full gap-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_minmax(0,0.65fr)]">
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-[0.06em] text-accent-text">teChia Jobs</p>
            <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
              The AI-powered operating system for your job search.
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-muted sm:text-base">
              teChia Jobs brings scoring, prioritization, outreach, interview preparation, and
              follow-up workflows into one operating system for serious candidates.
            </p>
            <p className="mt-4 text-xs font-medium tracking-[0.04em] text-muted">
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

          {/* Mobile: two centered columns (Product | Explore + Access stacked).
              Desktop: `lg:contents` dissolves the wrappers so each section becomes
              its own grid column beside the brand copy. */}
          <div className="grid min-w-0 grid-cols-2 gap-x-6 gap-y-8 text-center lg:contents lg:text-left">
            <section className="min-w-0">
              <h3 className="text-sm font-semibold text-ink">Product</h3>
              <div className="mt-3 grid gap-2.5 text-sm text-muted">
                {footerSections[0].links.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="break-words transition hover:text-ink"
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            </section>

            <div className="min-w-0 grid gap-8 lg:contents">
              {footerSections.slice(1).map((section) => (
                <section key={section.title} className="min-w-0">
                  <h3 className="text-sm font-semibold text-ink">{section.title}</h3>
                  <div className="mt-3 grid gap-2.5 text-sm text-muted">
                    {section.links.map((link) => (
                      <Link
                        key={link.href}
                        href={link.href}
                        className="break-words transition hover:text-ink"
                      >
                        {link.label}
                      </Link>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-8 w-full border-t border-line pt-5 text-xs leading-6 text-muted">
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
