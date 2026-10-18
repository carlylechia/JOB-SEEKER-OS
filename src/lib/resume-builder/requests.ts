/**
 * HTTP request contracts for the Resume Builder.
 *
 * These live here rather than inline in the route files for two reasons.
 *
 * First, they are domain contracts, not transport details: "a payload carrying
 * `userId` or `targetResumeId` must not validate" is a security property of the
 * resume feature, and it should be enforceable and testable independently of
 * Next.js.
 *
 * Second, a route module may only export HTTP verbs, so anything defined inside
 * one cannot be imported by a test. Keeping the schemas next to the service that
 * consumes them means the ownership and entitlement rules are asserted against
 * the same objects the routes use, rather than a copy that can drift.
 */

import { z } from 'zod';

/**
 * A run request.
 *
 * Strict, and deliberately so. Note what is absent: `jobId`, `userId`, `plan`,
 * `content`. The target job comes from the resume's own `targetJobId` and the
 * content from the stored document, so there is nothing here a caller could
 * swap — and a payload that tries must fail loudly rather than be ignored.
 */
export const runOptimizationRequestSchema = z
  .object({
    /**
     * Re-run even when a completed proposal exists for these exact inputs.
     * Explicitly charged as a new operation.
     */
    force: z.boolean().optional(),
  })
  .strict();

export type RunOptimizationRequest = z.infer<typeof runOptimizationRequestSchema>;

/**
 * An apply request.
 *
 * Accepts a SUBSET of the proposal's operations. There is no "apply all"
 * parameter and no way to name a different resume, because the whole promise of
 * this feature is that the user decides what ends up in the document they send.
 *
 * `editedText` is the user's own revision of a suggestion. It is bounded here and
 * re-checked by exactly the same anti-fabrication pass as the model's text, so
 * "edit before accepting" is a convenience rather than a way around the
 * truthfulness rule.
 */
export const applyOptimizationRequestSchema = z
  .object({
    optimizationId: z.string().min(1).max(64),
    acceptedOperationIds: z.array(z.string().min(1).max(64)).min(1).max(20),
    editedText: z.record(z.string().max(2000)).optional(),
    /** The resume revision the review screen was built from. */
    expectedRevision: z.number().int().min(1),
  })
  .strict();

export type ApplyOptimizationRequest = z.infer<typeof applyOptimizationRequestSchema>;

/**
 * A duplicate request.
 *
 * `targetJobId` exists so "create a tailored version of this resume for that
 * job" is one action. It is re-resolved against rows the caller owns before it
 * is written, exactly like the field of the same name elsewhere.
 */
export const duplicateResumeRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    targetJobId: z.string().max(64).nullable().optional(),
  })
  .strict();

export type DuplicateResumeRequest = z.infer<typeof duplicateResumeRequestSchema>;

/** Field paths that failed validation, for a safe error envelope. */
export function validationFields(error: z.ZodError): Array<{ path: string; message: string }> {
  return error.issues.slice(0, 6).map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}