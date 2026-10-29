'use client';

import { useState } from 'react';
import { CheckCircle2, Circle, Clock, Loader2, RotateCcw } from 'lucide-react';
import type { PackDetail, PrepTask, PrepHorizon } from './types';
import { Card, EmptyState, Pill, PriorityPill, SectionHeading } from './ui';

const HORIZONS: Array<{ key: PrepHorizon; label: string; hint: string }> = [
  { key: 'WITHIN_24_HOURS', label: 'Within 24 hours', hint: 'Do these first if the interview is imminent.' },
  { key: 'TWO_THREE_DAYS', label: 'In 2–3 days', hint: 'High-value preparation for the next few days.' },
  { key: 'WITHIN_A_WEEK', label: 'Within a week', hint: 'Build depth without cramming.' },
  { key: 'MORE_THAN_A_WEEK', label: 'More than a week away', hint: 'Longer-run preparation and research.' },
  { key: 'UNKNOWN', label: 'Whenever you can', hint: 'No interview date was set.' },
];

const CATEGORY_LABELS: Record<string, string> = {
  RESEARCH: 'Research',
  PRACTICE: 'Practice',
  REVIEW: 'Review',
  LOGISTICS: 'Logistics',
  WRITING: 'Writing',
};

export function PlanTab({
  detail,
  onChanged,
  onError,
}: {
  detail: PackDetail;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [savingId, setSavingId] = useState<string | null>(null);

  async function setStatus(task: PrepTask, status: 'PENDING' | 'COMPLETED' | 'DEFERRED') {
    setSavingId(task.id);
    try {
      const res = await fetch(
        `/api/interview-prep/${detail.pack.id}/tasks/${task.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        },
      );
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        onError(json.error?.message ?? 'That task could not be updated.');
        return;
      }
      await onChanged();
    } catch {
      onError('That task could not be updated. Please try again.');
    } finally {
      setSavingId(null);
    }
  }

  const tasks = detail.tasks;
  if (tasks.length === 0) {
    return (
      <EmptyState
        title="No preparation plan yet"
        description="Generate or regenerate the pack to build a time-based plan. If the interview date changes, the plan is re-scheduled automatically."
      />
    );
  }

  const completed = tasks.filter((task) => task.status === 'COMPLETED').length;
  const percent = Math.round((completed / tasks.length) * 100);

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <SectionHeading
          title="Preparation plan"
          description="A time-based sequence built around your interview date. Completing tasks changes the readiness snapshot — nothing here is gamified."
        />
        <div className="flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-sunken">
            <div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
          </div>
          <span className="text-xs font-medium text-muted">
            {completed}/{tasks.length} done
          </span>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <Pill tone="neutral">{detail.data.timing.replaceAll('_', ' ').toLowerCase()}</Pill>
          {detail.pack.interviewAt ? (
            <Pill tone="info">
              Interview {new Date(detail.pack.interviewAt).toLocaleDateString()}
            </Pill>
          ) : (
            <Pill tone="warn">No interview date set</Pill>
          )}
        </div>
      </Card>

      {HORIZONS.map((horizon) => {
        const horizonTasks = tasks.filter((task) => task.horizon === horizon.key);
        if (horizonTasks.length === 0) return null;
        return (
          <Card key={horizon.key} className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold">{horizon.label}</h3>
              <p className="muted text-xs">{horizon.hint}</p>
            </div>
            <div className="space-y-2">
              {horizonTasks.map((task) => {
                const done = task.status === 'COMPLETED';
                const deferred = task.status === 'DEFERRED';
                return (
                  <div
                    key={task.id}
                    className={`rounded-xl border p-3 ${
                      done ? 'border-success/25 bg-success/[0.04]' : 'border-line'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <button
                        type="button"
                        className="mt-0.5 shrink-0"
                        onClick={() => void setStatus(task, done ? 'PENDING' : 'COMPLETED')}
                        disabled={savingId === task.id}
                        aria-label={done ? `Mark "${task.title}" as pending` : `Mark "${task.title}" as complete`}
                      >
                        {savingId === task.id ? (
                          <Loader2 className="h-5 w-5 animate-spin text-muted" aria-hidden />
                        ) : done ? (
                          <CheckCircle2 className="h-5 w-5 text-success-text" aria-hidden />
                        ) : (
                          <Circle className="h-5 w-5 text-muted" aria-hidden />
                        )}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <p className={`text-sm font-medium ${done ? 'line-through opacity-70' : ''}`}>
                            {task.title}
                          </p>
                          <div className="flex flex-wrap gap-1">
                            <PriorityPill priority={task.priority} />
                            <Pill tone="neutral">{CATEGORY_LABELS[task.category] ?? task.category}</Pill>
                            <Pill tone="neutral">
                              <Clock className="mr-1 h-3 w-3" aria-hidden />
                              {task.estimatedMinutes} min
                            </Pill>
                          </div>
                        </div>
                        <p className="muted mt-1 text-xs">{task.description}</p>
                        {task.whyItMatters ? (
                          <p className="mt-1 text-xs">
                            <span className="font-medium">Why: </span>
                            {task.whyItMatters}
                          </p>
                        ) : null}
                        <p className="mt-1 text-xs text-muted">
                          <span className="font-medium">Output: </span>
                          {task.expectedOutput}
                        </p>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-2 pl-8">
                      <button
                        type="button"
                        className="text-[11px] font-medium text-muted hover:text-ink"
                        onClick={() => void setStatus(task, deferred ? 'PENDING' : 'DEFERRED')}
                        disabled={savingId === task.id}
                      >
                        <RotateCcw className="mr-1 inline h-3 w-3" aria-hidden />
                        {deferred ? 'Move back to pending' : 'Defer'}
                      </button>
                      {deferred ? <span className="text-[11px] text-warn-text">Deferred</span> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
