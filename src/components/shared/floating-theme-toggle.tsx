'use client';

import { ThemeSwitch } from '@/components/shared/theme-switch';

/**
 * Theme switch for pages that have no app chrome (auth, verify-email).
 * Fixed to the viewport corner so it is present on every such screen without
 * each page reserving space for it.
 */
export function FloatingThemeToggle() {
  return (
    <div className="fixed right-4 top-4 z-50 sm:right-6 sm:top-6">
      <ThemeSwitch size="sm" />
    </div>
  );
}