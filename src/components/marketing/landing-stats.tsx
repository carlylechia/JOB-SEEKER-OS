import { getLandingStats } from '@/lib/landing-stats';
import { LandingStatsGrid, type LandingStatItem } from './landing-stats-grid';

export async function LandingStats() {
  const stats = await getLandingStats();

  const items: LandingStatItem[] = [
    {
      label: 'Open roles',
      value: stats.openRoles,
      caption: 'Live opportunities in the public catalog',
    },
    {
      label: 'Hiring companies',
      value: stats.hiringCompanies,
      caption: 'Distinct employers actively posting',
    },
    {
      label: 'Connected sources',
      value: stats.connectedSources,
      caption: 'Job boards and employer feeds synced',
    },
    {
      label: 'Countries covered',
      value: stats.countriesCovered,
      caption: 'Markets represented across the catalog',
    },
  ];

  return (
    <section id="stats" className="w-full min-w-0 py-12 sm:py-16">
      <div className="text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/[0.08] px-3 py-1.5 text-xs font-semibold text-accent-text">
          Live platform metrics
        </span>
        <h2 className="mt-5 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
          The search, at scale.
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-muted">
          Real numbers from the teChia Jobs catalog — updated as new roles and
          sources come online.
        </p>
      </div>

      <div className="mt-10">
        <LandingStatsGrid items={items} />
      </div>
    </section>
  );
}
