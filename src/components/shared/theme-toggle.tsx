'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from './theme-provider';

type Props = {
  /** `icon` is a compact square button; `pill` adds a visible label. */
  variant?: 'icon' | 'pill';
  className?: string;
};

/**
 * Light/dark switch. Rendered as a real <button> with aria-pressed so screen
 * readers announce the current state, and sized to a comfortable 40px touch
 * target on mobile.
 */
export function ThemeToggle({ variant = 'icon', className = '' }: Props) {
  const { theme, toggleTheme, mounted } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-pressed={isDark}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      className={
        variant === 'pill'
          ? `inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-3 text-sm font-medium text-ink transition-colors hover:bg-surface-hover ${className}`
          : `inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-surface text-ink transition-colors hover:bg-surface-hover ${className}`
      }
    >
      {/* Until the client resolves the stored theme we render a stable icon so
          the button does not visibly flip on hydration. */}
      <Sun
        className={`h-[18px] w-[18px] transition-all duration-300 ${
          mounted && isDark ? 'rotate-0 scale-100 opacity-100' : 'rotate-90 scale-50 opacity-0'
        }`}
        aria-hidden
      />
      <Moon
        className={`h-[18px] w-[18px] transition-all duration-300 ${
          mounted && isDark ? 'rotate-90 scale-50 opacity-0' : 'rotate-0 scale-100 opacity-100'
        }`}
        aria-hidden
      />
      {variant === 'pill' ? (
        <span className="min-w-[3.25rem] text-left">{mounted && isDark ? 'Dark' : 'Light'}</span>
      ) : null}
    </button>
  );
}