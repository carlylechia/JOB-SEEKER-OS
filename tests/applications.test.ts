/**
 * Application lifecycle — attempt and evidence rules.
 *
 * The central claim: an application can never reach APPLIED without a CONFIRMED
 * attempt carrying evidence. Every path that tries is tested.
 */

import { describe, it, afterEach, expect } from './harness';
import { prisma } from '@/lib/prisma';
import { createUser, destroyUser } from './helpers';
import {
  ApplicationNotFoundError,
  ApplicationTransitionError,
  AttemptValidationError,
  SubmissionEvidenceRequiredError,
  ensureApplication,
  getApplication,
  recordAttempt,
  transitionApplication,
} from '@/lib/applications/service';

const userIds: string[] = [];

afterEach(async () => {
  for (const id of userIds.splice(0)) {
    await destroyUser(id).catch(() => undefined);
  }
});

async function setup() {
  const user = await createUser();
  userIds.push(user.id);

  const job = await prisma.jobLead.create({
    data: {
      userId: user.id,
      company: 'Acme Payments',
      title: 'Senior Backend Engineer',
      status: 'APPLYING',
      score: { fitScore: 82 },
      checklist: [],
      contacts: [],
      interviews: [],
      prepPack: {},
    },
  });

  return { user, job };
}

describe('application attempts', () => {
  it('treats a user assertion as an attempt, never as proof of application', async () => {
    const { user, job } = await setup();

    const result = await recordAttempt({
      userId: user.id,
      jobId: job.id,
      channel: 'WEB_FORM',
      status: 'ATTEMPTED',
      reason: 'Submitted through the careers page.',
    });

    expect(result.application.status).toBe('IN_PROGRESS');
    expect(result.markedApplied).toBe(false);
    expect(result.attempt.status).toBe('ATTEMPTED');

    const detail = await getApplication({ userId: user.id, jobId: job.id });
    expect(detail?.application.status).toBe('IN_PROGRESS');
    expect(detail?.events.map((event) => event.type)).toContain('ATTEMPT_RECORDED');
    expect(detail?.events.some((event) => event.type === 'SUBMISSION_CONFIRMED')).toBe(false);
  });

  it('moves to APPLIED only with confirmed evidence', async () => {
    const { user, job } = await setup();

    const result = await recordAttempt({
      userId: user.id,
      jobId: job.id,
      channel: 'WEB_FORM',
      status: 'CONFIRMED',
      evidenceKind: 'CONFIRMATION_PAGE',
      evidenceRef: 'acme-careers.example/confirmation/12345',
      evidenceSummary: 'The employer showed a confirmation page after submission.',
    });

    expect(result.application.status).toBe('APPLIED');
    expect(result.markedApplied).toBe(true);
    expect(result.attempt.evidenceKind).toBe('CONFIRMATION_PAGE');

    const detail = await getApplication({ userId: user.id, jobId: job.id });
    expect(detail?.events.map((event) => event.type)).toContain('SUBMISSION_CONFIRMED');
    expect(detail?.application.status).toBe('APPLIED');
  });

  it('rejects a confirmed attempt without evidence', async () => {
    const { user, job } = await setup();

    let error: unknown = null;
    try {
      await recordAttempt({
        userId: user.id,
        jobId: job.id,
        channel: 'WEB_FORM',
        status: 'CONFIRMED',
        evidenceRef: 'I think it went through',
      });
    } catch (caught) {
      error = caught;
    }

    expect(error instanceof AttemptValidationError).toBe(true);
    // Nothing was created: no application, no attempt, no event.
    const detail = await getApplication({ userId: user.id, jobId: job.id });
    expect(detail).toBeNull();
    expect(await prisma.applicationAttempt.count({ where: { userId: user.id } })).toBe(0);
  });

  it('rejects a manual transition to APPLIED without evidence', async () => {
    const { user, job } = await setup();
    await ensureApplication({ userId: user.id, jobId: job.id });

    let error: unknown = null;
    try {
      await transitionApplication({
        userId: user.id,
        jobId: job.id,
        toStatus: 'APPLIED',
      });
    } catch (caught) {
      error = caught;
    }

    expect(error instanceof SubmissionEvidenceRequiredError).toBe(true);
    const detail = await getApplication({ userId: user.id, jobId: job.id });
    expect(detail?.application.status).toBe('NOT_STARTED');
  });

  it('allows a manual transition once evidence exists', async () => {
    const { user, job } = await setup();
    await recordAttempt({
      userId: user.id,
      jobId: job.id,
      channel: 'EMAIL',
      status: 'CONFIRMED',
      evidenceKind: 'EMAIL',
      evidenceRef: 'outlook-message-id-987',
    });

    const updated = await transitionApplication({
      userId: user.id,
      jobId: job.id,
      toStatus: 'INTERVIEWING',
      reason: 'First-round invite received.',
    });

    expect(updated.status).toBe('INTERVIEWING');
  });

  it('rejects impossible transitions', async () => {
    const { user, job } = await setup();
    await ensureApplication({ userId: user.id, jobId: job.id });

    let error: unknown = null;
    try {
      await transitionApplication({
        userId: user.id,
        jobId: job.id,
        toStatus: 'INTERVIEWING',
      });
    } catch (caught) {
      error = caught;
    }

    expect(error instanceof ApplicationTransitionError).toBe(true);
    const detail = await getApplication({ userId: user.id, jobId: job.id });
    expect(detail?.application.status).toBe('NOT_STARTED');

    // A legal path still works after the rejected one.
    const moved = await transitionApplication({
      userId: user.id,
      jobId: job.id,
      toStatus: 'IN_PROGRESS',
    });
    expect(moved.status).toBe('IN_PROGRESS');
  });

  it('keeps one application per user and job, and keeps multiple attempts', async () => {
    const { user, job } = await setup();
    const first = await ensureApplication({ userId: user.id, jobId: job.id });
    const second = await ensureApplication({ userId: user.id, jobId: job.id });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.application.id).toBe(first.application.id);

    await recordAttempt({
      userId: user.id,
      jobId: job.id,
      channel: 'WEB_FORM',
      status: 'ATTEMPTED',
    });
    await recordAttempt({
      userId: user.id,
      jobId: job.id,
      channel: 'WEB_FORM',
      status: 'CONFIRMED',
      evidenceKind: 'ATS_WEBHOOK',
      evidenceRef: 'webhook-evt_123',
    });

    const count = await prisma.application.count({
      where: { userId: user.id, jobId: job.id },
    });
    const attempts = await prisma.applicationAttempt.count({
      where: { userId: user.id, jobId: job.id },
    });

    expect(count).toBe(1);
    expect(attempts).toBe(2);
  });

  it('refuses an attempt on another user’s job', async () => {
    const { user, job } = await setup();
    const stranger = await createUser();
    userIds.push(stranger.id);

    let error: unknown = null;
    try {
      await recordAttempt({
        userId: stranger.id,
        jobId: job.id,
        channel: 'WEB_FORM',
        status: 'ATTEMPTED',
      });
    } catch (caught) {
      error = caught;
    }

    expect(error instanceof ApplicationNotFoundError).toBe(true);
    const count = await prisma.application.count({ where: { jobId: job.id } });
    expect(count).toBe(0);
  });

  it('records an ordered, explainable timeline', async () => {
    const { user, job } = await setup();

    await recordAttempt({
      userId: user.id,
      jobId: job.id,
      channel: 'WEB_FORM',
      status: 'ATTEMPTED',
    });
    await recordAttempt({
      userId: user.id,
      jobId: job.id,
      channel: 'WEB_FORM',
      status: 'CONFIRMED',
      evidenceKind: 'SCREENSHOT',
      evidenceRef: 'screenshot-1',
    });

    const detail = await getApplication({ userId: user.id, jobId: job.id });
    expect(detail?.events.map((event) => event.type)).toEqual([
      'ATTEMPT_RECORDED',
      'SUBMISSION_CONFIRMED',
    ]);
    expect(detail?.events[0].toStatus).toBe('IN_PROGRESS');
    expect(detail?.events[1].toStatus).toBe('APPLIED');
  });
});
