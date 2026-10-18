import type { LucideIcon } from 'lucide-react';

type Trend = 'up' | 'down' | 'neutral';

export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  accent = 'text-accent-text',
  trend,
  trendLabel,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
  accent?: string;
  trend?: Trend;
  trendLabel?: string;
}) {
  const trendColor =
    trend === 'up' ? 'text-success-text' :
    trend === 'down' ? 'text-danger-text' :
    'text-muted';

  const trendSymbol =
    trend === 'up' ? '↑' :
    trend === 'down' ? '↓' :
    '–';

  return (
    <div className="card-pad flex flex-col gap-3 transition-colors hover:border-line">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted">{label}</span>
        {Icon && <Icon className={`h-4 w-4 ${accent} opacity-60`} />}
      </div>
      <div className={`text-3xl font-bold tracking-tight text-ink`}>{value}</div>
      {(hint || trendLabel) && (
        <div className="flex items-center gap-2">
          {trendLabel && (
            <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${trendColor}`}>
              {trendSymbol} {trendLabel}
            </span>
          )}
          {hint && !trendLabel && <span className="text-xs text-muted">{hint}</span>}
        </div>
      )}
    </div>
  );
}
