/**
 * Request schemas for application lifecycle routes.
 *
 * `attemptedAt` is deliberately absent: the server stamps the attempt time.
 * A client cannot backdate or forward-date a submission.
 */

import { z } from 'zod';

import {
  APPLICATION_STATUSES,
  ATTEMPT_CHANNELS,
  ATTEMPT_STATUSES,
  EVIDENCE_KINDS,
} from './service';

export const applicationStatusSchema = z.enum(APPLICATION_STATUSES);
export const attemptChannelSchema = z.enum(ATTEMPT_CHANNELS);
export const attemptStatusSchema = z.enum(ATTEMPT_STATUSES);
export const evidenceKindSchema = z.enum(EVIDENCE_KINDS);

export const recordAttemptRequestSchema = z
  .object({
    channel: attemptChannelSchema,
    status: attemptStatusSchema,
    evidenceKind: evidenceKindSchema.optional(),
    evidenceRef: z.string().trim().max(240).optional(),
    evidenceSummary: z.string().trim().max(600).optional(),
    reason: z.string().trim().max(600).optional(),
  })
  .strict();

export type RecordAttemptRequest = z.infer<typeof recordAttemptRequestSchema>;

export const transitionApplicationRequestSchema = z
  .object({
    toStatus: applicationStatusSchema,
    reason: z.string().trim().max(600).optional(),
  })
  .strict();

export type TransitionApplicationRequest = z.infer<
  typeof transitionApplicationRequestSchema
>;
