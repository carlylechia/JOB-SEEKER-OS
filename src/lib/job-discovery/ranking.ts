import { normalizeCompany, normalizeTitle } from './normalize';

type RankableJob = {
  company: string;
  title: string;
  fitScore: number;
  rankingScore?: number;
  source?: string;
  publishedAt: Date | null;
};

/**
 * Preserve fit ranking while avoiding a shortlist dominated by one employer,
 * role title, or aggregator. The final list may be shorter than `limit`; callers
 * must not pad it with ineligible jobs.
 */
export function selectDiverseTop<T extends RankableJob>(jobs: T[], limit: number) {
  const sorted = [...jobs].sort(
    (a, b) =>
      (b.rankingScore ?? b.fitScore) - (a.rankingScore ?? a.fitScore) ||
      b.fitScore - a.fitScore ||
      (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0),
  );
  const selected: T[] = [];
  const deferred: T[] = [];
  const companies = new Map<string, number>();
  const titles = new Map<string, number>();
  const sources = new Map<string, number>();

  for (const job of sorted) {
    const company = normalizeCompany(job.company);
    const title = normalizeTitle(job.title);
    const source = job.source ?? 'unknown';
    if (
      (companies.get(company) ?? 0) >= 2 ||
      (titles.get(title) ?? 0) >= 2 ||
      (sources.get(source) ?? 0) >= 3
    ) {
      deferred.push(job);
      continue;
    }
    selected.push(job);
    companies.set(company, (companies.get(company) ?? 0) + 1);
    titles.set(title, (titles.get(title) ?? 0) + 1);
    sources.set(source, (sources.get(source) ?? 0) + 1);
    if (selected.length >= limit) return selected;
  }

  // Fill remaining slots with deferred jobs rather than returning fewer for a
  // reason unrelated to eligibility; diversity is a preference, not a gate.
  return [...selected, ...deferred].slice(0, limit);
}
