/**
 * Durable application-preparation workflow.
 *
 * WHY THIS IS NOT ONE LONG REQUEST
 * A preparation run touches three different providers (resume optimisation,
 * writing, interview research) and each can take tens of seconds. Doing all of
 * them in one HTTP request would make a single timeout lose every successful
 * result, and a retry would pay for all of them again.
 *
 * Instead:
 *   - one run row and N task rows are written first (idempotently);
 *   - each advance call claims at most ONE task, executes it, and records the
 *     result independently;
 *   - a failed task can be retried without touching successful siblings;
 *   - the client polls, but the state lives in Postgres, so leaving the page
 *     and coming back loses nothing.
 *
 * `FOR UPDATE SKIP LOCKED` plus a per-run advisory lock make the claim safe
 * across concurrent serverless invocations. The advisory lock is held only for
 * the short claim transaction, never across a provider call.
 */

import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireEntitlement } from '@/lib/billing/subscriptions';
import type { FeatureKey } from '@/lib/billing/plans';
import { logImportantInfo } from '@/lib/observability';
import {
  buildPreparationPlan,
  defaultTasksForPlan,
  preparationDedupeKey,
} from './plan';
import { executePreparationTask, taskErrorMessage, type RunSelection } from './executors';
import {
  EXECUTABLE_TASK_TYPES,
  TASK_LABELS,
  type PreparationPlan,
  type PreparationRunSnapshot,
  type PreparationStatus,
  type PreparationTaskSnapshot,
  type PreparationTaskType,
} from './types';

export const PREPARATION_MAX_TASKS_PER_RUN = 4;
const CLAIM_TRANSACTION_TIMEOUT_MS = 10_000;

type PreparationTaskExecutor = typeof executePreparationTask;

/**
 * Test seam, mirroring the `__set…ProviderFactory` pattern used by the AI
 * clients. It lets the durable state machine be exercised without a network
 * call. Production code never calls this.
 */
let taskExecutor: PreparationTaskExecutor = executePreparationTask;

export function __setPreparationTaskExecutorForTests(
  next: PreparationTaskExecutor | null,
): void {
  taskExecutor = next ?? executePreparationTask;
}

export class PreparationJobNotFoundError extends Error {
  readonly code = 'PREPARATION_JOB_NOT_FOUND';
  readonly status = 404;
  constructor() {
    super('That job could not be found.');
    this.name = 'PreparationJobNotFoundError';
  }
}

export class PreparationRunNotFoundError extends Error {
  readonly code = 'PREPARATION_RUN_NOT_FOUND';
  readonly status = 404;
  constructor() {
    super('That preparation run could not be found.');
    this.name = 'PreparationRunNotFoundError';
  }
}

export class PreparationValidationError extends Error {
  readonly code = 'PREPARATION_INVALID_TASKS';
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'PreparationValidationError';
  }
}

const TASK_FEATURES: Partial<Record<PreparationTaskType, FeatureKey>> = {
  RESUME_TAILORING: 'RESUME_OPTIMIZATION',
  COVER_LETTER: 'AI_COVER_LETTER',
  RECRUITER_MESSAGE: 'AI_COVER_LETTER',
  INTERVIEW_BRIEFING: 'AI_INTERVIEW_PREP',
};

type TaskRow = {
  id: string;
  type: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  errorCode: string | null;
  resultRef: string | null;
  resultKind: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  nextAttemptAt: Date;
};

type RunRow = {
  id: string;
  userId: string;
  jobId: string;
  status: string;
  requestedTasks: string[];
  completedTasks: string[];
  failedTasks: string[];
  selectionJson: unknown;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  tasks: TaskRow[];
};

function resultHref(kind: string | null, ref: string | null): string | null {
  if (!ref) return null;
  if (kind === 'RESUME') return `/resumes/${ref}`;
  if (kind === 'MATERIAL') return `/application-materials/${ref}`;
  if (kind === 'PREP_PACK') return `/interview-prep/${ref}`;
  return null;
}

function toTaskSnapshot(task: TaskRow): PreparationTaskSnapshot {
  return {
    id: task.id,
    type: task.type as PreparationTaskType,
    label: TASK_LABELS[task.type as PreparationTaskType] ?? task.type,
    status: task.status,
    attempts: task.attempts,
    maxAttempts: task.maxAttempts,
    errorCode: task.errorCode,
    errorMessage: taskErrorMessage(task.errorCode),
    resultRef: task.resultRef,
    resultKind: task.resultKind,
    resultHref: resultHref(task.resultKind, task.resultRef),
    startedAt: task.startedAt?.toISOString() ?? null,
    completedAt: task.completedAt?.toISOString() ?? null,
    nextAttemptAt: task.nextAttemptAt.toISOString(),
  };
}

function hasRunnable(task: TaskRow): boolean {
  if (task.status === 'PENDING') return true;
  if (task.status === 'FAILED' && task.attempts < task.maxAttempts) return true;
  if (task.status === 'RUNNING') return true;
  return false;
}

function toRunSnapshot(run: RunRow): PreparationRunSnapshot {
  const tasks = run.tasks.map(toTaskSnapshot);
  const hasRunnableTask = run.tasks.some((task) => hasRunnable(task));
  const terminal = !hasRunnableTask && !run.tasks.some((task) => task.status === 'RUNNING');

  return {
    id: run.id,
    jobId: run.jobId,
    status: run.status as PreparationRunSnapshot['status'],
    requestedTasks: run.requestedTasks as PreparationTaskType[],
    completedTasks: run.completedTasks as PreparationTaskType[],
    failedTasks: run.failedTasks as PreparationTaskType[],
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
    tasks,
    terminal,
    hasRunnableTask,
  };
}

export async function getLatestPreparationRun(params: {
  userId: string;
  jobId: string;
}): Promise<PreparationRunSnapshot | null> {
  const row = await prisma.applicationPreparationRun.findFirst({
    where: { userId: params.userId, jobId: params.jobId },
    orderBy: { createdAt: 'desc' },
    include: { tasks: { orderBy: { createdAt: 'asc' } } },
  });
  return row ? toRunSnapshot(row as unknown as RunRow) : null;
}

/** One run, ownership-scoped. Another user's id is indistinguishable from a
 *  missing one, as everywhere else in the app. */
export async function getPreparationRun(params: {
  userId: string;
  runId: string;
}): Promise<PreparationRunSnapshot> {
  const row = await prisma.applicationPreparationRun.findFirst({
    where: { id: params.runId, userId: params.userId },
    include: { tasks: { orderBy: { createdAt: 'asc' } } },
  });
  if (!row) throw new PreparationRunNotFoundError();
  return toRunSnapshot(row as unknown as RunRow);
}

export async function getPreparationStatus(params: {
  userId: string;
  jobId: string;
}): Promise<PreparationStatus | null> {
  const built = await buildPreparationPlan(params);
  if (!built) return null;
  const run = await getLatestPreparationRun(params);
  return { plan: built.plan, run };
}

function selectionFromPlan(plan: PreparationPlan, sourceResumeRevision: number | null): RunSelection {
  return {
    sourceKind: plan.sourceResume.kind,
    sourceResumeId: plan.sourceResume.resumeId,
    sourceResumeRevision,
    sourceReason: plan.sourceResume.reason,
  };
}

function normaliseRequestedTasks(plan: PreparationPlan, requested: unknown): PreparationTaskType[] {
  const fallback = defaultTasksForPlan(plan);
  const raw = Array.isArray(requested) ? requested : fallback;

  const unique = Array.from(new Set(raw)) as PreparationTaskType[];
  if (unique.length === 0) {
    throw new PreparationValidationError(
      'Choose at least one material to prepare. Add a resume or confirm your career profile first.',
    );
  }
  if (unique.length > PREPARATION_MAX_TASKS_PER_RUN) {
    throw new PreparationValidationError(
      `Choose at most ${PREPARATION_MAX_TASKS_PER_RUN} materials in one preparation run.`,
    );
  }

  for (const type of unique) {
    const item = plan.items.find((entry) => entry.type === type);
    if (!item) {
      throw new PreparationValidationError('That preparation task is not part of this plan.');
    }
    if (!item.available || !(EXECUTABLE_TASK_TYPES as readonly string[]).includes(type)) {
      throw new PreparationValidationError(item.reason);
    }
  }

  return unique;
}

async function assertTaskEntitlements(userId: string, tasks: PreparationTaskType[]): Promise<void> {
  const features = Array.from(
    new Set(
      tasks
        .map((task) => TASK_FEATURES[task])
        .filter((feature): feature is FeatureKey => Boolean(feature)),
    ),
  );
  for (const feature of features) {
    await requireEntitlement(userId, feature);
  }
}

export type CreatePreparationRunOptions = {
  userId: string;
  jobId: string;
  tasks?: unknown;
};

export type CreatePreparationRunResult = {
  plan: PreparationPlan;
  run: PreparationRunSnapshot;
  reused: boolean;
};

export async function createPreparationRun(
  options: CreatePreparationRunOptions,
): Promise<CreatePreparationRunResult> {
  const built = await buildPreparationPlan(options);
  if (!built) throw new PreparationJobNotFoundError();

  const plan = built.plan;
  if (!plan.canPrepare && (!Array.isArray(options.tasks) || options.tasks.length === 0)) {
    throw new PreparationValidationError(
      plan.blockers[0] ?? 'This application is not ready for preparation yet.',
    );
  }

  const requested = normaliseRequestedTasks(plan, options.tasks);
  await assertTaskEntitlements(options.userId, requested);

  const selection = selectionFromPlan(plan, built.sourceResumeRevision);
  const dedupeKey = preparationDedupeKey({
    userId: options.userId,
    jobId: options.jobId,
    fingerprint: plan.fingerprint,
    tasks: requested,
  });

  const existing = await prisma.applicationPreparationRun.findUnique({
    where: { dedupeKey },
    include: { tasks: { orderBy: { createdAt: 'asc' } } },
  });

  if (existing) {
    const revived = await reviveFailedTasks(existing.id);
    return {
      plan,
      run: toRunSnapshot(revived as unknown as RunRow),
      reused: true,
    };
  }

  try {
    const created = await prisma.applicationPreparationRun.create({
      data: {
        userId: options.userId,
        jobId: options.jobId,
        status: 'QUEUED',
        requestedTasks: requested as never,
        completedTasks: [] as never,
        failedTasks: [] as never,
        inputFingerprint: plan.fingerprint,
        dedupeKey,
        selectionJson: {
          ...selection,
          tasks: requested,
        } as unknown as Prisma.InputJsonValue,
        tasks: {
          create: requested.map((type) => ({
            userId: options.userId,
            jobId: options.jobId,
            type,
            status: 'PENDING',
            taskKey: type.toLowerCase(),
            maxAttempts: 3,
          })),
        },
      },
      include: { tasks: { orderBy: { createdAt: 'asc' } } },
    });

    await logImportantInfo({
      event: 'application_preparation_run_created',
      userId: options.userId,
      context: { runId: created.id, jobId: options.jobId, tasks: requested },
    });

    return {
      plan,
      run: toRunSnapshot(created as unknown as RunRow),
      reused: false,
    };
  } catch (error) {
    // Two tabs can race the unique dedupe key. The loser reuses the winner.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const raced = await prisma.applicationPreparationRun.findUnique({
        where: { dedupeKey },
        include: { tasks: { orderBy: { createdAt: 'asc' } } },
      });
      if (raced) {
        return {
          plan,
          run: toRunSnapshot(raced as unknown as RunRow),
          reused: true,
        };
      }
    }
    throw error;
  }
}

/**
 * Bring a previously failed run back to a runnable state without touching any
 * task that already completed. Returning to a page and pressing prepare again
 * retries only what failed.
 */
async function reviveFailedTasks(runId: string): Promise<RunRow> {
  // `attempts < maxAttempts` compares two COLUMNS, which Prisma's filter API
  // cannot express. Raw SQL keeps the rule in one place and avoids loading
  // every task into the application to decide which ones are retryable.
  await prisma.$executeRaw`
    UPDATE "ApplicationPreparationTask"
    SET "status" = 'PENDING',
        "errorCode" = NULL,
        "nextAttemptAt" = NOW(),
        "updatedAt" = NOW()
    WHERE "runId" = ${runId}
      AND "status" = 'FAILED'
      AND "attempts" < "maxAttempts"
  `;

  const tasks = await prisma.applicationPreparationTask.findMany({
    where: { runId },
    orderBy: { createdAt: 'asc' },
  });
  const runnable = tasks.some((task) => hasRunnable(task as unknown as TaskRow));

  return prisma.applicationPreparationRun.update({
    where: { id: runId },
    data: {
      status: runnable ? 'QUEUED' : tasks.some((task) => task.status === 'COMPLETED') ? 'COMPLETED' : 'FAILED',
      completedAt: runnable ? null : new Date(),
    },
    include: { tasks: { orderBy: { createdAt: 'asc' } } },
  }) as unknown as Promise<RunRow>;
}

function selectionFromRun(run: RunRow): RunSelection {
  const raw = (run.selectionJson ?? {}) as Partial<RunSelection>;
  return {
    sourceKind:
      raw.sourceKind === 'PROFILE' || raw.sourceKind === 'STRUCTURED_RESUME' || raw.sourceKind === 'NONE'
        ? raw.sourceKind
        : 'NONE',
    sourceResumeId: typeof raw.sourceResumeId === 'string' ? raw.sourceResumeId : null,
    sourceResumeRevision:
      typeof raw.sourceResumeRevision === 'number' ? raw.sourceResumeRevision : null,
    sourceReason: typeof raw.sourceReason === 'string' ? raw.sourceReason : '',
  };
}

async function claimNextTask(runId: string): Promise<TaskRow | null> {
  return prisma.$transaction(
    async (tx) => {
      // One advance at a time per run, even if two tabs poll simultaneously.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${runId}))`;

      // A request that died mid-provider-call leaves its task RUNNING forever.
      // Once the execution window has passed, return it to the queue (or fail
      // it when attempts are exhausted) so one interruption cannot wedge the
      // whole run. Five minutes is longer than any provider timeout.
      await tx.$executeRaw`
        UPDATE "ApplicationPreparationTask"
        SET "status" = CASE WHEN "attempts" < "maxAttempts" THEN 'PENDING' ELSE 'FAILED' END,
            "errorCode" = CASE WHEN "attempts" < "maxAttempts" THEN NULL ELSE 'INTERRUPTED' END,
            "nextAttemptAt" = NOW(),
            "updatedAt" = NOW()
        WHERE "runId" = ${runId}
          AND "status" = 'RUNNING'
          AND "startedAt" < NOW() - INTERVAL '5 minutes'
      `;

      const running = await tx.applicationPreparationTask.count({
        where: { runId, status: 'RUNNING' },
      });
      if (running > 0) return null;

      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "ApplicationPreparationTask"
        WHERE "runId" = ${runId}
          AND (
            "status" = 'PENDING'
            OR ("status" = 'FAILED' AND "attempts" < "maxAttempts" AND "nextAttemptAt" <= NOW())
          )
        ORDER BY "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `;

      const next = rows[0];
      if (!next) return null;

      return tx.applicationPreparationTask.update({
        where: { id: next.id },
        data: {
          status: 'RUNNING',
          attempts: { increment: 1 },
          startedAt: new Date(),
          errorCode: null,
        },
      }) as unknown as Promise<TaskRow>;
    },
    { timeout: CLAIM_TRANSACTION_TIMEOUT_MS },
  );
}

function backoffMs(attempts: number): number {
  return Math.min(120_000, 10_000 * Math.max(1, attempts));
}

async function finaliseTask(params: {
  task: TaskRow;
  outcome: Awaited<ReturnType<typeof executePreparationTask>>;
}): Promise<void> {
  const { task, outcome } = params;

  if (outcome.status === 'COMPLETED') {
    await prisma.applicationPreparationTask.update({
      where: { id: task.id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        resultRef: outcome.resultRef,
        resultKind: outcome.resultKind,
        metadata: (outcome.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        nextAttemptAt: new Date(),
      },
    });
    return;
  }

  if (outcome.status === 'SKIPPED') {
    await prisma.applicationPreparationTask.update({
      where: { id: task.id },
      data: {
        status: 'SKIPPED',
        completedAt: new Date(),
        errorCode: outcome.errorCode,
        metadata: (outcome.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        attempts: task.maxAttempts,
      },
    });
    return;
  }

  const willRetry = outcome.retryable && task.attempts < task.maxAttempts;
  await prisma.applicationPreparationTask.update({
    where: { id: task.id },
    data: {
      status: 'FAILED',
      errorCode: outcome.errorCode,
      metadata: (outcome.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      // A non-retryable failure is final on the first attempt. Setting attempts
      // to the ceiling makes that explicit to every future claim and to the UI.
      attempts: willRetry ? task.attempts : task.maxAttempts,
      completedAt: willRetry ? null : new Date(),
      nextAttemptAt: willRetry ? new Date(Date.now() + backoffMs(task.attempts)) : new Date(),
    },
  });
}

async function recomputeRun(runId: string): Promise<RunRow> {
  return prisma.$transaction(async (tx) => {
    const tasks = await tx.applicationPreparationTask.findMany({
      where: { runId },
      orderBy: { createdAt: 'asc' },
    });

    const completed = tasks.filter((task) => task.status === 'COMPLETED');
    const failed = tasks.filter((task) => task.status === 'FAILED');
    const running = tasks.filter((task) => task.status === 'RUNNING');
    const runnable = tasks.some((task) => hasRunnable(task as unknown as TaskRow));

    let status: string;
    if (running.length > 0) status = 'RUNNING';
    // Runnable but nothing executing means the run is waiting for the next
    // advance call, not actively running.
    else if (runnable) status = 'QUEUED';
    else if (completed.length > 0 && failed.length > 0) status = 'PARTIALLY_COMPLETED';
    else if (failed.length > 0) status = 'FAILED';
    else if (completed.length > 0) status = 'COMPLETED';
    else status = 'FAILED';

    const terminal = status === 'COMPLETED' || status === 'PARTIALLY_COMPLETED' || status === 'FAILED';

    return tx.applicationPreparationRun.update({
      where: { id: runId },
      data: {
        status,
        completedTasks: completed.map((task) => task.type) as never,
        failedTasks: failed.map((task) => task.type) as never,
        completedAt: terminal ? new Date() : null,
      },
      include: { tasks: { orderBy: { createdAt: 'asc' } } },
    }) as unknown as Promise<RunRow>;
  });
}

export type AdvancePreparationResult = {
  run: PreparationRunSnapshot;
  /** True when this call executed a task. */
  executed: boolean;
  /** The task that ran, when one did. */
  taskId: string | null;
  /** True when a retry is scheduled for the future; the caller should wait. */
  retryScheduled: boolean;
};

export async function advancePreparationRun(params: {
  userId: string;
  runId: string;
  route: string;
}): Promise<AdvancePreparationResult> {
  const run = await prisma.applicationPreparationRun.findFirst({
    where: { id: params.runId, userId: params.userId },
    include: { tasks: { orderBy: { createdAt: 'asc' } } },
  });
  if (!run) throw new PreparationRunNotFoundError();

  const runRow = run as unknown as RunRow;
  const claimed = await claimNextTask(run.id);

  if (!claimed) {
    const refreshed = await recomputeRun(run.id);
    const tasks = refreshed.tasks as unknown as TaskRow[];
    // A retry is only "scheduled" when nothing else is ready to run right now.
    // Otherwise the next advance should pick up the pending sibling instead.
    const retryScheduled =
      !tasks.some((task) => task.status === 'PENDING') &&
      tasks.some(
        (task) => task.status === 'FAILED' && task.attempts < task.maxAttempts,
      );
    return {
      run: toRunSnapshot(refreshed),
      executed: false,
      taskId: null,
      retryScheduled,
    };
  }

  // Mark the run as RUNNING immediately so a status read during a long provider
  // call reports the truth instead of "QUEUED".
  await prisma.applicationPreparationRun.update({
    where: { id: run.id },
    data: { status: 'RUNNING' },
  });

  const outcome = await taskExecutor({
    userId: params.userId,
    jobId: run.jobId,
    type: claimed.type as PreparationTaskType,
    route: params.route,
    selection: selectionFromRun(runRow),
  });

  await finaliseTask({ task: claimed, outcome });
  const refreshed = await recomputeRun(run.id);

  await logImportantInfo({
    event: 'application_preparation_task_finished',
    userId: params.userId,
    context: {
      runId: run.id,
      jobId: run.jobId,
      taskType: claimed.type,
      outcome: outcome.status,
      errorCode: outcome.status === 'COMPLETED' ? null : outcome.errorCode,
    },
  });

  const tasks = refreshed.tasks as unknown as TaskRow[];
  return {
    run: toRunSnapshot(refreshed),
    executed: true,
    taskId: claimed.id,
    retryScheduled:
      !tasks.some((task) => task.status === 'PENDING') &&
      tasks.some(
        (task) => task.status === 'FAILED' && task.attempts < task.maxAttempts,
      ),
  };
}

/**
 * A bounded advance loop used by the HTTP route when the caller explicitly asks
 * for it. One task at a time; stops on the first failure so a broken provider
 * cannot burn the whole task set.
 */
export type AdvanceUntilIdleResult = {
  run: PreparationRunSnapshot;
  /** True when this call executed at least one task. */
  executed: boolean;
  /** True when a retry is pending and nothing else was ready to run. */
  retryScheduled: boolean;
};

export async function advanceUntilIdle(params: {
  userId: string;
  runId: string;
  route: string;
  maxTasks?: number;
}): Promise<AdvanceUntilIdleResult> {
  const limit = Math.min(PREPARATION_MAX_TASKS_PER_RUN, Math.max(1, params.maxTasks ?? 1));
  let last: AdvancePreparationResult | null = null;
  let executed = false;

  for (let index = 0; index < limit; index += 1) {
    last = await advancePreparationRun(params);
    if (last.executed) executed = true;
    if (!last.executed || last.run.terminal) break;
    if (last.retryScheduled) break;
  }

  if (last) {
    return {
      run: last.run,
      executed,
      retryScheduled: last.retryScheduled,
    };
  }

  const refreshed = await prisma.applicationPreparationRun.findFirst({
    where: { id: params.runId, userId: params.userId },
    include: { tasks: { orderBy: { createdAt: 'asc' } } },
  });
  if (!refreshed) throw new PreparationRunNotFoundError();
  return {
    run: toRunSnapshot(refreshed as unknown as RunRow),
    executed: false,
    retryScheduled: false,
  };
}
