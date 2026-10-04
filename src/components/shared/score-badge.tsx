import { FitTier } from '@/types';

export function ScoreBadge({ score, tier }: { score: number; tier: FitTier }) {
  const cls = tier === 'A' ? 'bg-emerald-500/15 text-emerald-800' : tier === 'B' ? 'bg-[#C9CED6]/40 text-[#4A505A]' : tier === 'C' ? 'bg-amber-500/15 text-amber-800' : 'bg-red-500/15 text-red-700';
  return <span className={`badge ${cls}`}>{tier} · {score}</span>;
}
