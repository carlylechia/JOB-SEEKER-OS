import { normalizeCompany, normalizeTitle } from './normalize';

type RankableJob = {
  company: string;
  title: string;
  fitScore: number;
  publishedAt: Date | null;
};

/** Preserve fit ranking while avoiding a shortlist dominated by one employer or role. */
export function selectDiverseTop<T extends RankableJob>(jobs: T[], limit: number) {
  const sorted = [...jobs].sort(
    (a, b) => b.fitScore - a.fitScore || (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0),
  );
  const selected: T[] = [];
  const deferred: T[] = [];
  const companies = new Map<string, number>();
  const titles = new Map<string, number>();

  for (const job of sorted) {
    const company = normalizeCompany(job.company);
    const title = normalizeTitle(job.title);
    if ((companies.get(company) ?? 0) >= 2 || (titles.get(title) ?? 0) >= 2) {
      deferred.push(job);
      continue;
    }
    selected.push(job);
    companies.set(company, (companies.get(company) ?? 0) + 1);
    titles.set(title, (titles.get(title) ?? 0) + 1);
    if (selected.length >= limit) return selected;
  }

  return [...selected, ...deferred].slice(0, limit);
}
