import Link from 'next/link';

const PARENT_COMPANY_URL = 'https://www.techiadigital.com';
const PARENT_COMPANY_NAME = 'teChia Digital Solutions';

const productLinks = [
  { href: '/#features', label: 'Features' },
  { href: '/#workflow', label: 'Workflow' },
  { href: '/#faq', label: 'FAQ' },
] as const;

const exploreLinks = [
  { href: '/jobs-public', label: 'Public Jobs' },
  { href: '/demo', label: 'Product Overview' },
] as const;

const accessLinks = [
  { href: '/login', label: 'Sign In' },
  { href: '/register', label: 'Create Account' },
] as const;

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="w-full max-w-full overflow-x-clip border-t border-line bg-background pb-24 md:pb-[max(1.25rem,env(safe-area-inset-bottom))]">
      <div className="shell w-full py-10 sm:py-12">
        {/* Upper section: brand block on the left, the two link columns pinned to
            the extreme right. `items-stretch` makes each column run the full
            height of the section; `justify-between` spreads the second column's
            two groups to match. Everything centers below lg. */}
        <div className="flex w-full flex-col items-center gap-10 text-center lg:flex-row lg:items-stretch lg:justify-between lg:gap-16 lg:text-left xl:gap-24">
          <div className="flex w-full max-w-xl flex-col items-center lg:items-start">
            <p className="text-sm font-semibold tracking-[0.06em] text-accent-text">teChia Jobs</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
              The AI-powered operating system for your job search.
            </h2>
            <p className="mt-4 text-sm leading-7 text-muted sm:text-base">
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

          {/* Links: two columns on every breakpoint, flush right on desktop. */}
          <div className="grid grid-cols-2 gap-x-10 sm:gap-x-16 lg:gap-x-20">
            <div className="flex min-w-0 flex-col items-center lg:items-start">
              <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-ink">
                Product
              </h3>
              <div className="mt-4 grid justify-items-center gap-3 text-sm text-muted lg:justify-items-start">
                {productLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="transition hover:text-ink"
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>

            <div className="flex min-w-0 flex-col items-center justify-between gap-8 lg:items-start">
              <div className="flex flex-col items-center lg:items-start">
                <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-ink">
                  Explore
                </h3>
                <div className="mt-4 grid justify-items-center gap-3 text-sm text-muted lg:justify-items-start">
                  {exploreLinks.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      className="transition hover:text-ink"
                    >
                      {link.label}
                    </Link>
                  ))}
                </div>
              </div>

              <div className="flex flex-col items-center lg:items-start">
                <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-ink">
                  Access
                </h3>
                <div className="mt-4 grid justify-items-center gap-3 text-sm text-muted lg:justify-items-start">
                  {accessLinks.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      className="transition hover:text-ink"
                    >
                      {link.label}
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom section: copyright and legal copy, centered. */}
        <div className="mt-10 border-t border-line pt-6 text-center text-xs leading-6 text-muted">
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
          <p className="mx-auto mt-2 max-w-2xl">
            teChia Jobs is a workflow and decision-support platform. Users remain responsible for
            the accuracy of their application materials, communications, and compliance with the
            terms of third-party job platforms.
          </p>
        </div>
      </div>
    </footer>
  );
}
