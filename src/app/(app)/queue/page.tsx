'use client';

import { PageHeader } from '@/components/shared/page-header';
import { PriorityBadge } from '@/components/shared/priority-badge';
import { ScoreBadge } from '@/components/shared/score-badge';
import { useJobs } from '@/hooks/use-job-data';
import { checklistCompletion } from '@/lib/scoring';

export default function QueuePage() {
  const { dashboard, preferences } = useJobs();
  return (
    <div className="space-y-6">
      <PageHeader title="Tailored Application Queue" subtitle={preferences ? `Ranked for ${preferences.targetLevel.toLowerCase()}-level targets, ${preferences.preferredRegions.join(', ')}, and your saved stack priorities.` : 'These are the roles most worth tailoring right now.'} />
      <div className="space-y-4">
        {dashboard.queue.map((job) => (
          <div key={job.id} className="card-pad">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">{job.title}</div>
                <div className="muted">{job.company}</div>
              </div>
              <div className="flex gap-2">
                <ScoreBadge score={job.score.fitScore} tier={job.score.fitTier} />
                <PriorityBadge priority={job.priorityFlag} />
              </div>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <div className="rounded-xl border border-line p-3"><div className="muted">Checklist</div><div className="mt-1 text-2xl font-semibold">{checklistCompletion(job)}%</div></div>
              <div className="rounded-xl border border-line p-3"><div className="muted">Timezone</div><div className="mt-1">{job.timezoneRequirement}</div></div>
              <div className="rounded-xl border border-line p-3"><div className="muted">Suggested next action</div><div className="mt-1">{job.priorityFlag.replaceAll('_', ' ')}</div></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
