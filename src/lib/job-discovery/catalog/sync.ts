import type { JobSource } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { logImportantError, logImportantInfo } from '@/lib/observability';
import { ProviderHttpError } from '../http';
import { normalizeJob } from '../normalize';
import type { CatalogSyncOptions, ProviderFetchResult } from '../types';
import { ensureJobSourcesSeeded } from './seed';
import { closeMissingFromBoard, closeStaleCatalogueJobs, persistSourceJobs } from './persist';
import {
  isProviderConfigured,
  isProviderEnabledByEnv,
  PROVIDER_DEFINITIONS,
  runProviderFetch,
} from './providers';
import { recordProviderHealth } from '../source-health';

const DEFAULT_TIME_BUDGET_MS = 45_000;
const MAX_TIME_BUDGET_MS = 55_000;
const MAX_JOBS_PER_BOARD = 300;
const MAX_JOBS_PER_FEED = 150;
const MAX_BOARDS_PER_PROVIDER: Record<string, number> = {
  greenhouse: 30,
  lever: 5,
  ashby: 8,
};

type TaskOutcome = {
  provider: string;
  sourceId: string;
  sourceType: 'board' | 'feed';
  attempted: boolean;
  skipped?: string;
  success: boolean;
  category?: string;
  error?: string;
  jobsRetrieved: number;
  jobsAccepted: number;
  created: number;
  updated: number;
  closed: number;
  duplicatesDiscarded: number;
  requests: number;
  latencyMs: number;
  rateLimitRemaining?: number | null;
  quotaExhausted?: boolean;
  notes?: string[];
};

function isStale(source: JobSource, now: number) {
  if (!source.lastSyncedAt) return true;
  const definition = PROVIDER_DEFINITIONS[source.provider as keyof typeof PROVIDER_DEFINITIONS];
  const refreshAfter = definition?.refreshAfterMs ?? 24 * 60 * 60 * 1000;
  return now - source.lastSyncedAt.getTime() >= refreshAfter;
}

async function headcountBudgetRemaining(now = new Date()) {
  const budget = Number(process.env.HEADCOUNTLABS_MONTHLY_RECORD_BUDGET ?? '5000');
  if (!Number.isFinite(budget) || budget <= 0) return 0;
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const runs = await prisma.jobCatalogSyncRun.findMany({
    where: { startedAt: { gte: monthStart }, status: { in: ['COMPLETED', 'PARTIAL'] } },
    select: { metrics: true },
  });
  let used = 0;
  for (const run of runs) {
    const metrics = run.metrics as { providers?: Record<string, { jobsRetrieved?: number }> } | null;
    used += metrics?.providers?.headcountlabs?.jobsRetrieved ?? 0;
  }
  return Math.max(0, Math.round(budget) - used);
}

async function executeSource(
  source: JobSource,
  runId: string,
  deadline: number,
): Promise<TaskOutcome> {
  const definition = PROVIDER_DEFINITIONS[source.provider as keyof typeof PROVIDER_DEFINITIONS];
  const base: TaskOutcome = {
    provider: source.provider,
    sourceId: source.id,
    sourceType: definition.kind,
    attempted: true,
    success: false,
    jobsRetrieved: 0,
    jobsAccepted: 0,
    created: 0,
    updated: 0,
    closed: 0,
    duplicatesDiscarded: 0,
    requests: 0,
    latencyMs: 0,
  };

  if (!definition) {
    return { ...base, attempted: false, skipped: 'UNKNOWN_PROVIDER', error: 'Unknown provider' };
  }
  if (!isProviderEnabledByEnv(source.provider)) {
    return { ...base, attempted: false, skipped: 'ENV_DISABLED' };
  }
  if (!isProviderConfigured(source.provider, source.boardToken)) {
    return { ...base, attempted: false, skipped: 'NOT_CONFIGURED' };
  }

  const remaining = deadline - Date.now();
  if (remaining < 2_000) {
    return { ...base, attempted: false, skipped: 'TIME_BUDGET' };
  }

  const started = Date.now();
  const maxJobs = definition.kind === 'board' ? MAX_JOBS_PER_BOARD : MAX_JOBS_PER_FEED;
  try {
    const result: ProviderFetchResult = await runProviderFetch(source.provider, {
      source: {
        id: source.id,
        provider: source.provider,
        displayName: source.displayName,
        employerName: source.employerName,
        boardToken: source.boardToken,
        careersUrl: source.careersUrl,
        descriptionMode: source.descriptionMode,
        attribution: source.attribution,
        attributionUrl: source.attributionUrl,
        attributionRequired: source.attributionRequired,
        allowStructuredData: source.allowStructuredData,
        retentionDays: source.retentionDays,
      },
      signal: AbortSignal.timeout(Math.min(30_000, remaining)),
      maxJobs,
    });

    const jobs = result.jobs.map(normalizeJob);
    const persisted = await persistSourceJobs(source.id, jobs);
    let closed = 0;
    if (definition.kind === 'board' && result.complete) {
      closed = await closeMissingFromBoard(source.id, new Date(started));
    }

    await prisma.jobSource.update({
      where: { id: source.id },
      data: {
        lastSyncedAt: new Date(),
        lastSuccessAt: new Date(),
        jobsRetrieved: jobs.length,
        jobsAccepted: persisted.accepted,
        lastError: null,
        failureCategory: null,
      },
    });

    return {
      ...base,
      success: true,
      jobsRetrieved: jobs.length,
      jobsAccepted: persisted.accepted,
      created: persisted.created,
      updated: persisted.updated,
      closed,
      duplicatesDiscarded: persisted.duplicatesDiscarded,
      requests: result.requests,
      latencyMs: Date.now() - started,
      rateLimitRemaining: result.rateLimitRemaining ?? null,
      quotaExhausted: result.quotaExhausted,
      notes: result.notes,
    };
  } catch (error) {
    const category = error instanceof ProviderHttpError ? error.category : 'UNKNOWN';
    const message = error instanceof Error ? error.message : 'Unknown provider error';
    await prisma.jobSource.update({
      where: { id: source.id },
      data: {
        lastFailureAt: new Date(),
        lastError: message.slice(0, 1_000),
        failureCategory: category,
      },
    }).catch(() => undefined);
    return {
      ...base,
      category,
      error: message,
      latencyMs: Date.now() - started,
    };
  }
}

async function runPool<T, R>(
  items: T[],
  concurrency: number,
  deadline: number,
  worker: (item: T) => Promise<R>,
): Promise<{ results: R[]; stopped: boolean }> {
  const results: R[] = [];
  let index = 0;
  let stopped = false;

  async function next() {
    while (index < items.length) {
      if (Date.now() >= deadline) {
        stopped = true;
        return;
      }
      const current = items[index];
      index += 1;
      results.push(await worker(current));
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => next()));
  return { results, stopped };
}

function providerRollup(outcomes: TaskOutcome[]) {
  const providers: Record<string, {
    attempted: number;
    succeeded: number;
    failed: number;
    skipped: number;
    requests: number;
    jobsRetrieved: number;
    jobsAccepted: number;
    boardsAttempted: number;
    boardsSucceeded: number;
    latencyMs: number;
    errors: string[];
    rateLimitRemaining: number | null;
    quotaState: string | null;
  }> = {};

  for (const outcome of outcomes) {
    const row = providers[outcome.provider] ?? {
      attempted: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      requests: 0,
      jobsRetrieved: 0,
      jobsAccepted: 0,
      boardsAttempted: 0,
      boardsSucceeded: 0,
      latencyMs: 0,
      errors: [],
      rateLimitRemaining: null,
      quotaState: null,
    };
    if (outcome.attempted) row.attempted += 1;
    if (outcome.skipped) row.skipped += 1;
    if (outcome.success) row.succeeded += 1;
    else if (outcome.attempted) row.failed += 1;
    row.requests += outcome.requests;
    row.jobsRetrieved += outcome.jobsRetrieved;
    row.jobsAccepted += outcome.jobsAccepted;
    if (outcome.sourceType === 'board') {
      row.boardsAttempted += outcome.attempted ? 1 : 0;
      row.boardsSucceeded += outcome.success ? 1 : 0;
    }
    row.latencyMs += outcome.latencyMs;
    if (outcome.error && row.errors.length < 5) row.errors.push(`${outcome.sourceId}: ${outcome.error}`.slice(0, 300));
    if (outcome.rateLimitRemaining != null) row.rateLimitRemaining = outcome.rateLimitRemaining;
    if (outcome.quotaExhausted) row.quotaState = 'EXHAUSTED';
    providers[outcome.provider] = row;
  }

  return providers;
}

export async function runCatalogSync(options: CatalogSyncOptions = {}) {
  const trigger = options.trigger ?? 'cron';
  const timeBudgetMs = Math.max(5_000, Math.min(options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS, MAX_TIME_BUDGET_MS));
  const startedAt = new Date();
  const deadline = startedAt.getTime() + timeBudgetMs;
  const run = await prisma.jobCatalogSyncRun.create({
    data: { trigger, status: 'RUNNING', metrics: {} },
  });

  try {
    await ensureJobSourcesSeeded();
    const now = Date.now();
    let sources = await prisma.jobSource.findMany({ where: { enabled: true } });
    if (options.sourceIds?.length) {
      const wanted = new Set(options.sourceIds);
      sources = sources.filter((source) => wanted.has(source.id));
    }

    // Feed providers go first: they carry the widest inventory and are cheap.
    const feeds = sources
      .filter((source) => PROVIDER_DEFINITIONS[source.provider as keyof typeof PROVIDER_DEFINITIONS]?.kind === 'feed')
      .filter((source) => isStale(source, now));

    const boards = sources
      .filter((source) => PROVIDER_DEFINITIONS[source.provider as keyof typeof PROVIDER_DEFINITIONS]?.kind === 'board')
      .filter((source) => isStale(source, now))
      .sort((a, b) => (a.lastSyncedAt?.getTime() ?? 0) - (b.lastSyncedAt?.getTime() ?? 0));

    const cappedBoards: JobSource[] = [];
    const perProvider = new Map<string, number>();
    for (const board of boards) {
      const cap = MAX_BOARDS_PER_PROVIDER[board.provider] ?? 20;
      const count = perProvider.get(board.provider) ?? 0;
      if (count >= cap) continue;
      perProvider.set(board.provider, count + 1);
      cappedBoards.push(board);
    }

    const preflight: TaskOutcome[] = [];
    if (feeds.some((source) => source.provider === 'headcountlabs')) {
      const remaining = await headcountBudgetRemaining();
      if (remaining <= 0) {
        feeds.splice(0, feeds.length, ...feeds.filter((source) => source.provider !== 'headcountlabs'));
        preflight.push({
          provider: 'headcountlabs',
          sourceId: 'headcountlabs:feed',
          sourceType: 'feed',
          attempted: false,
          skipped: 'MONTHLY_BUDGET',
          success: false,
          jobsRetrieved: 0,
          jobsAccepted: 0,
          created: 0,
          updated: 0,
          closed: 0,
          duplicatesDiscarded: 0,
          requests: 0,
          latencyMs: 0,
          notes: [`remaining_budget:0`],
        });
      }
    }

    const feedPool = await runPool(feeds, 2, deadline, (source) => executeSource(source, run.id, deadline));
    const boardPool = await runPool(cappedBoards, 3, deadline, (source) => executeSource(source, run.id, deadline));
    const outcomes = [...preflight, ...feedPool.results, ...boardPool.results];
    const stoppedForTime = feedPool.stopped || boardPool.stopped || cappedBoards.length + feeds.length > outcomes.length;
    const closedStale = await closeStaleCatalogueJobs();

    const providers = providerRollup(outcomes);
    for (const [provider, row] of Object.entries(providers)) {
      const definition = PROVIDER_DEFINITIONS[provider as keyof typeof PROVIDER_DEFINITIONS];
      const anyAttempt = row.attempted > 0;
      const allConfigured = outcomes
        .filter((outcome) => outcome.provider === provider && outcome.skipped === 'NOT_CONFIGURED')
        .length === 0;
      await recordProviderHealth({
        provider,
        success: row.succeeded > 0,
        category: row.succeeded > 0 ? null : row.errors[0] ? 'PROVIDER_ERROR' : row.quotaState ? 'QUOTA_EXHAUSTED' : 'NOT_CONFIGURED',
        error: row.errors[0] ?? (row.quotaState === 'EXHAUSTED' ? 'Provider quota exhausted' : allConfigured ? null : 'Missing provider configuration'),
        jobsRetrieved: row.jobsRetrieved,
        jobsAccepted: row.jobsAccepted,
        boardsAttempted: row.boardsAttempted,
        boardsSucceeded: row.boardsSucceeded,
        latencyMs: row.attempted > 0 ? Math.round(row.latencyMs / row.attempted) : null,
        rateLimitRemaining: row.rateLimitRemaining,
        quotaState: row.quotaState,
        runId: run.id,
      }).catch(() => undefined);
      if (definition && !anyAttempt && row.skipped === 0) {
        // no-op: provider had no stale sources this run
      }
    }

    const attempted = outcomes.filter((outcome) => outcome.attempted);
    const succeeded = attempted.filter((outcome) => outcome.success);
    const failed = attempted.filter((outcome) => !outcome.success);
    const jobsRetrieved = outcomes.reduce((sum, outcome) => sum + outcome.jobsRetrieved, 0);
    const jobsCreated = outcomes.reduce((sum, outcome) => sum + outcome.created, 0);
    const jobsUpdated = outcomes.reduce((sum, outcome) => sum + outcome.updated, 0);
    const jobsClosed = outcomes.reduce((sum, outcome) => sum + outcome.closed, 0) + closedStale;
    const duplicatesDiscarded = outcomes.reduce((sum, outcome) => sum + outcome.duplicatesDiscarded, 0);
    const quotaStopped = outcomes.some((outcome) => outcome.quotaExhausted || outcome.skipped === 'MONTHLY_BUDGET');
    const providerNames = [...new Set(outcomes.map((outcome) => outcome.provider))];
    const providerSucceeded = providerNames.filter((provider) => providers[provider]?.succeeded > 0).length;
    const providerFailed = providerNames.filter((provider) => providers[provider]?.failed > 0).length;

    const hasIncomplete =
      failed.length > 0 ||
      stoppedForTime ||
      quotaStopped ||
      outcomes.some((outcome) => outcome.skipped === 'TIME_BUDGET' || outcome.skipped === 'MONTHLY_BUDGET');

    const status = attempted.length === 0
      ? (outcomes.some((o) => o.skipped === 'MONTHLY_BUDGET' || o.skipped === 'TIME_BUDGET') ? 'PARTIAL' : 'COMPLETED')
      : hasIncomplete
        ? (succeeded.length > 0 ? 'PARTIAL' : 'FAILED')
        : 'COMPLETED';

    const metrics = {
      timeBudgetMs,
      durationMs: Date.now() - startedAt.getTime(),
      stoppedForTime,
      staleSourcesRemaining: Math.max(0, cappedBoards.length + feeds.length - outcomes.filter((outcome) => outcome.attempted).length),
      skipped: outcomes.filter((outcome) => outcome.skipped).map((outcome) => ({ sourceId: outcome.sourceId, reason: outcome.skipped })),
      providers,
      closedStale,
      errors: failed.slice(0, 10).map((outcome) => `${outcome.sourceId}: ${outcome.error ?? outcome.category ?? 'unknown'}`),
      notes: outcomes.flatMap((outcome) => (outcome.notes ?? []).map((note) => `${outcome.sourceId}:${note}`)).slice(0, 20),
    } satisfies Prisma.InputJsonObject;

    const updated = await prisma.jobCatalogSyncRun.update({
      where: { id: run.id },
      data: {
        status,
        completedAt: new Date(),
        durationMs: metrics.durationMs,
        providersAttempted: providerNames.length,
        providersSucceeded: providerSucceeded,
        providersFailed: providerFailed,
        boardsAttempted: attempted.filter((outcome) => outcome.sourceType === 'board').length,
        boardsSucceeded: succeeded.filter((outcome) => outcome.sourceType === 'board').length,
        jobsRetrieved,
        jobsCreated,
        jobsUpdated,
        jobsClosed,
        duplicatesDiscarded,
        timeBudgetExhausted: stoppedForTime,
        quotaStopped,
        lastError: metrics.errors.length > 0 ? metrics.errors.join('; ') : null,
        metrics,
      },
    });

    await logImportantInfo({
      event: 'job_catalog_sync_completed',
      context: {
        runId: run.id,
        status,
        jobsRetrieved,
        jobsCreated,
        jobsUpdated,
        jobsClosed,
        quotaStopped,
        stoppedForTime,
      },
    });
    return updated;
  } catch (error) {
    await prisma.jobCatalogSyncRun.update({
      where: { id: run.id },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        durationMs: Date.now() - startedAt.getTime(),
        lastError: error instanceof Error ? error.message : 'Unknown catalog sync error',
      },
    }).catch(() => undefined);
    await logImportantError({ event: 'job_catalog_sync_failed', error, context: { runId: run.id } });
    throw error;
  }
}
