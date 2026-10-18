import { FitTier } from '@/types';

export function ScoreBadge({ score, tier }: { score: number; tier: FitTier }) {
  const cls = tier === 'A' ? 'bg-success/15 text-success-text' : tier === 'B' ? 'bg-line-strong/40 text-ink-2' : tier === 'C' ? 'bg-warn/15 text-warn-text' : 'bg-danger/15 text-danger-text';
  return <span className={`badge ${cls}`}>{tier} · {score}</span>;
}
