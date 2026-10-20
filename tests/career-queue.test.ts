import { describe, it, before, after, beforeEach } from './harness';
import assert from 'node:assert/strict';
import { prisma } from '@/lib/prisma';
import { createUser, destroyUser } from './helpers';
import { syncCareerActions, listCareerActions, createCareerAction, updateCareerAction } from '@/lib/career-queue/service';

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
});
