/**
 * Navigation consolidation tests.
 *
 * Desktop and mobile intentionally render the same navigation source. These
 * tests lock in the five-destination product model, the admin-only rule and the
 * legacy-route compatibility contract so a future link cannot be added to one
 * surface and forgotten on the other, and a retired destination cannot silently
 * stop working.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

import { describe, it, expect } from './harness';
import { APP_NAV_ITEMS, appNavItems } from '@/components/layout/nav-items';
import { LEGACY_ROUTES } from '@/components/layout/legacy-routes';

const PRIMARY_DESTINATIONS = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/jobs', label: 'Find Jobs' },
  { href: '/pipeline', label: 'Applications' },
  { href: '/studio', label: 'Application Studio' },
  { href: '/settings', label: 'Settings' },
];

describe('app navigation', () => {
  it('exposes exactly the five primary destinations to every signed-in user', () => {
    const items = appNavItems(false);
    expect(items.map((item) => item.href)).toEqual(PRIMARY_DESTINATIONS.map((item) => item.href));
    expect(items.map((item) => item.label)).toEqual(PRIMARY_DESTINATIONS.map((item) => item.label));
  });

  it('does not keep retired tools as competing primary entries', () => {
    const hrefs = appNavItems(false).map((item) => item.href);
    for (const retired of [
      '/queue',
      '/daily-jobs',
      '/contacts',
      '/interview-prep',
      '/prep',
      '/templates',
      '/profile',
      '/career-profile',
      '/resumes',
      '/application-materials',
      '/settings/billing',
    ]) {
      expect(hrefs).not.toContain(retired);
    }
  });

  it('shows the admin destination only to administrators', () => {
    expect(appNavItems(false).map((item) => item.href)).not.toContain('/admin');
    expect(appNavItems(true).map((item) => item.href)).toContain('/admin');
  });

  it('keeps every non-admin item identical for administrators', () => {
    const userItems = appNavItems(false);
    const adminItems = appNavItems(true).filter((item) => !item.adminOnly);
    expect(adminItems).toEqual(userItems);
  });

  it('has unique destinations and a usable icon/label on every item', () => {
    const hrefs = APP_NAV_ITEMS.map((item) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const item of APP_NAV_ITEMS) {
      expect(item.href.startsWith('/')).toBe(true);
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.icon).toBeDefined();
    }
  });
});

describe('legacy route compatibility', () => {
  it('gives every legacy route a canonical destination and a reason', () => {
    for (const route of LEGACY_ROUTES) {
      expect(route.href.startsWith('/')).toBe(true);
      expect(route.canonical.startsWith('/')).toBe(true);
      expect(route.reason.length).toBeGreaterThan(10);
    }
  });

  it('keeps a page file for every legacy route, including redirects', () => {
    const appDir = path.join(process.cwd(), 'src', 'app', '(app)');
    for (const route of LEGACY_ROUTES) {
      const page = path.join(appDir, route.href.slice(1), 'page.tsx');
      expect(existsSync(page)).toBe(true);
    }
  });

  it('retires the duplicate queue page by redirecting to the dashboard queue', () => {
    const queue = LEGACY_ROUTES.find((route) => route.href === '/queue');
    expect(queue).toBeDefined();
    expect(queue?.redirect).toBe(true);
    expect(queue?.canonical).toBe('/dashboard#daily-queue');
  });

  it('keeps Application Studio as the canonical home for hidden studio tools', () => {
    for (const href of ['/career-profile', '/resumes', '/application-materials', '/templates']) {
      const route = LEGACY_ROUTES.find((item) => item.href === href);
      expect(route?.canonical).toBe('/studio');
    }
  });
});
