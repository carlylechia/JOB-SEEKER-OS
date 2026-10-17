'use client';

import Link from 'next/link';
import { PageHeader } from '@/components/shared/page-header';
import { PriorityBadge } from '@/components/shared/priority-badge';
import { ScoreBadge } from '@/components/shared/score-badge';
import { useJobs } from '@/hooks/use-job-data';
import { QueueTask } from '@/types';

const TASK_META: Record<QueueTask['type'], { icon: string; accent: string; badge: string }> = {
  FOLLOW_UP_NOW: { icon: '🔔', accent: 'border-danger/30 bg-danger/10', badge: 'bg-danger/15 text-danger-text' },
  PREPARE: { icon: '📋', accent: 'border-line-strong bg-line-strong/20', badge: 'bg-line-strong/30 text-muted' },
  APPLY: { icon: '📤', accent: 'border-accent/30 bg-accent/10', badge: 'bg-accent/15 text-accent-text' },
  FOLLOW_UP: { icon: '📬', accent: 'border-warn/30 bg-warn/8', badge: 'bg-warn/15 text-warn-text' },
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
                          <span className="text-xs text-danger-text">Due {task.dueDate}</span>
                        )}
                      </div>
                      <Link href={`/jobs/${task.jobId}`} className="mt-1 block font-semibold hover:text-accent-text">
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

