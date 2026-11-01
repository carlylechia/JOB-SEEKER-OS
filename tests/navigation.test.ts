/**
 * Navigation parity tests.
 *
 * Desktop and mobile intentionally render the same navigation source. These
 * tests lock in the feature list and the admin-only rule so a future link
 * cannot be added to one surface and forgotten on the other.
 */

import { describe, it, expect } from './harness';
import { APP_NAV_ITEMS, appNavItems } from '@/components/layout/nav-items';

const PRIMARY_FEATURES = [
  '/dashboard',
  '/jobs',
  '/daily-jobs',
  '/queue',
  '/pipeline',
  '/contacts',
  '/interview-prep',
  '/prep',
  '/templates',
  '/profile',
  '/career-profile',
  '/resumes',
  '/application-materials',
  '/settings',
  '/settings/billing',
];

describe('app navigation', () => {
  it('exposes every primary feature to every signed-in user', () => {
    const hrefs = appNavItems(false).map((item) => item.href);
    for (const href of PRIMARY_FEATURES) {
      expect(hrefs).toContain(href);
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
