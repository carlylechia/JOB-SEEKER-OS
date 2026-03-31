'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export function WeeklyTrendChart({ data }: { data: { week: string; leads: number; applied: number; interviews: number }[] }) {
  return (
    <div className="card-pad h-80">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Weekly trend</h3>
          <p className="muted">Lead flow, applications, and interviews</p>
        </div>
      </div>
      <ResponsiveContainer width="100%" height="85%">
        <BarChart data={data}>
          <CartesianGrid stroke="#22314d" vertical={false} />
          <XAxis dataKey="week" stroke="#98a7c4" />
          <YAxis stroke="#98a7c4" />
          <Tooltip />
          <Bar dataKey="leads" fill="#4f8cff" radius={[6, 6, 0, 0]} />
          <Bar dataKey="applied" fill="#22c55e" radius={[6, 6, 0, 0]} />
          <Bar dataKey="interviews" fill="#f59e0b" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
