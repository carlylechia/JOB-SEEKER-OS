/**
 * Application lifecycle — auditable record per job.
 *
 * ADDITIVE, never a replacement. `JobLead.status` remains the pipeline view
 * the rest of the product renders. This module records what was prepared,
 * what was attempted and what evidence proves a submission.
 *
 * The invariant enforced here is the release's safety rule:
 *
 *   An application can only reach APPLIED through a CONFIRMED attempt that
 *   carries evidence of submission. A user's own "I applied" creates an
 *   ATTEMPTED record and leaves the application IN_PROGRESS.
 *
 * There is no code path in this module that sets APPLIED without evidence, and
 * no code path that fabricates a candidate fact.
 */

import { prisma } from '@/lib/prisma';

import {
  APPLICATION_STATUSES,
  APPLICATION_TRANSITIONS,
  EVIDENCE_KINDS,
  isApplicationStatus,
  type ApplicationStatus,
  type AttemptChannel,
  type AttemptStatus,
  type EvidenceKind,
  type EventActor,
} from './statuses';

// Re-exported so existing importers keep working while the vocabulary lives in
// a client-safe module.
export {
  APPLICATION_STATUSES,
  ATTEMPT_STATUSES,
  ATTEMPT_CHANNELS,
  EVIDENCE_KINDS,
  EVENT_ACTORS,
  APPLICATION_TRANSITIONS,
  isApplicationStatus,
} from './statuses';
export type {
  ApplicationStatus,
  AttemptStatus,
  AttemptChannel,
  EvidenceKind,
  EventActor,
} from './statuses';

export class ApplicationNotFoundError extends Error {
  readonly code = 'APPLICATION_NOT_FOUND';
  readonly status = 404;
  constructor() {
    super('That application could not be found.');
    this.name = 'ApplicationNotFoundError';
  }
}

export class ApplicationTransitionError extends Error {
  readonly code = 'INVALID_TRANSITION';
  readonly status = 409;
  readonly from: ApplicationStatus;
  readonly to: ApplicationStatus;

  constructor(from: ApplicationStatus, to: ApplicationStatus) {
    super(`An application cannot move from ${from} to ${to}.`);
    this.name = 'ApplicationTransitionError';
    this.from = from;
    this.to = to;
  }
}

export class SubmissionEvidenceRequiredError extends Error {
  readonly code = 'SUBMISSION_EVIDENCE_REQUIRED';
  readonly status = 422;

  constructor() {
    super(
      'Marking an application as applied requires confirmed submission evidence. Record the evidence first; nothing else has changed.',
    );
    this.name = 'SubmissionEvidenceRequiredError';
  }
}

export class AttemptValidationError extends Error {
  readonly code = 'INVALID_ATTEMPT';
  readonly status = 422;

  constructor(message: string) {
    super(message);
    this.name = 'AttemptValidationError';
  }
}

export type ApplicationRecord = {
  id: string;
  userId: string;
  jobId: string;
  status: ApplicationStatus;
  targetDate: Date | null;
  outcomeNote: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AttemptRecord = {
  id: string;
  applicationId: string;
  channel: string;
  status: string;
  attemptedAt: Date;
  evidenceKind: string | null;
  evidenceRef: string | null;
  evidenceSummary: string | null;
  createdAt: Date;
};

export type ApplicationEventRecord = {
  id: string;
  type: string;
  fromStatus: string | null;
  toStatus: string | null;
  actor: string;
  reason: string | null;
  metadata: unknown;
  createdAt: Date;
};

/** Create the per-job record if it does not exist. Idempotent. */
export async function ensureApplication(params: {
  userId: string;
  jobId: string;
}): Promise<{ application: ApplicationRecord; created: boolean }> {
  // Fail closed: an attempt for a job this user does not own is a 404, never a
  // new record pointing at someone else's opportunity.
  const job = await prisma.jobLead.findFirst({
    where: { id: params.jobId, userId: params.userId, deletedAt: null },
    select: { id: true },
  });
  if (!job) throw new ApplicationNotFoundError();

  const existing = await prisma.application.findUnique({
    where: { userId_jobId: { userId: params.userId, jobId: params.jobId } },
  });
  if (existing) {
    return {
      application: existing as unknown as ApplicationRecord,
      created: false,
    };
  }

  const created = await prisma.application.create({
    data: { userId: params.userId, jobId: params.jobId, status: 'NOT_STARTED' },
  });
  return { application: created as unknown as ApplicationRecord, created: true };
}

export type RecordAttemptInput = {
  userId: string;
  jobId: string;
  channel: AttemptChannel;
  status: AttemptStatus;
  /** Defaults to now. Server-derived; never read from a request body. */
  attemptedAt?: Date;
  evidenceKind?: EvidenceKind | null;
  evidenceRef?: string | null;
  evidenceSummary?: string | null;
  actor?: EventActor;
  reason?: string | null;
};

export type RecordAttemptResult = {
  application: ApplicationRecord;
  attempt: AttemptRecord;
  /** True when this attempt moved the application to APPLIED. */
  markedApplied: boolean;
};

export async function recordAttempt(
  input: RecordAttemptInput,
): Promise<RecordAttemptResult> {
  if (input.status === 'CONFIRMED') {
    if (!input.evidenceKind || !(EVIDENCE_KINDS as readonly string[]).includes(input.evidenceKind)) {
      throw new AttemptValidationError(
        'A confirmed submission needs the kind of evidence that proves it, such as a confirmation page or email.',
      );
    }
  }

  const { application, created } = await ensureApplication({
    userId: input.userId,
    jobId: input.jobId,
  });

  const status = application.status as ApplicationStatus;
  let nextStatus = status;
  let markedApplied = false;
  let eventType: 'ATTEMPT_RECORDED' | 'EVIDENCE_ATTACHED' | 'SUBMISSION_CONFIRMED';

  if (input.status === 'CONFIRMED') {
    // Evidence proves the submission. The only rule this branch breaks is
    // "never APPLIED without evidence" — by construction.
    nextStatus = 'APPLIED';
    markedApplied = true;
    eventType = 'SUBMISSION_CONFIRMED';
  } else if (input.status === 'ATTEMPTED') {
    // A user assertion is not evidence. Move out of NOT_STARTED/READY_TO_SUBMIT
    // but never to APPLIED.
    if (status === 'NOT_STARTED' || status === 'READY_TO_SUBMIT') {
      nextStatus = 'IN_PROGRESS';
    }
    eventType = 'ATTEMPT_RECORDED';
  } else {
    // FAILED: record the attempt, do not pretend anything about the outcome.
    eventType = 'ATTEMPT_RECORDED';
  }

  const [attempt, updated] = await prisma.$transaction(async (tx) => {
    const attemptRow = await tx.applicationAttempt.create({
      data: {
        applicationId: application.id,
        userId: input.userId,
        jobId: input.jobId,
        channel: input.channel,
        status: input.status,
        attemptedAt: input.attemptedAt ?? new Date(),
        evidenceKind: input.status === 'CONFIRMED' ? input.evidenceKind : null,
        evidenceRef: input.evidenceRef ?? null,
        evidenceSummary: input.evidenceSummary ?? null,
      },
    });

    const updatedRow =
      nextStatus === status
        ? await tx.application.findUniqueOrThrow({ where: { id: application.id } })
        : await tx.application.update({
            where: { id: application.id },
            data: { status: nextStatus },
          });

    const eventRow = await tx.applicationEvent.create({
      data: {
        applicationId: application.id,
        userId: input.userId,
        jobId: input.jobId,
        type: eventType,
        fromStatus: status,
        toStatus: nextStatus === status ? null : nextStatus,
        actor: input.actor ?? 'USER',
        reason: input.reason ?? null,
        metadata: {
          attemptId: attemptRow.id,
          channel: input.channel,
          attemptStatus: input.status,
          ...(input.evidenceKind ? { evidenceKind: input.evidenceKind } : {}),
          ...(input.evidenceRef ? { evidenceRef: input.evidenceRef } : {}),
          ...(created ? { applicationCreated: true } : {}),
        },
      },
    });

    return [attemptRow, updatedRow] as const;
  });

  return {
    application: updated as unknown as ApplicationRecord,
    attempt: attempt as unknown as AttemptRecord,
    markedApplied,
  };
}

export type TransitionApplicationInput = {
  userId: string;
  jobId: string;
  toStatus: ApplicationStatus;
  actor?: EventActor;
  reason?: string | null;
};

export async function transitionApplication(
  input: TransitionApplicationInput,
): Promise<ApplicationRecord> {
  const job = await prisma.jobLead.findFirst({
    where: { id: input.jobId, userId: input.userId, deletedAt: null },
    select: { id: true },
  });
  if (!job) throw new ApplicationNotFoundError();

  const application = await prisma.application.findFirst({
    where: { userId: input.userId, jobId: input.jobId },
  });
  if (!application) throw new ApplicationNotFoundError();

  const fromStatus = application.status as ApplicationStatus;
  if (!isApplicationStatus(input.toStatus)) {
    throw new ApplicationTransitionError(fromStatus, input.toStatus);
  }

  if (input.toStatus === 'APPLIED') {
    const confirmed = await prisma.applicationAttempt.findFirst({
      where: { applicationId: application.id, status: 'CONFIRMED' },
      select: { id: true },
    });
    if (!confirmed) throw new SubmissionEvidenceRequiredError();
  }

  if (
    input.toStatus !== fromStatus &&
    !(APPLICATION_TRANSITIONS[fromStatus] ?? []).includes(input.toStatus)
  ) {
    throw new ApplicationTransitionError(fromStatus, input.toStatus);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.application.update({
      where: { id: application.id },
      data: { status: input.toStatus },
    });
    await tx.applicationEvent.create({
      data: {
        applicationId: application.id,
        userId: input.userId,
        jobId: input.jobId,
        type: 'STATUS_CHANGED',
        fromStatus,
        toStatus: input.toStatus,
        actor: input.actor ?? 'USER',
        reason: input.reason ?? null,
      },
    });
    return row;
  });

  return updated as unknown as ApplicationRecord;
}

export type ApplicationDetail = {
  application: ApplicationRecord;
  attempts: AttemptRecord[];
  events: ApplicationEventRecord[];
};

export async function getApplication(params: {
  userId: string;
  jobId: string;
}): Promise<ApplicationDetail | null> {
  const application = await prisma.application.findFirst({
    where: { userId: params.userId, jobId: params.jobId },
  });
  if (!application) return null;

  const [attempts, events] = await Promise.all([
    prisma.applicationAttempt.findMany({
      where: { applicationId: application.id },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.applicationEvent.findMany({
      where: { applicationId: application.id },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  return {
    application: application as unknown as ApplicationRecord,
    attempts: attempts as unknown as AttemptRecord[],
    events: events as unknown as ApplicationEventRecord[],
  };
}

export type ApplicationSummary = {
  id: string;
  jobId: string;
  status: ApplicationStatus;
  targetDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  job: { id: string; company: string; title: string; status: string } | null;
  confirmedAttempts: number;
  lastAttemptAt: Date | null;
};

export async function listApplications(params: {
  userId: string;
  status?: ApplicationStatus;
}): Promise<ApplicationSummary[]> {
  const applications = await prisma.application.findMany({
    where: {
      userId: params.userId,
      ...(params.status ? { status: params.status } : {}),
    },
    orderBy: { updatedAt: 'desc' },
    take: 100,
    include: {
      job: {
        select: { id: true, company: true, title: true, status: true, deletedAt: true },
      },
      attempts: {
        select: { status: true, attemptedAt: true },
        orderBy: { attemptedAt: 'desc' },
        take: 1,
      },
      _count: { select: { attempts: { where: { status: 'CONFIRMED' } } } },
    },
  });

  return applications.map((row) => ({
    id: row.id,
    jobId: row.jobId,
    status: row.status as ApplicationStatus,
    targetDate: row.targetDate,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    job: row.job && row.job.deletedAt === null
      ? { id: row.job.id, company: row.job.company, title: row.job.title, status: row.job.status }
      : null,
    confirmedAttempts: row._count.attempts,
    lastAttemptAt: row.attempts[0]?.attemptedAt ?? null,
  }));
}
