'use client';

import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useTheme } from '@/components/shared/theme-provider';

/** Recharts paints SVG attributes, not CSS classes, so the chart reads the
 *  active theme and renders literal colors that match it. */
function useChartColors() {
  const { theme, mounted } = useTheme();
  const isDark = mounted && theme === 'dark';

  return {
    grid: isDark ? '#22314d' : '#D9DDE3',
    axis: isDark ? '#98a7c4' : '#686F7B',
    leads: isDark ? '#4f8cff' : '#D4AF37',
    applied: isDark ? '#22c55e' : '#1F9D68',
    interviews: isDark ? '#f59e0b' : '#D98E04',
    cursorBg: isDark ? '#0f1a2e' : '#FFFFFF',
    cursorBorder: isDark ? '#22314d' : '#D9DDE3',
    text: isDark ? '#e7edf7' : '#17191E',
    muted: isDark ? '#98a7c4' : '#686F7B',
  };
}

export function WeeklyTrendChart({ data }: { data: { week: string; leads: number; applied: number; interviews: number }[] }) {
  const c = useChartColors();

  // Keep the axis text legible until the theme has been resolved client-side.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  const tick = hydrated ? { fill: c.muted, fontSize: 12 } : undefined;

  return (
    <div className="card-pad h-80">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-ink">Weekly trend</h3>
          <p className="muted">Lead flow, applications, and interviews</p>
        </div>
      </div>
      <ResponsiveContainer width="100%" height="85%">
        <BarChart data={data}>
          <CartesianGrid stroke={c.grid} vertical={false} />
          <XAxis dataKey="week" stroke={c.axis} tick={tick} tickLine={false} axisLine={false} />
          <YAxis stroke={c.axis} tick={tick} tickLine={false} axisLine={false} width={40} />
          <Tooltip
            cursor={{ fill: c.cursorBg, fillOpacity: 0.6 }}
            contentStyle={{
              background: c.cursorBg,
              border: `1px solid ${c.cursorBorder}`,
              borderRadius: 12,
              color: c.text,
              fontSize: 13,
              boxShadow: '0 12px 30px rgba(0,0,0,0.18)',
            }}
            labelStyle={{ color: c.muted, fontWeight: 600 }}
            itemStyle={{ color: c.text }}
          />
          <Bar dataKey="leads" fill={c.leads} radius={[6, 6, 0, 0]} />
          <Bar dataKey="applied" fill={c.applied} radius={[6, 6, 0, 0]} />
          <Bar dataKey="interviews" fill={c.interviews} radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}