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

/**
 * Hard ceiling on one task execution.
 *
 * The advance route has a 60-second deployment budget. A task that runs past
 * this point is marked as a retryable timeout instead of leaving the row
 * RUNNING forever. The executor itself keeps its own, shorter provider
 * timeouts; this is the last-resort guard against a stalled promise.
 */
export const PREPARATION_TASK_EXECUTION_TIMEOUT_MS = 50_000;

/**
 * A RUNNING task older than this is treated as interrupted. It is longer than
 * the 50-second execution timeout, so a healthy task is never reclaimed by a
 * concurrent advance call, but short enough that a killed serverless request
 * does not make the user wait minutes before Continue works again.
 */
const PREPARATION_RUNNING_STALE_MS = 90 * 1000;

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

export class PreparationRunCancelledError extends Error {
  readonly code = 'PREPARATION_RUN_CANCELLED';
  readonly status = 409;
  constructor() {
    super('This preparation run was stopped. Retry a step or start a new run.');
    this.name = 'PreparationRunCancelledError';
  }
}

export class PreparationTaskNotFoundError extends Error {
  readonly code = 'PREPARATION_TASK_NOT_FOUND';
  readonly status = 404;
  constructor() {
    super('That preparation step could not be found.');
    this.name = 'PreparationTaskNotFoundError';
  }
}

export class PreparationTaskNotRetryableError extends Error {
  readonly code = 'PREPARATION_TASK_NOT_RETRYABLE';
  readonly status = 409;
  constructor(message: string) {
    super(message);
    this.name = 'PreparationTaskNotRetryableError';
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
  const active = await prisma.applicationPreparationTask.count({
    where: {
      runId,
      status: 'RUNNING',
      startedAt: { gte: new Date(Date.now() - PREPARATION_RUNNING_STALE_MS) },
    },
  });

  // Reusing a run while another invocation is genuinely executing a task must
  // be a no-op. Changing the run or task state underneath a live provider call
  // would make every status read lie until that call finished.
  if (active > 0) {
    return prisma.applicationPreparationRun.findUniqueOrThrow({
      where: { id: runId },
      include: { tasks: { orderBy: { createdAt: 'asc' } } },
    }) as unknown as Promise<RunRow>;
  }

  // `attempts < maxAttempts` compares two COLUMNS, which Prisma's filter API
  // cannot express. Raw SQL keeps the rule in one place and avoids loading
  // every task into the application to decide which ones are retryable.
  //
  // CANCELLED tasks are revived too: pressing the primary action again is an
  // explicit request to run the selection, so those steps get a fresh attempt
  // budget instead of staying dead forever.
  await prisma.$executeRaw`
    UPDATE "ApplicationPreparationTask"
    SET "status" = 'PENDING',
        "errorCode" = NULL,
        "nextAttemptAt" = NOW(),
        "startedAt" = NULL,
        "completedAt" = NULL,
        "attempts" = CASE WHEN "status" = 'CANCELLED' THEN 0 ELSE "attempts" END,
        "updatedAt" = NOW()
    WHERE "runId" = ${runId}
      AND (
        ("status" = 'FAILED' AND "attempts" < "maxAttempts")
        OR "status" = 'CANCELLED'
      )
  `;

  const tasks = await prisma.applicationPreparationTask.findMany({
    where: { runId },
    orderBy: { createdAt: 'asc' },
  });
  const runnable = tasks.some((task) => hasRunnable(task as unknown as TaskRow));
  const completedTasks = tasks
    .filter((task) => task.status === 'COMPLETED')
    .map((task) => task.type);
  const failedTasks = tasks
    .filter((task) => task.status === 'FAILED')
    .map((task) => task.type);

  return prisma.applicationPreparationRun.update({
    where: { id: runId },
    data: {
      status: runnable ? 'QUEUED' : completedTasks.length > 0 ? 'COMPLETED' : 'FAILED',
      completedTasks: completedTasks as never,
      failedTasks: failedTasks as never,
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
      // whole run. The window is longer than the 50-second execution timeout,
      // so a healthy task is never reclaimed underneath itself.
      await tx.$executeRaw`
        UPDATE "ApplicationPreparationTask"
        SET "status" = CASE WHEN "attempts" < "maxAttempts" THEN 'PENDING' ELSE 'FAILED' END,
            "errorCode" = CASE WHEN "attempts" < "maxAttempts" THEN NULL ELSE 'INTERRUPTED' END,
            "nextAttemptAt" = NOW(),
            "updatedAt" = NOW()
        WHERE "runId" = ${runId}
          AND "status" = 'RUNNING'
          AND "startedAt" < NOW() - INTERVAL '90 seconds'
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

  // Cancellation wins. If the user stopped the run while the provider call was
  // still in flight, the task row is already CANCELLED and must not be
  // overwritten by the late result. Any generated document still exists; it is
  // simply not attached to a cancelled run.
  async function commit(data: Prisma.ApplicationPreparationTaskUpdateManyMutationInput): Promise<void> {
    await prisma.applicationPreparationTask.updateMany({
      where: { id: task.id, status: 'RUNNING' },
      data,
    });
  }

  if (outcome.status === 'COMPLETED') {
    await commit({
      status: 'COMPLETED',
      completedAt: new Date(),
      resultRef: outcome.resultRef,
      resultKind: outcome.resultKind,
      metadata: (outcome.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      nextAttemptAt: new Date(),
    });
    return;
  }

  if (outcome.status === 'SKIPPED') {
    await commit({
      status: 'SKIPPED',
      completedAt: new Date(),
      errorCode: outcome.errorCode,
      metadata: (outcome.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      attempts: task.maxAttempts,
    });
    return;
  }

  const willRetry = outcome.retryable && task.attempts < task.maxAttempts;
  await commit({
    status: 'FAILED',
    errorCode: outcome.errorCode,
    metadata: (outcome.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    // A non-retryable failure is final on the first attempt. Setting attempts
    // to the ceiling makes that explicit to every future claim and to the UI.
    attempts: willRetry ? task.attempts : task.maxAttempts,
    completedAt: willRetry ? null : new Date(),
    nextAttemptAt: willRetry ? new Date(Date.now() + backoffMs(task.attempts)) : new Date(),
  });
}

async function recomputeRun(runId: string): Promise<RunRow> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.applicationPreparationRun.findUnique({
      where: { id: runId },
      select: { status: true },
    });
    if (!current) throw new PreparationRunNotFoundError();

    // A cancelled run stays cancelled even if an in-flight task finishes after
    // the cancel request. The guarded update in `finaliseTask` already ignores
    // that late result; this is the second half of the same guarantee.
    if (current.status === 'CANCELLED') {
      return tx.applicationPreparationRun.findUniqueOrThrow({
        where: { id: runId },
        include: { tasks: { orderBy: { createdAt: 'asc' } } },
      }) as unknown as Promise<RunRow>;
    }

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

/**
 * Stop a run and every unfinished step in it.
 *
 * Idempotent, and safe while a provider call is in flight: the guarded
 * finaliser ignores a result that arrives after cancellation, and the run is
 * never recomputed back into an active state. Completed artifacts are never
 * deleted.
 */
export async function cancelPreparationRun(params: {
  userId: string;
  runId: string;
}): Promise<PreparationRunSnapshot> {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${params.runId}))`;

    const run = await tx.applicationPreparationRun.findFirst({
      where: { id: params.runId, userId: params.userId },
      include: { tasks: { orderBy: { createdAt: 'asc' } } },
    });
    if (!run) throw new PreparationRunNotFoundError();

    const current = toRunSnapshot(run as unknown as RunRow);
    if (current.terminal) return { snapshot: current, changed: false };

    const completedTasks = run.tasks
      .filter((task) => task.status === 'COMPLETED')
      .map((task) => task.type);

    await tx.applicationPreparationTask.updateMany({
      where: {
        runId: run.id,
        status: { in: ['PENDING', 'RUNNING', 'FAILED'] },
      },
      data: {
        status: 'CANCELLED',
        errorCode: null,
        completedAt: new Date(),
        nextAttemptAt: new Date(),
      },
    });

    const updated = await tx.applicationPreparationRun.update({
      where: { id: run.id },
      data: {
        status: 'CANCELLED',
        completedTasks: completedTasks as never,
        failedTasks: [] as never,
        completedAt: new Date(),
      },
      include: { tasks: { orderBy: { createdAt: 'asc' } } },
    });

    return {
      snapshot: toRunSnapshot(updated as unknown as RunRow),
      changed: true,
    };
  });

  if (result.changed) {
    await logImportantInfo({
      event: 'application_preparation_run_cancelled',
      userId: params.userId,
      context: {
        runId: params.runId,
        completed: result.snapshot.completedTasks.length,
      },
    });
  }

  return result.snapshot;
}

/**
 * Restart exactly one step.
 *
 * This is the escape hatch the UI needs when a single provider call fails but
 * the rest of the run is healthy. Completed siblings are untouched, and the
 * task gets a fresh attempt budget because the user explicitly asked for it.
 */
export async function retryPreparationTask(params: {
  userId: string;
  runId: string;
  taskId: string;
}): Promise<PreparationRunSnapshot> {
  const row = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${params.runId}))`;

    const run = await tx.applicationPreparationRun.findFirst({
      where: { id: params.runId, userId: params.userId },
      include: { tasks: { orderBy: { createdAt: 'asc' } } },
    });
    if (!run) throw new PreparationRunNotFoundError();

    const task = run.tasks.find((entry) => entry.id === params.taskId);
    if (!task) throw new PreparationTaskNotFoundError();

    if (task.status === 'RUNNING') {
      throw new PreparationTaskNotRetryableError(
        'That step is still running. Stop the run first if it is stuck.',
      );
    }
    if (task.status === 'COMPLETED') {
      throw new PreparationTaskNotRetryableError('That step already finished.');
    }
    if (task.status === 'SKIPPED') {
      throw new PreparationTaskNotRetryableError(
        'That step was skipped because there was nothing safe to change. Retrying it will not produce a different result.',
      );
    }

    const siblingRunning = run.tasks.some(
      (entry) => entry.id !== task.id && entry.status === 'RUNNING',
    );
    if (siblingRunning) {
      throw new PreparationTaskNotRetryableError(
        'Wait for the current step to finish before retrying another one.',
      );
    }

    await tx.applicationPreparationTask.update({
      where: { id: task.id },
      data: {
        status: 'PENDING',
        attempts: 0,
        errorCode: null,
        nextAttemptAt: new Date(),
        startedAt: null,
        completedAt: null,
      },
    });

    const completedTasks = run.tasks
      .filter((entry) => entry.status === 'COMPLETED')
      .map((entry) => entry.type);

    await tx.applicationPreparationRun.update({
      where: { id: run.id },
      data: {
        status: 'QUEUED',
        completedTasks: completedTasks as never,
        // Every non-completed step was either just reset to PENDING or is
        // still CANCELLED; neither belongs in the failed list.
        failedTasks: [] as never,
        completedAt: null,
      },
    });

    return tx.applicationPreparationRun.findUniqueOrThrow({
      where: { id: run.id },
      include: { tasks: { orderBy: { createdAt: 'asc' } } },
    });
  });

  await logImportantInfo({
    event: 'application_preparation_task_retried',
    userId: params.userId,
    context: { runId: params.runId, taskId: params.taskId },
  });

  return toRunSnapshot(row as unknown as RunRow);
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

/**
 * Run one task with a hard ceiling.
 *
 * `taskExecutor` already applies provider-level timeouts, but a bug or a
 * stalled socket must never leave the database row RUNNING forever. A timeout
 * is recorded as a retryable failure, so the UI offers "Retry this step"
 * instead of an endless spinner.
 */
async function executeTaskWithTimeout(
  input: Parameters<PreparationTaskExecutor>[0],
  timeoutMs: number,
): Promise<Awaited<ReturnType<PreparationTaskExecutor>>> {
  const execution = taskExecutor(input);

  // The timeout does not cancel the underlying provider call. Attaching a
  // rejection handler keeps a late failure from becoming an unhandled
  // rejection after the race has already settled.
  execution.catch(() => undefined);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Awaited<ReturnType<PreparationTaskExecutor>>>((resolve) => {
    timer = setTimeout(
      () =>
        resolve({
          status: 'FAILED',
          errorCode: 'AI_TIMEOUT',
          retryable: true,
          metadata: { timedOut: true, timeoutMs },
        }),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([execution, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function advancePreparationRun(params: {
  userId: string;
  runId: string;
  route: string;
  /** Test seam. Production uses the constant above. */
  timeoutMs?: number;
}): Promise<AdvancePreparationResult> {
  const run = await prisma.applicationPreparationRun.findFirst({
    where: { id: params.runId, userId: params.userId },
    include: { tasks: { orderBy: { createdAt: 'asc' } } },
  });
  if (!run) throw new PreparationRunNotFoundError();

  const runRow = run as unknown as RunRow;

  // A stopped run must stay stopped. `retryPreparationTask` moves the run back
  // to QUEUED in the same transaction that revives its task, so a runnable
  // task is the only legitimate reason to advance a CANCELLED row.
  if (run.status === 'CANCELLED' && !toRunSnapshot(runRow).hasRunnableTask) {
    throw new PreparationRunCancelledError();
  }

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

  const outcome = await executeTaskWithTimeout(
    {
      userId: params.userId,
      jobId: run.jobId,
      type: claimed.type as PreparationTaskType,
      route: params.route,
      selection: selectionFromRun(runRow),
    },
    Math.max(1, params.timeoutMs ?? PREPARATION_TASK_EXECUTION_TIMEOUT_MS),
  );

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

/**
 * Time held back from the advance deadline for finalising the task and writing
 * the HTTP response. The route budget is 60 seconds; 3 seconds is ample for one
 * short transaction plus serialisation.
 */
const PREPARATION_ADVANCE_RESPONSE_RESERVE_MS = 3_000;

export async function advanceUntilIdle(params: {
  userId: string;
  runId: string;
  route: string;
  maxTasks?: number;
  /**
   * Absolute epoch time after which no new task may start. The route sets
   * this below its deployment limit; tests omit it to run the full selection.
   */
  deadlineAt?: number;
}): Promise<AdvanceUntilIdleResult> {
  const limit = Math.min(PREPARATION_MAX_TASKS_PER_RUN, Math.max(1, params.maxTasks ?? 1));
  let last: AdvancePreparationResult | null = null;
  let executed = false;

  for (let index = 0; index < limit; index += 1) {
    // A second task must never begin with less than a full execution window
    // left. Without this, `maxTasks: 4` could start a 46-second provider call
    // 50 seconds into a 60-second function and be killed mid-write.
    let timeoutMs: number | undefined;
    if (params.deadlineAt !== undefined) {
      const remaining = params.deadlineAt - Date.now() - PREPARATION_ADVANCE_RESPONSE_RESERVE_MS;
      if (remaining <= 0) break;
      timeoutMs = Math.min(PREPARATION_TASK_EXECUTION_TIMEOUT_MS, remaining);
    }

    try {
      last = await advancePreparationRun({ ...params, timeoutMs });
    } catch (error) {
      // A stop can land between two loop iterations. The work already
      // completed is still recorded, so return the cancelled snapshot rather
      // than turning a successful first step into an error response.
      if (error instanceof PreparationRunCancelledError) {
        last = null;
        break;
      }
      throw error;
    }
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
