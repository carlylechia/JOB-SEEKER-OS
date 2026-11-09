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
    grid: isDark ? '#3A433C' : '#DCE0D5',
    axis: isDark ? '#A5AEA5' : '#646C61',
    leads: isDark ? '#A6E635' : '#4F6B14',
    applied: isDark ? '#4ADE80' : '#1F8A4C',
    interviews: isDark ? '#FBBF24' : '#B77900',
    cursorBg: isDark ? '#202522' : '#FFFFFF',
    cursorBorder: isDark ? '#3A433C' : '#DCE0D5',
    text: isDark ? '#ECEFEA' : '#151715',
    muted: isDark ? '#A5AEA5' : '#646C61',
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