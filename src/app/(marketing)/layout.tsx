import type { ReactNode } from 'react';

/**
 * Marketing route-group layout.
 *
 * Applies the same ambient canvas as the signed-in app and admin shells so the
 * public site shares the workspace photo, grid and washes. Pages must not paint
 * an opaque page-level background over it; section and card surfaces remain
 * opaque so text contrast is unchanged.
 */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return <div className="ambient-canvas min-h-dvh w-full overflow-x-clip">{children}</div>;
}
