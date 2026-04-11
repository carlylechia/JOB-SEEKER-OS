/**
 * Queue Engine — server-only, deterministic
 *
 * Converts a user's job leads into a prioritised "Daily Action Queue"
 * of up to 5 tasks. Designed to be future-compatible with AI ranking
 * by keeping each category factored out and scoring explicit.
 *
 * Priority bands (higher = more urgent):
 *   100  follow_up  — nextFollowUp date is today or overdue
 *    90  prep       — job has scheduled interviews
 *    80  apply      — saved/lead with high fit score (≥ 70)
 *    60  stale      — not updated in 7+ days and still active
 *    40  review     — low fit score (< 50) still in active status
 */

import { prisma } from './prisma';
import { mapDbJob } from './db-helpers';
import { JobLead, JobStatus } from '@/types';

// ─── Types ────────────────────────────────────────────────────────────────────

export type QueueItemType = 'apply' | 'follow_up' | 'prep' | 'review' | 'stale';

export type QueueItem = {
  id: string;
  type: QueueItemType;
  jobId: string;
  jobTitle: string;
  company: string;
  title: string;         // human-readable task title
  description: string;
  priority: number;      // 0-100; higher = shown first
  isHighPriority: boolean; // true when priority >= 90
  cta: 'apply' | 'job' | 'prep' | 'contacts'; // where the CTA button routes
};

// ─── Constants ────────────────────────────────────────────────────────────────

const ACTIVE_STATUSES: JobStatus[] = ['SAVED', 'LEAD', 'APPLYING', 'APPLIED', 'INTERVIEWING'];
const MAX_QUEUE_SIZE = 5;
const STALE_DAYS = 7;
const HIGH_FIT_THRESHOLD = 70;
const LOW_FIT_THRESHOLD = 50;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function today(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysAgo(n: number): Date {
  const d = today();
  d.setDate(d.getDate() - n);
  return d;
}

function parseDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

// Deduplication key: one task per (jobId + type)
function dedupeKey(jobId: string, type: QueueItemType) {
  return `${jobId}::${type}`;
}

// ─── Category builders ───────────────────────────────────────────────────────

function buildFollowUpTask(job: JobLead): QueueItem {
  const followDate = parseDate(job.nextFollowUp);
  const isOverdue = followDate && followDate < today();
  return {
    id: dedupeKey(job.id, 'follow_up'),
    type: 'follow_up',
    jobId: job.id,
    jobTitle: job.title,
    company: job.company,
    title: `Follow up with ${job.company}`,
    description: isOverdue
      ? `Your follow-up for "${job.title}" was due on ${job.nextFollowUp}. Reach out now.`
      : `It's time to follow up on your "${job.title}" application at ${job.company}.`,
    priority: 100,
    isHighPriority: true,
    cta: 'contacts',
  };
}

function buildPrepTask(job: JobLead): QueueItem {
  const upcoming = job.interviews.find((i) => i.outcome === 'PENDING' || !i.outcome);
  return {
    id: dedupeKey(job.id, 'prep'),
    type: 'prep',
    jobId: job.id,
    jobTitle: job.title,
    company: job.company,
    title: `Prepare for ${job.company} interview`,
    description: upcoming
      ? `You have a ${upcoming.stage} interview scheduled. Review your prep pack before it arrives.`
      : `You're in the interview stage for "${job.title}". Sharpen your prep pack now.`,
    priority: 90,
    isHighPriority: true,
    cta: 'prep',
  };
}

function buildApplyTask(job: JobLead): QueueItem {
  return {
    id: dedupeKey(job.id, 'apply'),
    type: 'apply',
    jobId: job.id,
    jobTitle: job.title,
    company: job.company,
    title: `Apply to ${job.company}`,
    description: `"${job.title}" at ${job.company} is a strong match (score ${job.score.fitScore}). Don't wait — move it to Applied today.`,
    priority: 80,
    isHighPriority: false,
    cta: 'apply',
  };
}

function buildStaleTask(job: JobLead): QueueItem {
  return {
    id: dedupeKey(job.id, 'stale'),
    type: 'stale',
    jobId: job.id,
    jobTitle: job.title,
    company: job.company,
    title: `Review stale lead — ${job.company}`,
    description: `Your "${job.title}" lead at ${job.company} hasn't been updated in over ${STALE_DAYS} days. Archive it or take action.`,
    priority: 60,
    isHighPriority: false,
    cta: 'job',
  };
}

function buildReviewTask(job: JobLead): QueueItem {
  return {
    id: dedupeKey(job.id, 'review'),
    type: 'review',
    jobId: job.id,
    jobTitle: job.title,
    company: job.company,
    title: `Review low-score job — ${job.company}`,
    description: `"${job.title}" at ${job.company} has a low fit score (${job.score.fitScore}). Consider whether it's worth pursuing.`,
    priority: 40,
    isHighPriority: false,
    cta: 'job',
  };
}

// ─── Main engine ─────────────────────────────────────────────────────────────

export async function generateDailyQueue(userId: string): Promise<QueueItem[]> {
  // Fetch only active, non-deleted jobs for this user
  const rows = await prisma.jobLead.findMany({
    where: {
      userId,
      deletedAt: null,
      status: { in: ACTIVE_STATUSES },
    },
    orderBy: { updatedAt: 'desc' },
  });

  const jobs = rows.map(mapDbJob);

  if (jobs.length === 0) return [];

  const seen = new Set<string>();
  const queue: QueueItem[] = [];
  const staleThreshold = daysAgo(STALE_DAYS);

  function push(item: QueueItem) {
    const key = item.id;
    if (seen.has(key)) return;
    seen.add(key);
    queue.push(item);
  }

  // ── 1. Follow-ups due ── (priority 100)
  for (const job of jobs) {
    const followDate = parseDate(job.nextFollowUp);
    if (followDate && followDate <= today()) {
      push(buildFollowUpTask(job));
    }
  }

  // ── 2. Interview prep ── (priority 90)
  for (const job of jobs) {
    if (job.status === 'INTERVIEWING' || job.interviews.length > 0) {
      const key = dedupeKey(job.id, 'follow_up');
      if (!seen.has(key)) {
        // Only add prep if we didn't already add a follow_up for this job
        push(buildPrepTask(job));
      }
    }
  }

  // ── 3. High-score saved jobs ready to apply ── (priority 80)
  for (const job of jobs) {
    if (
      (job.status === 'SAVED' || job.status === 'LEAD') &&
      job.score.fitScore >= HIGH_FIT_THRESHOLD
    ) {
      push(buildApplyTask(job));
    }
  }

  // ── 4. Stale active jobs ── (priority 60)
  // We need updatedAt from Prisma — use the raw rows for this
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const job = jobs[i];
    const updatedAt = row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt);
    if (updatedAt <= staleThreshold) {
      push(buildStaleTask(job));
    }
  }

  // ── 5. Low-score jobs still active ── (priority 40)
  for (const job of jobs) {
    if (job.score.fitScore < LOW_FIT_THRESHOLD) {
      push(buildReviewTask(job));
    }
  }

  // Sort by priority DESC, dedupe is already handled by the seen set
  return queue
    .sort((a, b) => b.priority - a.priority)
    .slice(0, MAX_QUEUE_SIZE);
}
