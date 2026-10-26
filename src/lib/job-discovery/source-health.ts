import { prisma } from '@/lib/prisma';
import type { Connector } from './types';

export async function updateSourceHealth(
  connector: Connector,
  success: boolean,
  category?: string,
  jobsRetrieved?: number,
  error?: string,
) {
  const existing = await prisma.jobSourceHealth.findUnique({ where: { sourceId: connector.id } });
  const data = {
    sourceId: connector.id,
    displayName: connector.displayName,
    connectorType: connector.connectorType,
    enabled: connector.isEnabled(),
    configured: connector.isConfigured(),
    lastSuccessAt: success ? new Date() : existing?.lastSuccessAt ?? null,
    lastFailureAt: success ? existing?.lastFailureAt ?? null : new Date(),
    failureCategory: success ? null : category ?? 'UNKNOWN',
    lastError: success ? null : (error ?? category ?? null),
    jobsRetrieved: success ? jobsRetrieved ?? 0 : existing?.jobsRetrieved ?? 0,
    jobsAccepted: existing?.jobsAccepted ?? 0,
    duplicatesDiscarded: existing?.duplicatesDiscarded ?? 0,
  };

  if (existing) {
    await prisma.jobSourceHealth.update({ where: { sourceId: connector.id }, data });
  } else {
    await prisma.jobSourceHealth.create({ data });
  }
}

export async function listSourceHealth() {
  const connectors = (await import('./registry')).getConnectors();
  // ensure rows exist
  for (const c of connectors) {
    const row = await prisma.jobSourceHealth.findUnique({ where: { sourceId: c.id } });
    if (!row) {
      await prisma.jobSourceHealth.create({
        data: {
          sourceId: c.id,
          displayName: c.displayName,
          connectorType: c.connectorType,
          enabled: c.isEnabled(),
          configured: c.isConfigured(),
        },
      });
    } else {
      await prisma.jobSourceHealth.update({
        where: { sourceId: c.id },
        data: { enabled: c.isEnabled(), configured: c.isConfigured(), displayName: c.displayName, connectorType: c.connectorType },
      });
    }
  }
  return prisma.jobSourceHealth.findMany({ orderBy: { sourceId: 'asc' } });
}
