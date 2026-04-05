import { jsonOk } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { mapDbJob } from '@/lib/db-helpers';
import { prisma } from '@/lib/prisma';

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

export async function GET(request: Request) {
  const start = new Date();
  start.setDate(start.getDate() - 30);
  const jobs = await prisma.jobLead.findMany({
    where: { createdAt: { gte: start }, status: { not: 'ARCHIVED' } },
    orderBy: [{ createdAt: 'desc' }],
    take: 100,
  });
  return jsonOk({ jobs: jobs.map(mapDbJob) }, request);
}
