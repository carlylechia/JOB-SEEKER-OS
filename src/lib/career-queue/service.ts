import { prisma } from '@/lib/prisma';
import { ACTIVE_JOB_STATUSES } from '@/lib/job-status';
import { buildCareerActionCandidates } from './prioritization';
import { CareerActionInput, CareerActionRecord, CareerActionStatus } from './types';
import { logImportantInfo, logImportantError } from '@/lib/observability';

const VALID_STATUSES: CareerActionStatus[] = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'DISMISSED'];

function isStatus(value: unknown): value is CareerActionStatus {
  return typeof value === 'string' && (VALID_STATUSES as string[]).includes(value);
}

async function assertJobOwnership(userId: string, jobId: string | null | undefined) {
  if (!jobId) return;
  const job = await prisma.jobLead.findFirst({ where: { id: jobId, userId }, select: { id: true } });
  if (!job) throw new Error('JOB_NOT_FOUND');
}

async function assertResumeOwnership(userId: string, resumeId: string | null | undefined) {
  if (!resumeId) return;
  const r = await prisma.structuredResume.findFirst({ where: { id: resumeId, userId }, select: { id: true } });
  if (!r) throw new Error('RESUME_NOT_FOUND');
}

async function assertPrepPackOwnership(userId: string, packId: string | null | undefined) {
  if (!packId) return;
  const p = await prisma.interviewPrepPack.findFirst({ where: { id: packId, userId }, select: { id: true } });
  if (!p) throw new Error('PREP_PACK_NOT_FOUND');
}

function actionKey(actionType: string, sourceId: string | null | undefined): string {
  return `${actionType}::${sourceId ?? ''}`;
}

function isAutoDismissed(metadata: unknown): boolean {
  return Boolean(
    metadata &&
      typeof metadata === 'object' &&
      !Array.isArray(metadata) &&
      (metadata as Record<string, unknown>).autoDismissed === true,
  );
}

/**
 * Removes open system actions whose triggering condition no longer exists.
 *
 * The important case is a job moving to REJECTED/ARCHIVED/OFFER (or being
 * deleted): candidate generation stops producing work for it, so any action
 * created while it was active must stop appearing in the queue. The same
 * reconciliation also clears actions whose underlying condition resolved
 * (for example a follow-up date changed or a draft material was finalised).
 *
 * Actions the user completed or dismissed manually are left untouched. Actions
 * dismissed here are marked with `autoDismissed` so a job that becomes active
 * again can revive its work instead of being stuck in the dismissed state.
 */
async function dismissStaleSystemActions(userId: string, validKeys: Set<string>): Promise<number> {
  const open = await prisma.careerAction.findMany({
    where: {
      userId,
      status: { in: ['PENDING', 'IN_PROGRESS'] },
      origin: { in: ['SYSTEM', 'AI'] },
    },
    select: { id: true, actionType: true, sourceId: true, metadata: true },
  });

  const stale = open.filter((action) => !validKeys.has(actionKey(action.actionType, action.sourceId)));
  if (stale.length === 0) return 0;

  const dismissedAt = new Date();
  for (const action of stale) {
    const metadata =
      action.metadata && typeof action.metadata === 'object' && !Array.isArray(action.metadata)
        ? (action.metadata as Record<string, unknown>)
        : {};

    await prisma.careerAction.update({
      where: { id: action.id },
      data: {
        status: 'DISMISSED',
        dismissedAt,
        metadata: {
          ...metadata,
          autoDismissed: true,
          autoDismissedAt: dismissedAt.toISOString(),
        },
      },
    });
  }

  await logImportantInfo({
    event: 'career_actions_auto_dismissed',
    userId,
    context: { count: stale.length },
  });

  return stale.length;
}

export async function syncCareerActions(userId: string): Promise<CareerActionRecord[]> {
  const candidates = await buildCareerActionCandidates(userId);
  const validKeys = new Set(candidates.map((candidate) => actionKey(candidate.actionType, candidate.sourceId)));

  for (const c of candidates) {
    try {
      const existing = await prisma.careerAction.findFirst({
        where: {
          userId,
          actionType: c.actionType,
          sourceId: c.sourceId ?? null,
        },
      });

      if (existing) {
        // A job that was temporarily inactive may have made this action stale.
        // If the condition is valid again, bring the auto-dismissed action back
        // instead of leaving the user permanently without the task.
        const reviving = existing.status === 'DISMISSED' && isAutoDismissed(existing.metadata);

        if (!reviving) {
          // Respect user decisions: do not reopen completed/dismissed.
          if (existing.status === 'COMPLETED' || existing.status === 'DISMISSED') continue;
          // Respect snooze: do not un-snooze.
          if (existing.snoozedUntil && existing.snoozedUntil > new Date()) continue;
        }

        await prisma.careerAction.update({
          where: { id: existing.id },
          data: {
            ...(reviving ? { status: 'PENDING', dismissedAt: null } : {}),
            title: c.title,
            description: c.description ?? null,
            priority: c.priority ?? existing.priority,
            dueDate: c.dueDate ?? existing.dueDate,
            estimatedMinutes: c.estimatedMinutes ?? existing.estimatedMinutes,
            relatedJobId: c.relatedJobId ?? existing.relatedJobId,
            relatedResumeId: c.relatedResumeId ?? existing.relatedResumeId,
            relatedPrepPackId: c.relatedPrepPackId ?? existing.relatedPrepPackId,
            metadata: (c.metadata as any) ?? existing.metadata,
          },
        });
      } else {
        await assertJobOwnership(userId, c.relatedJobId);
        await assertResumeOwnership(userId, c.relatedResumeId);
        await assertPrepPackOwnership(userId, c.relatedPrepPackId);

        await prisma.careerAction.create({
          data: {
            userId,
            actionType: c.actionType,
            title: c.title,
            description: c.description ?? null,
            status: c.status ?? 'PENDING',
            priority: c.priority ?? 0,
            dueDate: c.dueDate ?? null,
            estimatedMinutes: c.estimatedMinutes ?? null,
            sourceType: c.sourceType,
            sourceId: c.sourceId ?? null,
            relatedJobId: c.relatedJobId ?? null,
            relatedResumeId: c.relatedResumeId ?? null,
            relatedPrepPackId: c.relatedPrepPackId ?? null,
            origin: c.origin ?? 'SYSTEM',
            snoozedUntil: c.snoozedUntil ?? null,
            metadata: (c.metadata as any) ?? undefined,
          },
        });
      }
    } catch (error) {
      await logImportantError({
        event: 'career_action_sync_failed',
        userId,
        error,
        context: { actionType: c.actionType, sourceId: c.sourceId },
      });
    }
  }

  await dismissStaleSystemActions(userId, validKeys).catch(async (error) => {
    await logImportantError({
      event: 'career_action_cleanup_failed',
      userId,
      error,
    });
  });

  return listCareerActions(userId, { includeCompleted: false });
}

export async function listCareerActions(
  userId: string,
  opts: { status?: string; includeCompleted?: boolean; limit?: number } = {},
): Promise<CareerActionRecord[]> {
  const where: Record<string, unknown> = { userId };
  if (opts.status) where.status = opts.status;
  if (!opts.includeCompleted) {
    where.status = { in: ['PENDING', 'IN_PROGRESS'] };
    where.OR = [{ snoozedUntil: null }, { snoozedUntil: { lte: new Date() } }];
  }

  // Defence in depth: even if a caller skips sync (or cleanup failed), never
  // surface work tied to a job that is closed or deleted. Actions without a
  // job (profile, weekly review) are unaffected.
  where.AND = [
    {
      OR: [
        { relatedJobId: null },
        {
          relatedJob: {
            deletedAt: null,
            status: { in: [...ACTIVE_JOB_STATUSES] },
          },
        },
      ],
    },
  ];

  const rows = await prisma.careerAction.findMany({
    where,
    orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
    take: opts.limit ?? 100,
  });

  // Filter snoozed items still in future (Prisma OR above imperfect)
  const now = new Date();
  return rows.filter((r) => !r.snoozedUntil || r.snoozedUntil <= now) as unknown as CareerActionRecord[];
}

export async function createCareerAction(userId: string, input: CareerActionInput): Promise<CareerActionRecord> {
  await assertJobOwnership(userId, input.relatedJobId);
  await assertResumeOwnership(userId, input.relatedResumeId);
  await assertPrepPackOwnership(userId, input.relatedPrepPackId);

  const row = await prisma.careerAction.create({
    data: {
      userId,
      actionType: input.actionType,
      title: input.title,
      description: input.description ?? null,
      status: input.status ?? 'PENDING',
      priority: input.priority ?? 0,
      dueDate: input.dueDate ?? null,
      estimatedMinutes: input.estimatedMinutes ?? null,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      relatedJobId: input.relatedJobId ?? null,
      relatedResumeId: input.relatedResumeId ?? null,
      relatedPrepPackId: input.relatedPrepPackId ?? null,
      origin: input.origin ?? 'USER',
      snoozedUntil: input.snoozedUntil ?? null,
      metadata: (input.metadata as any) ?? undefined,
    },
  });

  await logImportantInfo({ event: 'career_action_created', userId, context: { actionId: row.id, actionType: row.actionType, origin: row.origin } });
  return row as unknown as CareerActionRecord;
}

export async function getCareerAction(userId: string, id: string): Promise<CareerActionRecord | null> {
  const row = await prisma.careerAction.findFirst({ where: { id, userId } });
  return (row as unknown as CareerActionRecord) ?? null;
}

export type CareerActionPatch = {
  title?: string;
  description?: string | null;
  status?: string;
  priority?: number;
  dueDate?: Date | null;
  estimatedMinutes?: number | null;
  snoozedUntil?: Date | null;
};

export async function updateCareerAction(userId: string, id: string, patch: CareerActionPatch): Promise<CareerActionRecord> {
  const existing = await prisma.careerAction.findFirst({ where: { id, userId } });
  if (!existing) throw new Error('NOT_FOUND');

  // User-created actions can be edited more freely; system actions preserve origin.
  const data: Record<string, unknown> = {};
  if (patch.title !== undefined) data.title = patch.title;
  if (patch.description !== undefined) data.description = patch.description;
  if (patch.priority !== undefined) data.priority = patch.priority;
  if (patch.dueDate !== undefined) data.dueDate = patch.dueDate;
  if (patch.estimatedMinutes !== undefined) data.estimatedMinutes = patch.estimatedMinutes;
  if (patch.snoozedUntil !== undefined) data.snoozedUntil = patch.snoozedUntil;

  if (patch.status !== undefined) {
    if (!isStatus(patch.status)) throw new Error('INVALID_STATUS');
    data.status = patch.status;
    if (patch.status === 'COMPLETED') data.completedAt = new Date();
    if (patch.status === 'DISMISSED') data.dismissedAt = new Date();
    if (patch.status === 'PENDING' || patch.status === 'IN_PROGRESS') {
      data.completedAt = null;
      data.dismissedAt = null;
    }

    // A manual status change takes ownership of the decision. Drop the
    // auto-dismiss marker so a later sync cannot silently revive the action.
    if (existing.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata)) {
      const metadata = { ...(existing.metadata as Record<string, unknown>) };
      if ('autoDismissed' in metadata || 'autoDismissedAt' in metadata) {
        delete metadata.autoDismissed;
        delete metadata.autoDismissedAt;
        data.metadata = metadata;
      }
    }
  }

  const updated = await prisma.careerAction.update({ where: { id }, data });

  if (patch.status === 'COMPLETED') {
    await logImportantInfo({ event: 'career_action_completed', userId, context: { actionId: id } });
  } else if (patch.status === 'DISMISSED') {
    await logImportantInfo({ event: 'career_action_dismissed', userId, context: { actionId: id } });
  } else if (patch.snoozedUntil) {
    await logImportantInfo({ event: 'career_action_snoozed', userId, context: { actionId: id } });
  }

  return updated as unknown as CareerActionRecord;
}

export async function deleteCareerAction(userId: string, id: string): Promise<void> {
  const existing = await prisma.careerAction.findFirst({ where: { id, userId } });
  if (!existing) throw new Error('NOT_FOUND');
  if (existing.origin !== 'USER') throw new Error('FORBIDDEN_DELETE');
  await prisma.careerAction.delete({ where: { id } });
}
