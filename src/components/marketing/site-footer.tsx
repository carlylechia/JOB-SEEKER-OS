import Link from 'next/link';

const PARENT_COMPANY_URL = 'https://www.techiadigital.com';
const PARENT_COMPANY_NAME = 'teChia Digital Solutions';

const productLinks = [
  { href: '/#features', label: 'Features' },
  { href: '/#workflow', label: 'Workflow' },
  { href: '/#faq', label: 'FAQ' },
  { href: '/jobs-public', label: 'Public Jobs' },
  { href: '/demo', label: 'Product Overview' },
];

const accountLinks = [
  { href: '/login', label: 'Sign In' },
  { href: '/register', label: 'Create Account' },
];

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-[#DFE3E9] bg-[#FAFAF7] pb-[max(2rem,env(safe-area-inset-bottom))]">
      <div className="shell py-12 sm:py-14">
        <div className="grid gap-10 lg:grid-cols-[1.2fr_0.8fr_0.8fr]">
          <div>
            <p className="text-sm font-semibold tracking-[0.06em] text-[#8A6D1F]">teChia Jobs</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">The AI-powered operating system for your job search.</h2>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-muted sm:text-base">teChia Jobs brings scoring, prioritization, outreach, interview preparation, and follow-up workflows into one operating system for serious candidates.</p>
            <p className="mt-4 text-xs font-medium tracking-[0.04em] text-muted">
              A{' '}
              <a
                href={PARENT_COMPANY_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#8A6D1F] underline decoration-[#D4AF37]/50 underline-offset-4 transition hover:text-charcoal hover:decoration-[#D4AF37]"
              >
                {PARENT_COMPANY_NAME}
              </a>{' '}
              product
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-ink">Product</h3>
            <div className="mt-4 grid gap-3 text-sm text-muted">{productLinks.map((link) => <Link key={link.href} href={link.href} className="transition hover:text-ink">{link.label}</Link>)}</div>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-ink">Access</h3>
            <div className="mt-4 grid gap-3 text-sm text-muted">{accountLinks.map((link) => <Link key={link.href} href={link.href} className="transition hover:text-ink">{link.label}</Link>)}</div>
          </div>
        </div>
        <div className="mt-10 border-t border-[#DFE3E9] pt-6 text-xs leading-6 text-muted">
          <p>
            © {year}{' '}
            <a
              href={PARENT_COMPANY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-ink underline decoration-[#D4AF37]/50 underline-offset-4 transition hover:decoration-[#D4AF37]"
            >
              {PARENT_COMPANY_NAME}
            </a>
            . teChia Jobs. All rights reserved.
          </p>
          <p className="mt-2 max-w-3xl">teChia Jobs is a workflow and decision-support platform. Users remain responsible for the accuracy of their application materials, communications, and compliance with the terms of third-party job platforms.</p>
        </div>
      </div>
    </footer>
  );
}
