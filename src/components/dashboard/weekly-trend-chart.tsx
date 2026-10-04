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
          <CartesianGrid stroke="#D9DDE3" vertical={false} />
          <XAxis dataKey="week" stroke="#686F7B" />
          <YAxis stroke="#686F7B" />
          <Tooltip />
          <Bar dataKey="leads" fill="#D4AF37" radius={[6, 6, 0, 0]} />
          <Bar dataKey="applied" fill="#1F9D68" radius={[6, 6, 0, 0]} />
          <Bar dataKey="interviews" fill="#D98E04" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
