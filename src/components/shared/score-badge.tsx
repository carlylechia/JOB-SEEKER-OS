import { FitTier } from '@/types';

export function ScoreBadge({ score, tier }: { score: number; tier: FitTier }) {
  const cls = tier === 'A' ? 'bg-emerald-500/15 text-emerald-300' : tier === 'B' ? 'bg-blue-500/15 text-blue-300' : tier === 'C' ? 'bg-amber-500/15 text-amber-300' : 'bg-red-500/15 text-red-300';
  return <span className={`badge ${cls}`}>{tier} · {score}</span>;
}
