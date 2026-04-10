'use client';

import Link from 'next/link';
import { PageHeader } from '@/components/shared/page-header';
import { PriorityBadge } from '@/components/shared/priority-badge';
import { ScoreBadge } from '@/components/shared/score-badge';
import { useJobs } from '@/hooks/use-job-data';
import { QueueTask } from '@/types';

const TASK_META: Record<QueueTask['type'], { icon: string; accent: string; badge: string }> = {
  FOLLOW_UP_NOW: { icon: '🔔', accent: 'border-red-400/30 bg-red-500/8', badge: 'bg-red-500/15 text-red-300' },
  PREPARE: { icon: '📋', accent: 'border-violet-400/30 bg-violet-500/8', badge: 'bg-violet-500/15 text-violet-300' },
  APPLY: { icon: '📤', accent: 'border-sky-400/30 bg-sky-500/8', badge: 'bg-sky-500/15 text-sky-300' },
  FOLLOW_UP: { icon: '📬', accent: 'border-amber-400/30 bg-amber-500/8', badge: 'bg-amber-500/15 text-amber-300' },
};

const TASK_LABEL: Record<QueueTask['type'], string> = {
  FOLLOW_UP_NOW: 'Follow up now',
  PREPARE: 'Prep interview',
  APPLY: 'Apply',
  FOLLOW_UP: 'Follow up',
};

export default function QueuePage() {
  const { queueTasks, preferences, isLoading } = useJobs();

  if (isLoading) return <div className="card-pad">Loading your queue…</div>;

  const subtitle = preferences
    ? `Ranked for ${preferences.targetLevel.toLowerCase()}-level targets. Urgent actions first.`
    : 'Dynamically generated from your jobs—most urgent first.';

  return (
    <div className="space-y-6">
      <PageHeader title="Action Queue" subtitle={subtitle} />

      {queueTasks.length === 0 ? (
        <div className="card-pad text-center py-12">
          <div className="text-4xl mb-4">✅</div>
          <div className="text-lg font-semibold">All caught up!</div>
          <div className="muted mt-2">No pending tasks. Add more jobs or update existing statuses.</div>
          <Link href="/jobs/new" className="btn-primary mt-4 inline-block">Add a job</Link>
        </div>
      ) : (
        <div className="space-y-3">
          {queueTasks.map((task) => {
            const meta = TASK_META[task.type];
            return (
              <div key={task.taskId} className={`card-pad border ${meta.accent}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl leading-none mt-0.5">{meta.icon}</span>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`badge text-xs ${meta.badge}`}>
                          {TASK_LABEL[task.type]}
                        </span>
                        {task.dueDate && (
                          <span className="text-xs text-red-400">Due {task.dueDate}</span>
                        )}
                      </div>
                      <Link href={`/jobs/${task.jobId}`} className="mt-1 block font-semibold hover:text-accent">
                        {task.title}
                      </Link>
                      <div className="text-sm text-muted">{task.description}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <ScoreBadge score={task.fitScore} tier={task.fitTier} />
                    <PriorityBadge priority={task.priority} />
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <Link href={`/jobs/${task.jobId}`} className="btn-secondary text-sm py-1">
                    Open job →
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

