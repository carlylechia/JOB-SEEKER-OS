/**
 * Static regression checks for the visual system.
 *
 * This suite deliberately does not try to pixel-test the app. It protects the
 * load-bearing invariants that are easy to break in a refactor: self-hosted
 * fonts, palette tokens and contrast pairs, sticky navigation without a
 * clipping ancestor, the branded loader/404, and reduced-motion coverage.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from './harness';

const root = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function exists(relativePath: string): boolean {
  return fs.existsSync(path.join(root, relativePath));
}

function luminance(hex: string): number {
  const [r, g, b] = hex
    .replace('#', '')
    .match(/../g)!
    .map((part) => Number.parseInt(part, 16) / 255)
    .map((value) =>
      value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  const light = Math.max(first, second);
  const dark = Math.min(first, second);
  return (light + 0.05) / (dark + 0.05);
}

describe('typography', () => {
  it('self-hosts both typefaces and loads them with next/font/local', () => {
    expect(exists('src/app/fonts/fraunces-latin-soft-normal.woff2')).toBe(true);
    expect(exists('src/app/fonts/inter-latin-400-normal.woff2')).toBe(true);
    expect(exists('src/app/fonts/FRAUNCES-OFL.txt')).toBe(true);
    expect(exists('src/app/fonts/INTER-OFL.txt')).toBe(true);

    const layout = read('src/app/layout.tsx');
    expect(layout).toContain("import localFont from 'next/font/local'");
    expect(layout).toContain('--font-body');
    expect(layout).toContain('--font-display');
    expect(layout).toContain('fraunces-latin-soft-normal.woff2');
    expect(layout).not.toContain('next/font/google');
  });

  it('uses the expressive display face only for headings and brand moments', () => {
    const css = read('src/app/globals.css');
    expect(css).toContain('h1,\nh2,\n.font-display,\n.title');
    expect(css).toContain("font-variation-settings: 'SOFT' 55, 'WONK' 0");
    expect(css).toContain('font-family: var(--font-body)');

    const tailwind = read('tailwind.config.ts');
    expect(tailwind).toContain("display: ['var(--font-display)'");
    expect(tailwind).toContain("body: ['var(--font-body)'");
  });

  it('does not make runtime requests to Google Fonts', () => {
    const layout = read('src/app/layout.tsx');
    const css = read('src/app/globals.css');
    expect(layout).not.toContain('fonts.googleapis.com');
    expect(layout).not.toContain('fonts.gstatic.com');
    expect(css).not.toContain('fonts.googleapis.com');
  });
});

describe('palette', () => {
  const css = read('src/app/globals.css');

  it('defines the light jet-black / light-surface / acid-lime tokens', () => {
    expect(css).toContain('--bg: 247 248 243');
    expect(css).toContain('--card: 255 255 255');
    expect(css).toContain('--sidebar: 238 240 233');
    expect(css).toContain('--ink: 21 23 21');
    expect(css).toContain('--accent: 183 243 74');
    expect(css).toContain('--accent-hover: 166 230 53');
  });

  it('defines the dark charcoal / sand / rich-lime inverse', () => {
    expect(css).toContain('--bg: 25 29 27');
    expect(css).toContain('--card: 32 37 34');
    expect(css).toContain('--sidebar: 28 33 30');
    expect(css).toContain('--ink: 236 239 234');
    expect(css).toContain('--ink-2: 216 205 182');
    expect(css).toContain('--accent: 166 230 53');
    expect(css).toContain('--accent-hover: 183 243 74');
  });

  it('keeps text pairs above WCAG AA for normal text', () => {
    const pairs: Array<[string, string, string]> = [
      ['light ink', '#151715', '#F7F8F3'],
      ['light secondary ink', '#343A35', '#F7F8F3'],
      ['light muted', '#646C61', '#F7F8F3'],
      ['light muted on sidebar', '#646C61', '#EEF0E9'],
      ['light accent text', '#4F6B14', '#F7F8F3'],
      ['light success status text', '#177A44', '#F7F8F3'],
      ['light warning status text', '#8A5A00', '#F7F8F3'],
      ['light danger status text', '#C74444', '#F7F8F3'],
      ['accent label on lime', '#151715', '#B7F34A'],
      ['dark ink', '#ECEFEA', '#202522'],
      ['dark sand', '#D8CDB6', '#202522'],
      ['dark muted', '#A5AEA5', '#202522'],
      ['dark accent text', '#C7F77A', '#202522'],
    ];

    for (const [label, foreground, background] of pairs) {
      const ratio = contrast(foreground, background);
      expect(
        ratio >= 4.5
          ? true
          : `${label} contrast ${ratio.toFixed(2)} is below 4.5:1`,
      ).toBe(true);
    }
  });

  it('encodes the 60:30:10 hierarchy in the token comments', () => {
    expect(css).toContain('60%  --bg / --page-bg');
    expect(css).toContain('30%  --card / --sidebar / surface');
    expect(css).toContain('10%  --accent');
  });
});

describe('sticky shell', () => {
  it('keeps the topbar sticky with an elevated scrim', () => {
    const topbar = read('src/components/layout/topbar.tsx');
    expect(topbar).toContain('sticky top-0 z-40');
    expect(topbar).toContain('shadow-nav');
    expect(topbar).toContain('backdrop-blur-xl');
  });

  it('gives the sidebar its own scroller and a pinned account footer', () => {
    const sidebar = read('src/components/layout/sidebar-nav.tsx');
    expect(sidebar).toContain('sticky top-0');
    expect(sidebar).toContain('h-dvh');
    expect(sidebar).toContain('overflow-hidden');
    expect(sidebar).toContain('overflow-y-auto');
    expect(sidebar).toContain('min-h-0 flex-1');
    expect(sidebar).toContain('shrink-0 border-t border-line pt-3');
  });

  it('does not introduce a block-axis clipping ancestor in the app frame', () => {
    const shell = read('src/components/layout/app-shell.tsx');
    expect(shell).toContain('min-h-dvh');
    expect(shell).not.toContain('overflow-y-hidden');
    expect(shell).not.toContain('h-screen');
    expect(shell).toContain('ambient-canvas');
  });

  it('uses the same sticky header treatment in admin', () => {
    const adminLayout = read('src/app/admin/layout.tsx');
    expect(adminLayout).toContain('sticky top-0 z-40');
    expect(adminLayout).toContain('shadow-nav');
    expect(adminLayout).toContain('ambient-canvas');
  });
});

describe('brand moments', () => {
  it('renders a reusable loader around the real brand mark', () => {
    const loader = read('src/components/shared/brand-loader.tsx');
    expect(loader).toContain("from '@/components/shared/brand-mark'");
    expect(loader).toContain("variant?: 'full' | 'inline'");
    expect(loader).toContain('role="status"');
    expect(loader).toContain('aria-live="polite"');
    expect(loader).toContain('brand-loader-orbit');
    expect(loader).toContain('brand-loader-rail');

    expect(exists('src/app/loading.tsx')).toBe(true);
    expect(exists('src/app/(app)/loading.tsx')).toBe(true);
    expect(exists('src/app/admin/loading.tsx')).toBe(true);
    expect(exists('src/app/(auth)/loading.tsx')).toBe(true);
  });

  it('adds branded route boundaries instead of spinner-only placeholders', () => {
    const daily = read('src/app/(app)/daily-jobs/page.tsx');
    expect(daily).toContain('BrandLoader');
    expect(daily).toContain('Ranking today’s opportunities');
  });

  it('returns a branded 404 with auth-aware actions and a safe back button', () => {
    const notFound = read('src/app/not-found.tsx');
    expect(notFound).toContain("import { auth } from '@/auth'");
    expect(notFound).toContain("signedIn ? '/dashboard' : '/'");
    expect(notFound).toContain('BackButton');
    expect(notFound).toContain('404');

    const back = read('src/components/shared/back-button.tsx');
    expect(back).toContain('window.history.length > 1');
    expect(back).toContain('router.push(fallbackHref)');
  });
});

describe('motion accessibility', () => {
  const css = read('src/app/globals.css');

  it('collapses every decorative animation under reduced motion', () => {
    const reducedBlock = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reducedBlock).toContain('.brand-loader-orbit');
    expect(reducedBlock).toContain('.brand-loader-glow');
    expect(reducedBlock).toContain('.brand-loader-rail::after');
    expect(reducedBlock).toContain('.brand-loader-dot');
    expect(reducedBlock).toContain('html { scroll-behavior: auto; }');
  });

  it('animates only transform/opacity in the loader keyframes', () => {
    const loaderFrame = css.slice(
      css.indexOf('@keyframes brand-loader-orbit'),
      css.indexOf('.brand-loader-orbit'),
    );
    expect(loaderFrame).toContain('transform: rotate(360deg)');
    expect(loaderFrame).toContain('transform: scale');
    expect(loaderFrame).toContain('opacity');
    expect(loaderFrame).not.toContain('width:');
    expect(loaderFrame).not.toContain('left:');
  });

  it('provides an explicit motion-reduce fallback in the delete dialog', () => {
    const table = read('src/components/admin/admin-users-table.tsx');
    expect(table).toContain('motion-reduce:animate-none');
  });
});
