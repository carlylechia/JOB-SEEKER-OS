import { prisma } from '@/lib/prisma';

export type PublicJobsQueryOptions = {
  q?: string;
  take?: number;
};

export type PublicJobRecord = {
  id: string;
  title: string;
  company: string;
  location: string | null;
  remoteType: string | null;
  createdAt: Date;
  notes: string | null;
};

export function getPublicJobsSinceDate(days = 30) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  return since;
}

export function normalizePublicJobsSearchQuery(value?: string | null) {
  return value?.trim() ?? '';
}

export function clampPublicJobsTake(value?: number, min = 1, max = 40) {
  if (!Number.isFinite(value)) return max;
  return Math.min(Math.max(Number(value), min), max);
}

export async function getPublicJobs(options: PublicJobsQueryOptions = {}): Promise<PublicJobRecord[]> {
  const q = normalizePublicJobsSearchQuery(options.q);
  const take = clampPublicJobsTake(options.take);

  return prisma.jobLead.findMany({
    where: {
      createdAt: {
        gte: getPublicJobsSinceDate(30),
      },
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: 'insensitive' } },
              { company: { contains: q, mode: 'insensitive' } },
              { location: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: 'desc' }],
    take,
    select: {
      id: true,
      title: true,
      company: true,
      location: true,
      remoteType: true,
      createdAt: true,
      notes: true,
    },
  });
}

export function formatPublicJobAge(date: Date) {
  const now = Date.now();
  const diffDays = Math.max(1, Math.floor((now - new Date(date).getTime()) / (1000 * 60 * 60 * 24)));

  if (diffDays === 1) return 'Added 1 day ago';
  if (diffDays < 7) return `Added ${diffDays} days ago`;

  const weeks = Math.floor(diffDays / 7);
  if (weeks === 1) return 'Added 1 week ago';
  return `Added ${weeks} weeks ago`;
}

export function formatPublicJobLocation(remoteType: string | null, location: string | null) {
  if (remoteType && location) return `${remoteType} · ${location}`;
  if (remoteType) return remoteType;
  if (location) return location;
  return 'Location not specified';
}
