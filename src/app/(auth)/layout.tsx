import type { ReactNode } from 'react';
import { FloatingThemeToggle } from '@/components/shared/floating-theme-toggle';

/**
 * Auth route-group layout. Screens here have no app chrome, so the theme
 * switch is rendered once, fixed to the viewport corner, instead of being
 * repeated on every sign-in / register / reset screen.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <FloatingThemeToggle />
      {children}
    </>
  );
}