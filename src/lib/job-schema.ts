import { z } from 'zod';
import { sanitizeText, sanitizeUrl } from './sanitize';

const scoreField = z.coerce.number().min(0).max(5);

export const jobPayloadSchema = z.object({
  company: z.string().transform((v) => sanitizeText(v, 120)).pipe(z.string().min(1).max(120)),
  title: z.string().transform((v) => sanitizeText(v, 150)).pipe(z.string().min(1).max(150)),
  source: z.string().optional().default('').transform((v) => sanitizeText(v, 80)),
  jobUrl: z.string().optional().default('').transform((v) => sanitizeUrl(v)),
  location: z.string().optional().default('').transform((v) => sanitizeText(v, 120)),
  remoteType: z.string().optional().default('').transform((v) => sanitizeText(v, 60)),
  timezoneRequirement: z.string().optional().default('').transform((v) => sanitizeText(v, 120)),
  eligibilityRegion: z.string().optional().default('').transform((v) => sanitizeText(v, 120)),
  salaryMin: z.union([z.string(), z.number(), z.null(), z.undefined()]).transform((v) => (v === '' || v == null ? undefined : Number(v))).refine((v) => v === undefined || (Number.isFinite(v) && v >= 0 && v <= 1_000_000), 'Invalid minimum salary'),
  salaryMax: z.union([z.string(), z.number(), z.null(), z.undefined()]).transform((v) => (v === '' || v == null ? undefined : Number(v))).refine((v) => v === undefined || (Number.isFinite(v) && v >= 0 && v <= 1_000_000), 'Invalid maximum salary'),
  currency: z.string().optional().default('USD').transform((v) => sanitizeText(v, 10).toUpperCase() || 'USD'),
  notes: z.string().optional().default('').transform((v) => sanitizeText(v, 5000)),
  status: z.enum(['LEAD', 'SAVED', 'APPLYING', 'APPLIED', 'INTERVIEWING', 'OFFER', 'REJECTED', 'ARCHIVED']).default('LEAD'),
  nextFollowUp: z.string().optional().default('').transform((v) => sanitizeText(v, 20)),
  coreStackMatch: scoreField,
  roleAlignment: scoreField,
  seniorityFit: scoreField,
  geographyEligibility: scoreField,
  timezoneCompatibility: scoreField,
  compensationFit: scoreField,
  domainRelevance: scoreField,
  applicationFriction: scoreField,
  signalQuality: scoreField,
}).refine((data) => data.salaryMin === undefined || data.salaryMax === undefined || (data.salaryMax && data.salaryMin && data?.salaryMax >= data?.salaryMin), {
  message: 'Maximum salary must be greater than or equal to minimum salary',
  path: ['salaryMax'],
});

export type JobPayload = z.infer<typeof jobPayloadSchema>;
