import { prisma } from '@/lib/prisma';
import { ensureJobSourcesSeeded } from './catalog/seed';
import { isProviderConfigured, PROVIDER_DEFINITIONS } from './catalog/providers';

export type ProviderHealthUpdate = {
  provider: string;
  success: boolean;
  category?: string | null;
  error?: string | null;
  jobsRetrieved?: number;
  jobsAccepted?: number;
  boardsAttempted?: number;
  boardsSucceeded?: number;
  latencyMs?: number | null;
  rateLimitRemaining?: number | null;
  quotaState?: string | null;
  runId?: string;
};

/**
 * Provider-level health (one row per provider) plus source-level state on
 * JobSource. Keeping both means the admin page can answer "is the provider
 * broken?" and "which employer board is stale?" without conflating them.
 */
export async function recordProviderHealth(update: ProviderHealthUpdate) {
  const definition = PROVIDER_DEFINITIONS[update.provider as keyof typeof PROVIDER_DEFINITIONS];
  if (!definition) return;
  const existing = await prisma.jobSourceHealth.findUnique({ where: { sourceId: update.provider } });
  const now = new Date();
  const data = {
    sourceId: update.provider,
    displayName: definition.displayName,
    connectorType: definition.sourceType,
    enabled: true,
    configured: true,
    lastSuccessAt: update.success ? now : existing?.lastSuccessAt ?? null,
    lastFailureAt: update.success ? existing?.lastFailureAt ?? null : now,
    failureCategory: update.success ? null : update.category ?? 'UNKNOWN',
    lastError: update.success ? null : update.error ?? update.category ?? null,
    jobsRetrieved: update.jobsRetrieved ?? 0,
    jobsAccepted: update.jobsAccepted ?? 0,
    duplicatesDiscarded: existing?.duplicatesDiscarded ?? 0,
    lastCatalogSyncAt: now,
    lastCatalogRunId: update.runId ?? existing?.lastCatalogRunId ?? null,
    catalogJobsRetrieved: update.jobsRetrieved ?? 0,
    catalogJobsAccepted: update.jobsAccepted ?? 0,
    boardsAttempted: update.boardsAttempted ?? 0,
    boardsSucceeded: update.boardsSucceeded ?? 0,
    avgLatencyMs: update.latencyMs ?? existing?.avgLatencyMs ?? null,
    rateLimitRemaining: update.rateLimitRemaining ?? existing?.rateLimitRemaining ?? null,
    quotaState: update.quotaState ?? existing?.quotaState ?? null,
  };

  if (existing) {
    await prisma.jobSourceHealth.update({ where: { sourceId: update.provider }, data });
  } else {
    await prisma.jobSourceHealth.create({ data });
  }
}

export async function listSourceHealth() {
  await ensureJobSourcesSeeded();
  const [sources, healthRows] = await Promise.all([
    prisma.jobSource.findMany({ orderBy: [{ provider: 'asc' }, { displayName: 'asc' }] }),
    prisma.jobSourceHealth.findMany({ orderBy: { sourceId: 'asc' } }),
  ]);

  const providers = Object.keys(PROVIDER_DEFINITIONS);
  for (const provider of providers) {
    const definition = PROVIDER_DEFINITIONS[provider as keyof typeof PROVIDER_DEFINITIONS];
    const providerSources = sources.filter((source) => source.provider === provider);
    const configured = providerSources.some((source) => isProviderConfigured(provider, source.boardToken));
    const enabled = providerSources.some((source) => source.enabled);
    const existing = healthRows.find((row) => row.sourceId === provider);
    const data = {
      sourceId: provider,
      displayName: definition.displayName,
      connectorType: definition.sourceType,
      enabled,
      configured,
      lastSuccessAt: existing?.lastSuccessAt ?? null,
      lastFailureAt: existing?.lastFailureAt ?? null,
      failureCategory: existing?.failureCategory ?? null,
      lastError: existing?.lastError ?? null,
      jobsRetrieved: existing?.jobsRetrieved ?? 0,
      jobsAccepted: existing?.jobsAccepted ?? 0,
      duplicatesDiscarded: existing?.duplicatesDiscarded ?? 0,
      lastCatalogSyncAt: providerSources.reduce<Date | null>((latest, source) => {
        if (!source.lastSyncedAt) return latest;
        return !latest || source.lastSyncedAt > latest ? source.lastSyncedAt : latest;
      }, null),
      catalogJobsRetrieved: providerSources.reduce((sum, source) => sum + source.jobsRetrieved, 0),
      catalogJobsAccepted: providerSources.reduce((sum, source) => sum + source.jobsAccepted, 0),
      boardsAttempted: providerSources.filter((source) => source.lastSyncedAt).length,
      boardsSucceeded: providerSources.filter((source) => source.lastSuccessAt).length,
    };
    if (existing) {
      await prisma.jobSourceHealth.update({ where: { sourceId: provider }, data });
    } else {
      await prisma.jobSourceHealth.create({ data });
    }
  }

  const refreshed = await prisma.jobSourceHealth.findMany({ orderBy: { sourceId: 'asc' } });
  return refreshed;
}

export async function recentCatalogRuns(limit = 5) {
  return prisma.jobCatalogSyncRun.findMany({
    orderBy: { startedAt: 'desc' },
    take: Math.max(1, Math.min(20, limit)),
  });
}
