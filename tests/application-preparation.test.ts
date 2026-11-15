/**
 * Application preparation autopilot — planner and durable run tests.
 *
 * The state machine is exercised with an injected task executor, so no provider
 * call is made and no credits are consumed. Each test owns a user and deletes
 * every row it created.
 */

import { describe, it, afterEach, expect } from './harness';
import { prisma } from '@/lib/prisma';
import { createUser, destroyUser } from './helpers';
import {
  defaultTasksForPlan,
  preparationDedupeKey,
  selectSourceResume,
} from '@/lib/application-preparation/plan';
import {
  advancePreparationRun,
  advanceUntilIdle,
  cancelPreparationRun,
  createPreparationRun,
  getPreparationRun,
  PreparationRunCancelledError,
  PreparationRunNotFoundError,
  PreparationTaskNotRetryableError,
  retryPreparationTask,
  __setPreparationTaskExecutorForTests,
} from '@/lib/application-preparation/service';
import type { TaskExecutionOutcome } from '@/lib/application-preparation/executors';
import type { PreparationPlan } from '@/lib/application-preparation/types';
import { typicalContent } from './resume-builder-fixtures';

const userIds: string[] = [];

afterEach(async () => {
  __setPreparationTaskExecutorForTests(null);
  for (const id of userIds.splice(0)) {
    await destroyUser(id).catch(() => undefined);
  }
});

async function setup() {
  const user = await createUser();
  userIds.push(user.id);

  const plan = await prisma.plan.findUniqueOrThrow({ where: { code: 'PRO' } });
  await prisma.subscription.create({
    data: {
      userId: user.id,
      planId: plan.id,
      status: 'ACTIVE',
      startsAt: new Date(Date.now() - 60_000),
      source: 'ADMIN_MANUAL',
    },
  });

  const job = await prisma.jobLead.create({
    data: {
      userId: user.id,
      company: 'Acme Payments',
      title: 'Senior Backend Engineer',
      status: 'SAVED',
      jobDescription:
        'We are hiring a Senior Backend Engineer to build payment and data platforms with TypeScript, Node.js and PostgreSQL. You will own reliability, clear interfaces and production operations for a growing platform team.',
      skills: ['typescript', 'node.js', 'postgresql'],
      score: { fitScore: 82 },
      checklist: [],
      contacts: [],
      interviews: [],
      prepPack: {},
    },
  });

  const resume = await prisma.structuredResume.create({
    data: {
      userId: user.id,
      name: 'Master resume',
      content: typicalContent() as unknown as object,
      hiddenSections: [],
      sectionOrder: ['summary', 'experience', 'skills', 'education', 'projects', 'credentials'],
      targetJobId: null,
    },
  });

  return { user, job, resume };
}

describe('preparation planner', () => {
  it('prefers a resume already tailored to the job', () => {
    const content = typicalContent() as unknown as object;
    const selection = selectSourceResume({
      job: {
        id: 'job-1',
        title: 'Senior Backend Engineer',
        skills: ['typescript'],
        category: null,
        industry: null,
        jobDescription: 'Backend platform role.',
      },
      resumes: [
        {
          id: 'generic',
          name: 'Generic resume',
          content,
          targetJobId: null,
          revision: 1,
          updatedAt: new Date('2026-01-01T00:00:00Z'),
        },
        {
          id: 'targeted',
          name: 'Acme resume',
          content: { ...(content as Record<string, unknown>) },
          targetJobId: 'job-1',
          revision: 1,
          updatedAt: new Date('2025-01-01T00:00:00Z'),
        },
      ],
      hasConfirmedProfile: false,
    });

    expect(selection.kind).toBe('STRUCTURED_RESUME');
    expect(selection.resumeId).toBe('targeted');
    expect(selection.reason).toContain('already tailored to this job');
  });

  it('falls back to the confirmed profile when no usable resume exists', () => {
    const selection = selectSourceResume({
      job: {
        id: 'job-1',
        title: 'Backend Engineer',
        skills: [],
        category: null,
        industry: null,
        jobDescription: null,
      },
      resumes: [],
      hasConfirmedProfile: true,
    });

    expect(selection.kind).toBe('PROFILE');
    expect(selection.resumeId).toBeNull();
  });

  it('reports NONE when there is neither a resume nor a confirmed profile', () => {
    const selection = selectSourceResume({
      job: {
        id: 'job-1',
        title: 'Backend Engineer',
        skills: [],
        category: null,
        industry: null,
        jobDescription: null,
      },
      resumes: [],
      hasConfirmedProfile: false,
    });

    expect(selection.kind).toBe('NONE');
    expect(selection.reason).toContain('No resume or confirmed career profile');
  });

  it('defaults only include available, selected, executable items', () => {
    const plan = {
      items: [
        { type: 'COVER_LETTER', available: true, selectedByDefault: true },
        { type: 'RESUME_TAILORING', available: true, selectedByDefault: false },
        { type: 'SCREENING_ANSWERS', available: true, selectedByDefault: true },
        { type: 'INTERVIEW_BRIEFING', available: false, selectedByDefault: true },
      ],
    } as unknown as PreparationPlan;

    expect(defaultTasksForPlan(plan)).toEqual(['COVER_LETTER']);
  });

  it('dedupes by task set, not task order', () => {
    const base = {
      userId: 'user-1',
      jobId: 'job-1',
      fingerprint: 'fingerprint-1',
    };
    const left = preparationDedupeKey({
      ...base,
      tasks: ['COVER_LETTER', 'RESUME_TAILORING'],
    });
    const right = preparationDedupeKey({
      ...base,
      tasks: ['RESUME_TAILORING', 'COVER_LETTER'],
    });

    expect(left).toBe(right);
  });
});

describe('durable preparation runs', () => {
  it('creates one run per input set and never duplicates task rows', async () => {
    const { user, job } = await setup();

    const first = await createPreparationRun({
      userId: user.id,
      jobId: job.id,
      tasks: ['COVER_LETTER', 'COVER_LETTER'],
    });
    const second = await createPreparationRun({
      userId: user.id,
      jobId: job.id,
      tasks: ['COVER_LETTER'],
    });

    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.run.id).toBe(first.run.id);
    expect(first.run.tasks).toHaveLength(1);
    expect(first.run.requestedTasks).toEqual(['COVER_LETTER']);

    const median = await prisma.applicationPreparationRun.count({
      where: { userId: user.id, jobId: job.id },
    });
    expect(median).toBe(1);
  });

  it('keeps completed tasks and revives only the failed ones', async () => {
    const { user, job } = await setup();
    const calls: string[] = [];

    __setPreparationTaskExecutorForTests(async ({ type }) => {
      calls.push(type);
      if (type === 'RESUME_TAILORING') {
        return {
          status: 'COMPLETED',
          resultRef: 'resume-result-1',
          resultKind: 'RESUME',
        };
      }
      return { status: 'FAILED', errorCode: 'AI_TIMEOUT', retryable: true };
    });

    const created = await createPreparationRun({
      userId: user.id,
      jobId: job.id,
      tasks: ['RESUME_TAILORING', 'COVER_LETTER'],
    });
    expect(created.plan.limits.maxTasksPerRun).toBe(4);

    const afterFirstPass = await advanceUntilIdle({
      userId: user.id,
      runId: created.run.id,
      route: '/test',
      maxTasks: 4,
    });

    expect(afterFirstPass.run.completedTasks).toEqual(['RESUME_TAILORING']);
    const tailored = afterFirstPass.run.tasks.find((task) => task.type === 'RESUME_TAILORING');
    expect(tailored?.status).toBe('COMPLETED');
    expect(tailored?.resultRef).toBe('resume-result-1');

    const cover = afterFirstPass.run.tasks.find((task) => task.type === 'COVER_LETTER');
    expect(cover?.status).toBe('FAILED');
    expect(cover?.attempts).toBe(1);

    // Pressing "Prepare" again is idempotent: same run, failed task revived,
    // completed task untouched.
    const retried = await createPreparationRun({
      userId: user.id,
      jobId: job.id,
      tasks: ['RESUME_TAILORING', 'COVER_LETTER'],
    });
    expect(retried.reused).toBe(true);
    expect(retried.run.id).toBe(created.run.id);
    expect(retried.run.tasks).toHaveLength(2);
    expect(
      retried.run.tasks.find((task) => task.type === 'RESUME_TAILORING')?.status,
    ).toBe('COMPLETED');
    expect(
      retried.run.tasks.find((task) => task.type === 'COVER_LETTER')?.status,
    ).toBe('PENDING');

    __setPreparationTaskExecutorForTests(async () => ({
      status: 'COMPLETED',
      resultRef: 'cover-result-1',
      resultKind: 'MATERIAL',
    }));

    const finished = await advanceUntilIdle({
      userId: user.id,
      runId: created.run.id,
      route: '/test',
      maxTasks: 4,
    });

    expect(finished.run.status).toBe('COMPLETED');
    expect(finished.run.terminal).toBe(true);
    expect(finished.run.completedTasks.sort()).toEqual(['COVER_LETTER', 'RESUME_TAILORING']);
    // The completed resume task was not executed a second time.
    expect(calls.filter((type) => type === 'RESUME_TAILORING')).toHaveLength(1);
  });

  it('stops retrying at maxAttempts and reports a final failure', async () => {
    const { user, job } = await setup();
    __setPreparationTaskExecutorForTests(async () => ({
      status: 'FAILED',
      errorCode: 'AI_TIMEOUT',
      retryable: true,
    }));

    const created = await createPreparationRun({
      userId: user.id,
      jobId: job.id,
      tasks: ['COVER_LETTER'],
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await advancePreparationRun({
        userId: user.id,
        runId: created.run.id,
        route: '/test',
      });
      // The service schedules a backoff; move it into the past so the next
      // attempt is immediately claimable without sleeping in the test.
      await prisma.applicationPreparationTask.updateMany({
        where: { runId: created.run.id },
        data: { nextAttemptAt: new Date(Date.now() - 1_000) },
      });
    }

    const run = await getPreparationRun({ userId: user.id, runId: created.run.id });
    const task = run.tasks[0];
    expect(task.status).toBe('FAILED');
    expect(task.attempts).toBe(3);
    expect(run.status).toBe('FAILED');
    expect(run.terminal).toBe(true);
  });

  it('reclaims a task left RUNNING by an interrupted invocation', async () => {
    const { user, job } = await setup();
    __setPreparationTaskExecutorForTests(async () => ({
      status: 'COMPLETED',
      resultRef: 'resume-result-2',
      resultKind: 'RESUME',
    }));

    const created = await createPreparationRun({
      userId: user.id,
      jobId: job.id,
      tasks: ['RESUME_TAILORING'],
    });

    await prisma.applicationPreparationTask.updateMany({
      where: { runId: created.run.id },
      data: {
        status: 'RUNNING',
        attempts: 1,
        startedAt: new Date(Date.now() - 10 * 60 * 1000),
      },
    });

    const advanced = await advanceUntilIdle({
      userId: user.id,
      runId: created.run.id,
      route: '/test',
      maxTasks: 2,
    });

    expect(advanced.executed).toBe(true);
    expect(advanced.run.status).toBe('COMPLETED');
    expect(advanced.run.tasks[0].status).toBe('COMPLETED');
    expect(advanced.run.tasks[0].attempts).toBe(2);
  });

  it('scopes runs to their owner', async () => {
    const { user, job } = await setup();
    const stranger = await createUser();
    userIds.push(stranger.id);

    const created = await createPreparationRun({
      userId: user.id,
      jobId: job.id,
      tasks: ['COVER_LETTER'],
    });

    let readError: unknown = null;
    try {
      await getPreparationRun({ userId: stranger.id, runId: created.run.id });
    } catch (error) {
      readError = error;
    }
    expect(readError instanceof PreparationRunNotFoundError).toBe(true);

    let advanceError: unknown = null;
    try {
      await advancePreparationRun({
        userId: stranger.id,
        runId: created.run.id,
        route: '/test',
      });
    } catch (error) {
      advanceError = error;
    }
    expect(advanceError instanceof PreparationRunNotFoundError).toBe(true);
  });

  it('cancels a run, preserves completed work and refuses further advances', async () => {
    const { user, job } = await setup();
    __setPreparationTaskExecutorForTests(async ({ type }) =>
      type === 'RESUME_TAILORING'
        ? {
            status: 'COMPLETED',
            resultRef: 'resume-cancelled-run',
            resultKind: 'RESUME',
          }
        : { status: 'FAILED', errorCode: 'AI_TIMEOUT', retryable: true },
    );

    const created = await createPreparationRun({
      userId: user.id,
      jobId: job.id,
      tasks: ['RESUME_TAILORING', 'COVER_LETTER'],
    });

    await advanceUntilIdle({
      userId: user.id,
      runId: created.run.id,
      route: '/test',
      maxTasks: 4,
    });

    const cancelled = await cancelPreparationRun({
      userId: user.id,
      runId: created.run.id,
    });

    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.terminal).toBe(true);
    expect(cancelled.completedTasks).toEqual(['RESUME_TAILORING']);
    expect(
      cancelled.tasks.find((task) => task.type === 'RESUME_TAILORING')?.status,
    ).toBe('COMPLETED');
    expect(cancelled.tasks.find((task) => task.type === 'COVER_LETTER')?.status).toBe(
      'CANCELLED',
    );

    // Cancellation is idempotent, not an error.
    const again = await cancelPreparationRun({
      userId: user.id,
      runId: created.run.id,
    });
    expect(again.status).toBe('CANCELLED');

    let advanceError: unknown = null;
    try {
      await advancePreparationRun({
        userId: user.id,
        runId: created.run.id,
        route: '/test',
      });
    } catch (error) {
      advanceError = error;
    }
    expect(advanceError instanceof PreparationRunCancelledError).toBe(true);
  });

  it('retries one failed step without touching completed siblings', async () => {
    const { user, job } = await setup();
    const calls: string[] = [];
    let coverShouldFail = true;

    __setPreparationTaskExecutorForTests(async ({ type }) => {
      calls.push(type);
      if (type === 'RESUME_TAILORING') {
        return {
          status: 'COMPLETED',
          resultRef: 'resume-single-retry',
          resultKind: 'RESUME',
        };
      }
      return coverShouldFail
        ? { status: 'FAILED', errorCode: 'AI_TIMEOUT', retryable: true }
        : {
            status: 'COMPLETED',
            resultRef: 'cover-single-retry',
            resultKind: 'MATERIAL',
          };
    });

    const created = await createPreparationRun({
      userId: user.id,
      jobId: job.id,
      tasks: ['RESUME_TAILORING', 'COVER_LETTER'],
    });

    await advanceUntilIdle({
      userId: user.id,
      runId: created.run.id,
      route: '/test',
      maxTasks: 4,
    });

    const before = await getPreparationRun({ userId: user.id, runId: created.run.id });
    const cover = before.tasks.find((task) => task.type === 'COVER_LETTER');
    const resume = before.tasks.find((task) => task.type === 'RESUME_TAILORING');
    expect(cover?.status).toBe('FAILED');
    expect(resume?.status).toBe('COMPLETED');

    // A completed step is not retryable: that would spend credits to replace
    // a document the user already has.
    let completedRetryError: unknown = null;
    try {
      await retryPreparationTask({
        userId: user.id,
        runId: created.run.id,
        taskId: resume!.id,
      });
    } catch (error) {
      completedRetryError = error;
    }
    expect(completedRetryError instanceof PreparationTaskNotRetryableError).toBe(true);

    const retried = await retryPreparationTask({
      userId: user.id,
      runId: created.run.id,
      taskId: cover!.id,
    });

    expect(retried.status).toBe('QUEUED');
    expect(retried.tasks.find((task) => task.type === 'COVER_LETTER')?.status).toBe('PENDING');
    expect(retried.tasks.find((task) => task.type === 'COVER_LETTER')?.attempts).toBe(0);
    expect(retried.tasks.find((task) => task.type === 'RESUME_TAILORING')?.status).toBe(
      'COMPLETED',
    );

    coverShouldFail = false;
    const finished = await advanceUntilIdle({
      userId: user.id,
      runId: created.run.id,
      route: '/test',
      maxTasks: 4,
    });

    expect(finished.run.status).toBe('COMPLETED');
    expect(finished.run.tasks.every((task) => task.status === 'COMPLETED')).toBe(true);
    // The tailored resume was generated once, not again by the retry.
    expect(calls.filter((type) => type === 'RESUME_TAILORING')).toHaveLength(1);
  });

  it('revives cancelled steps when the user explicitly prepares again', async () => {
    const { user, job } = await setup();
    const created = await createPreparationRun({
      userId: user.id,
      jobId: job.id,
      tasks: ['COVER_LETTER', 'RECRUITER_MESSAGE'],
    });

    const cancelled = await cancelPreparationRun({
      userId: user.id,
      runId: created.run.id,
    });
    expect(cancelled.status).toBe('CANCELLED');

    const restarted = await createPreparationRun({
      userId: user.id,
      jobId: job.id,
      tasks: ['COVER_LETTER', 'RECRUITER_MESSAGE'],
    });

    expect(restarted.reused).toBe(true);
    expect(restarted.run.id).toBe(created.run.id);
    expect(restarted.run.status).toBe('QUEUED');
    expect(restarted.run.terminal).toBe(false);
    expect(restarted.run.tasks.every((task) => task.status === 'PENDING')).toBe(true);
    expect(restarted.run.tasks.every((task) => task.attempts === 0)).toBe(true);
  });

  it('does not start a task after the request deadline', async () => {
    const { user, job } = await setup();
    let calls = 0;
    __setPreparationTaskExecutorForTests(async () => {
      calls += 1;
      return { status: 'COMPLETED', resultRef: 'should-not-run', resultKind: 'MATERIAL' };
    });

    const created = await createPreparationRun({
      userId: user.id,
      jobId: job.id,
      tasks: ['COVER_LETTER'],
    });

    const result = await advanceUntilIdle({
      userId: user.id,
      runId: created.run.id,
      route: '/test',
      maxTasks: 4,
      deadlineAt: Date.now() - 1,
    });

    expect(calls).toBe(0);
    expect(result.executed).toBe(false);
    expect(result.run.status).toBe('QUEUED');
    expect(result.run.tasks[0].status).toBe('PENDING');
  });

  it('bounds a task that never returns and records a retryable timeout', async () => {
    const { user, job } = await setup();
    __setPreparationTaskExecutorForTests(
      () => new Promise<TaskExecutionOutcome>(() => undefined),
    );

    const created = await createPreparationRun({
      userId: user.id,
      jobId: job.id,
      tasks: ['COVER_LETTER'],
    });

    const result = await advancePreparationRun({
      userId: user.id,
      runId: created.run.id,
      route: '/test',
      timeoutMs: 25,
    });

    const task = result.run.tasks[0];
    expect(result.executed).toBe(true);
    expect(task.status).toBe('FAILED');
    expect(task.errorCode).toBe('AI_TIMEOUT');
    expect(task.attempts).toBe(1);
    // Still runnable, so the UI offers Retry this step rather than hanging.
    expect(result.run.status).toBe('QUEUED');
    expect(result.retryScheduled).toBe(true);
  });

  it('ignores a task result that arrives after the run was cancelled', async () => {
    const { user, job } = await setup();
    let resolveExecution!: (outcome: TaskExecutionOutcome) => void;

    __setPreparationTaskExecutorForTests(
      () =>
        new Promise<TaskExecutionOutcome>((resolve) => {
          resolveExecution = resolve;
        }),
    );

    const created = await createPreparationRun({
      userId: user.id,
      jobId: job.id,
      tasks: ['RESUME_TAILORING'],
    });

    const inFlight = advancePreparationRun({
      userId: user.id,
      runId: created.run.id,
      route: '/test',
    });

    // Wait until the durable claim has committed RUNNING, which is the exact
    // state that used to wedge the UI forever.
    let running = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const row = await prisma.applicationPreparationTask.findFirst({
        where: { runId: created.run.id },
      });
      if (row?.status === 'RUNNING') {
        running = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(running).toBe(true);

    const cancelled = await cancelPreparationRun({
      userId: user.id,
      runId: created.run.id,
    });
    expect(cancelled.status).toBe('CANCELLED');

    resolveExecution({
      status: 'COMPLETED',
      resultRef: 'late-result',
      resultKind: 'RESUME',
    });

    const result = await inFlight;
    expect(result.run.status).toBe('CANCELLED');
    expect(result.run.tasks[0].status).toBe('CANCELLED');
    expect(result.run.tasks[0].resultRef).toBeNull();
  });
});
