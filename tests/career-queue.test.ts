import { describe, it, before, after, beforeEach } from './harness';
import assert from 'node:assert/strict';
import { prisma } from '@/lib/prisma';
import { createUser, destroyUser } from './helpers';
import { syncCareerActions, listCareerActions, createCareerAction, updateCareerAction } from '@/lib/career-queue/service';
import { isActiveJobStatus } from '@/lib/job-status';

describe('career queue', () => {
  let userId: string;

  before(async () => {
    const user = await createUser({ name: 'Career Queue Tester' });
    userId = user.id;
  });

  after(async () => {
    await destroyUser(userId);
  });

  beforeEach(async () => {
    await prisma.careerAction.deleteMany({ where: { userId } });
  });

  it('treats only in-play statuses as active', () => {
    for (const status of ['LEAD', 'SAVED', 'APPLYING', 'APPLIED', 'INTERVIEWING']) {
      assert.equal(isActiveJobStatus(status), true, `${status} should be active`);
    }
    for (const status of ['OFFER', 'REJECTED', 'ARCHIVED', 'WITHDRAWN', 'ABANDONED', null, undefined]) {
      assert.equal(isActiveJobStatus(status), false, `${status} should be inactive`);
    }
  });

  it('syncs deterministic actions from jobs', async () => {
    await prisma.jobLead.create({
      data: {
        userId,
        company: 'Acme',
        title: 'Engineer',
        status: 'SAVED',
        score: { fitScore: 85, fitTier: 'A' } as any,
        checklist: {} as any,
        contacts: [] as any,
        interviews: [] as any,
        prepPack: {} as any,
      },
    });

    const actions = await syncCareerActions(userId);
    assert.ok(actions.length >= 1);
    const apply = actions.find((a) => a.actionType === 'APPLY_TO_JOB');
    assert.ok(apply, 'expected an apply action');
  });

  it('completes an action and preserves status', async () => {
    const created = await createCareerAction(userId, {
      userId,
      actionType: 'REVIEW_WEEKLY_PROGRESS',
      title: 'Review progress',
      sourceType: 'USER_CREATED',
      origin: 'USER',
    } as any);
    const updated = await updateCareerAction(userId, created.id, { status: 'COMPLETED' });
    assert.equal(updated.status, 'COMPLETED');
    assert.ok(updated.completedAt);
  });

  it('does not duplicate system recommendations on resync', async () => {
    await prisma.jobLead.create({
      data: {
        userId,
        company: 'Beta',
        title: 'Developer',
        status: 'SAVED',
        score: { fitScore: 90, fitTier: 'A' } as any,
        checklist: {} as any,
        contacts: [] as any,
        interviews: [] as any,
        prepPack: {} as any,
      },
    });
    await syncCareerActions(userId);
    const first = await listCareerActions(userId, { includeCompleted: true });
    const count1 = first.filter((a) => a.actionType === 'APPLY_TO_JOB').length;
    await syncCareerActions(userId);
    const second = await listCareerActions(userId, { includeCompleted: true });
    const count2 = second.filter((a) => a.actionType === 'APPLY_TO_JOB').length;
    assert.equal(count1, count2);
  });

  it('never lists an open action for an inactive job even before cleanup runs', async () => {
    const job = await prisma.jobLead.create({
      data: {
        userId,
        company: 'Epsilon',
        title: 'Engineering Manager',
        status: 'REJECTED',
        score: { fitScore: 80, fitTier: 'A' } as any,
        checklist: {} as any,
        contacts: [] as any,
        interviews: [] as any,
        prepPack: {} as any,
      },
    });

    await prisma.careerAction.create({
      data: {
        userId,
        actionType: 'PREPARE_INTERVIEW',
        title: 'Prepare for Epsilon interview',
        sourceType: 'INTERVIEW_PREPARATION',
        sourceId: 'manual-test-action',
        status: 'PENDING',
        origin: 'SYSTEM',
        relatedJobId: job.id,
      },
    });

    const actions = await listCareerActions(userId);
    assert.equal(
      actions.some((action) => action.relatedJobId === job.id),
      false,
      'inactive jobs must not leak through the queue read path',
    );
  });

  it('removes and revives job actions as the job moves out of and back into play', async () => {
    const job = await prisma.jobLead.create({
      data: {
        userId,
        company: 'Gamma',
        title: 'Platform Engineer',
        status: 'SAVED',
        score: { fitScore: 88, fitTier: 'A' } as any,
        checklist: {} as any,
        contacts: [] as any,
        interviews: [] as any,
        prepPack: {} as any,
      },
    });

    const before = await syncCareerActions(userId);
    const apply = before.find(
      (action) => action.actionType === 'APPLY_TO_JOB' && action.relatedJobId === job.id,
    );
    assert.ok(apply, 'expected an apply action while the job is active');

    await prisma.jobLead.update({
      where: { id: job.id },
      data: { status: 'REJECTED' },
    });

    const afterReject = await syncCareerActions(userId);
    assert.equal(
      afterReject.some((action) => action.relatedJobId === job.id),
      false,
      'rejected job actions must disappear from the queue',
    );

    const dismissed = await prisma.careerAction.findUnique({ where: { id: apply.id } });
    assert.equal(dismissed?.status, 'DISMISSED');

    await prisma.jobLead.update({
      where: { id: job.id },
      data: { status: 'SAVED' },
    });

    const afterRevive = await syncCareerActions(userId);
    const revived = afterRevive.find(
      (action) => action.actionType === 'APPLY_TO_JOB' && action.relatedJobId === job.id,
    );
    assert.ok(revived, 'expected the action to return when the job is active again');
    assert.equal(revived.id, apply.id, 'the existing action should be revived, not duplicated');
  });

  it('stops interview practice prompts for a job that is no longer active', async () => {
    const job = await prisma.jobLead.create({
      data: {
        userId,
        company: 'Delta',
        title: 'Staff Engineer',
        status: 'INTERVIEWING',
        score: { fitScore: 82, fitTier: 'A' } as any,
        checklist: {} as any,
        contacts: [] as any,
        interviews: [
          {
            id: 'interview-1',
            company: 'Delta',
            title: 'Staff Engineer',
            stage: 'VIDEO',
            interviewType: 'VIDEO',
            scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
            outcome: 'PENDING',
            prepStatus: 'NOT_STARTED',
          },
        ] as any,
        prepPack: {} as any,
      },
    });

    const before = await syncCareerActions(userId);
    assert.ok(
      before.some(
        (action) =>
          action.relatedJobId === job.id &&
          (action.actionType === 'PREPARE_INTERVIEW' ||
            action.actionType === 'PRACTICE_INTERVIEW_QUESTION'),
      ),
      'expected interview prep work while the job is active',
    );

    await prisma.jobLead.update({
      where: { id: job.id },
      data: { status: 'REJECTED' },
    });

    const after = await syncCareerActions(userId);
    assert.equal(
      after.some((action) => action.relatedJobId === job.id),
      false,
      'rejected jobs must not keep interview prompts in the queue',
    );
  });
});
