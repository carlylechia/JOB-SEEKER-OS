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
  createPreparationRun,
  getPreparationRun,
  PreparationRunNotFoundError,
  __setPreparationTaskExecutorForTests,
} from '@/lib/application-preparation/service';
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
});
