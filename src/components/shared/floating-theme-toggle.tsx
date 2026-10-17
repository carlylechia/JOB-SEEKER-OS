'use client';

import { ThemeToggle } from '@/components/shared/theme-toggle';

/**
 * Theme switch for pages that have no app chrome (auth, onboarding, verify).
 * Fixed to the viewport corner so it is present on every screen of the app
 * without each page having to reserve space for it.
 */
export function FloatingThemeToggle() {
  return (
    <div className="fixed right-4 top-4 z-50 sm:right-6 sm:top-6">
      <ThemeToggle />
    </div>
  );
}