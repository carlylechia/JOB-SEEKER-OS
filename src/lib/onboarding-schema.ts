import { z } from 'zod';
import { sanitizeArray, sanitizeText, sanitizeUrl } from './sanitize';

export const preferencesPayloadSchema = z.object({
  currentLevel: z.enum(['ENTRY', 'MID', 'SENIOR', 'FLEXIBLE']).default('MID'),
  targetLevel: z.enum(['ENTRY', 'MID', 'SENIOR', 'FLEXIBLE']).default('MID'),
  targetRoles: z.array(z.unknown()).transform((values) => sanitizeArray(values, 10)).default([]),
  preferredRegions: z.array(z.unknown()).transform((values) => sanitizeArray(values, 10)).default([]),
  preferredTitles: z.array(z.unknown()).transform((values) => sanitizeArray(values, 10)).default([]),
  preferredStack: z.array(z.unknown()).transform((values) => sanitizeArray(values, 20)).default([]),
  mustHaveTech: z.array(z.unknown()).transform((values) => sanitizeArray(values, 12)).default([]),
  workRegions: z.array(z.enum(['US', 'EU', 'AFRICA', 'WORLDWIDE', 'FLEXIBLE'])).max(5).default(['WORLDWIDE']),
  timezoneMatches: z.array(z.unknown()).transform((values) => sanitizeArray(values, 8)).default([]),
  remoteOnly: z.coerce.boolean().default(true),
  salaryMin: z.coerce.number().min(0).max(1_000_000).default(0),
  salaryTarget: z.coerce.number().min(0).max(1_000_000).default(0),
  timezoneToleranceHours: z.coerce.number().min(0).max(12).default(4),
  timezone: z.string().max(64).default('UTC'),
  workCountries: z.array(z.unknown()).transform((values) => sanitizeArray(values, 30)).default([]),
  employmentTypes: z.array(z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP', 'TEMPORARY', 'VOLUNTEER'])).max(6).default([]),
  preferredIndustries: z.array(z.unknown()).transform((values) => sanitizeArray(values, 12)).default([]),
  visaSponsorshipRequired: z.coerce.boolean().default(false),
  onboardingCompleted: z.coerce.boolean().optional().default(false),
});

export const ingestJobSchema = z.object({
  jobUrl: z.string().optional().default('').transform((value) => sanitizeUrl(value)),
  jobDescription: z.string().optional().default('').transform((value) => sanitizeText(value, 25_000)),
  /**
   * Downscaled screenshots as data URLs. The byte limit is a transport guard;
   * `validateIngestionImages` re-checks the signature and decoded size before
   * any image is sent to the provider.
   */
  images: z.array(z.string().max(3_000_000)).max(3).optional().default([]),
}).refine((data) => Boolean(data.jobUrl || data.jobDescription || data.images.length > 0), {
  message: 'Provide a job URL, paste a job description, or attach a screenshot.',
  path: ['jobDescription'],
});
