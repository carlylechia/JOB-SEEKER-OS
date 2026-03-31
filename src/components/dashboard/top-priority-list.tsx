import Link from 'next/link';
import { JobLead } from '@/types';
import { PriorityBadge } from '../shared/priority-badge';
import { ScoreBadge } from '../shared/score-badge';

export function TopPriorityList({ jobs }: { jobs: JobLead[] }) {
  return (
    <div className="card-pad">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Top priority roles</h3>
          <p className="muted">Your best current opportunities</p>
        </div>
      </div>
      <div className="space-y-3">
        {jobs.map((job) => (
          <Link href={`/jobs/${job.id}`} key={job.id} className="block rounded-xl border border-line p-4 hover:bg-white/5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-semibold">{job.title}</div>
                <div className="muted">{job.company}</div>
              </div>
              <div className="flex gap-2">
                <ScoreBadge score={job.score.fitScore} tier={job.score.fitTier} />
                <PriorityBadge priority={job.priorityFlag} />
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
