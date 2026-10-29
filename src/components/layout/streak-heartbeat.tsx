'use client';

import { useEffect } from 'react';

/**
 * Keeps a long-lived app session honest.
 *
 * The server layout and bootstrap already count page loads. This heartbeat
 * covers the other case: a tab left open across midnight. It is cheap because
 * the endpoint is idempotent within a local day, and it lets the dashboard
 * update immediately when a new day is counted.
 */
export function StreakHeartbeat() {
  useEffect(() => {
    let cancelled = false;

    async function touch() {
      try {
        const response = await fetch('/api/streak/touch', {
          method: 'POST',
          cache: 'no-store',
        });
        if (!response.ok) return;

        const data = (await response.json()) as {
          streakCount?: number;
          activeToday?: boolean;
          isAtRisk?: boolean;
        };
        if (cancelled || typeof data.streakCount !== 'number') return;

        window.dispatchEvent(
          new CustomEvent('streak:updated', {
            detail: {
              streakCount: data.streakCount,
              activeToday: Boolean(data.activeToday),
              isAtRisk: Boolean(data.isAtRisk),
            },
          }),
        );
      } catch {
        // Activity tracking is never allowed to break the app.
      }
    }

    void touch();

    // A 30-minute cadence means a tab open across midnight starts the new day
    // promptly without turning the heartbeat into a per-minute database hit.
    const interval = window.setInterval(() => void touch(), 30 * 60 * 1000);

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') void touch();
    }
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  return null;
}
