'use client';

import { useEffect, useState } from 'react';
import { Download, Puzzle, Smartphone, Monitor } from 'lucide-react';
import {
  detectPlatform,
  HOME_SCREEN_STEPS,
  HOME_SCREEN_TITLE,
  type Platform,
} from '@/lib/install/platform';

export function InstallHighlight() {
  const [platform, setPlatform] = useState<Platform>('unknown');
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setPlatform(detectPlatform(navigator.userAgent));
    try {
      if (window.localStorage.getItem('techia-install-dismissed') === '1') {
        setDismissed(true);
      }
    } catch {
      // ignore
    }
  }, []);

  if (dismissed) return null;

  const homeTitle = HOME_SCREEN_TITLE[platform];
  const homeSteps = HOME_SCREEN_STEPS[platform];

  function dismiss() {
    setDismissed(true);
    try {
      window.localStorage.setItem('techia-install-dismissed', '1');
    } catch {
      // ignore
    }
  }

  const HomeIcon = platform === 'ios' || platform === 'android' ? Smartphone : Monitor;

  return (
    <section className="rounded-2xl border border-line bg-card p-5 shadow-soft" aria-labelledby="install-highlight-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent-text">Get teChia everywhere</p>
          <h2 id="install-highlight-heading" className="mt-1 text-lg font-semibold text-ink">
            Add teChia Jobs to your home screen
          </h2>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="text-xs text-muted underline underline-offset-2"
          aria-label="Dismiss install tips"
        >
          Dismiss
        </button>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-line bg-surface-sunken p-4">
          <div className="flex items-center gap-2">
            <HomeIcon className="h-4 w-4 text-accent-text" aria-hidden="true" />
            <p className="text-sm font-semibold text-ink">{homeTitle}</p>
          </div>
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-muted">
            {homeSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>

        <div className="rounded-xl border border-line bg-surface-sunken p-4">
          <div className="flex items-center gap-2">
            <Puzzle className="h-4 w-4 text-accent-text" aria-hidden="true" />
            <p className="text-sm font-semibold text-ink">Install the teChia Jobs browser extension</p>
          </div>
          <p className="mt-2 text-sm text-muted">
            Save jobs and auto-fill applications in one click from LinkedIn, Greenhouse, Lever, and Workday.
          </p>
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-muted">
            <li>Download or clone the <code className="text-ink">/extension</code> folder from the teChia Jobs repository.</li>
            <li>Open <code className="text-ink">chrome://extensions</code> (or Edge equivalent) and enable Developer mode.</li>
            <li>Click &quot;Load unpacked&quot; and select the <code className="text-ink">/extension</code> folder.</li>
            <li>Pin the teChia Jobs icon to your toolbar and sign in from the popup.</li>
          </ol>
          <a
            href="https://chromewebstore.google.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-accent-text underline underline-offset-2"
          >
            <Download className="h-3 w-3" aria-hidden="true" />
            Once published, find it on the Chrome Web Store
          </a>
        </div>
      </div>
    </section>
  );
}
