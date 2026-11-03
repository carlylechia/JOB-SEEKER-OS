import { SENIORITY_LABELS, type SeniorityLevel } from '@/lib/job-discovery/categories';

/**
 * Pure formatting/filter metadata for the public jobs UI. Kept separate from
 * `public-jobs.ts` so client components can import it without pulling Prisma
 * or other server-only modules into the browser bundle.
 */

export const PUBLIC_JOB_REMOTE_TYPES = [
  { value: '', label: 'Any location' },
  { value: 'remote', label: 'Remote' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'onsite', label: 'On-site' },
] as const;

export const PUBLIC_JOB_EMPLOYMENT_TYPES = [
  { value: '', label: 'Any contract' },
  { value: 'FULL_TIME', label: 'Full time' },
  { value: 'PART_TIME', label: 'Part time' },
  { value: 'CONTRACT', label: 'Contract' },
  { value: 'TEMPORARY', label: 'Temporary' },
  { value: 'INTERNSHIP', label: 'Internship' },
  { value: 'FREELANCE', label: 'Freelance' },
] as const;

export const PUBLIC_JOB_SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'salary', label: 'Highest salary' },
] as const;

export function formatPublicJobAge(date: Date | string | null) {
  if (!date) return 'Recently added';
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

export function formatPublicJobSeniority(value: string | null) {
  if (!value) return '';
  const normalized = value.trim().toUpperCase();
  if (normalized in SENIORITY_LABELS) return SENIORITY_LABELS[normalized as SeniorityLevel];
  return value;
}

export function formatPublicJobEmploymentType(value: string | null) {
  if (!value) return '';
  return value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function formatPublicJobSource(value: string | null) {
  if (!value) return '';
  return value
    .replace(/:feed$/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function formatPublicJobSalary(job: {
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
}) {
  if (job.salaryMin == null && job.salaryMax == null) return '';
  const currency = job.currency || 'USD';
  const format = (value: number) => {
    try {
      return new Intl.NumberFormat('en', {
        style: 'currency',
        currency,
        maximumFractionDigits: 0,
      }).format(value);
    } catch {
      return `${currency} ${Math.round(value).toLocaleString('en')}`;
    }
  };
  if (job.salaryMin != null && job.salaryMax != null && job.salaryMin !== job.salaryMax) {
    return `${format(job.salaryMin)} – ${format(job.salaryMax)}`;
  }
  return format(job.salaryMax ?? job.salaryMin ?? 0);
}
