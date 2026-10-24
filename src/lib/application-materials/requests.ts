/**
 * HTTP request contracts for the application-materials API.
 *
 * These live here rather than inline in the route files for two reasons.
 *
 * First, they are domain contracts, not transport details: "a payload carrying
 * `userId` or `plan` must not validate" is a security property of this feature,
 * and it should be enforceable and testable independently of Next.js.
 *
 * Second, a route module may only export HTTP verbs, so anything defined inside
 * one cannot be imported by a test.
 */

import { z } from 'zod';
import { MATERIAL_TYPES, isMaterialType } from './materials';

/**
 * A generate request.
 *
 * Strict, and deliberately so. Note what is absent: `userId`, `plan`, `role`,
 * `credits`. The user id comes from the session, the plan and credits come from
 * the server-side entitlement resolver, so there is nothing here a caller could
 * swap — and a payload that tries must fail loudly rather than be ignored.
 */
export const generateMaterialRequestSchema = z
  .object({
    /**
     * One of the supported material types. Anything else is rejected outright,
     * so a caller cannot invent a type that bypasses the form rules.
     */
    type: z.enum(MATERIAL_TYPES),

    /** Re-run even when a completed draft exists for these exact inputs. */
    force: z.boolean().optional(),

    /** The job this material is for. Nullable: a recruiter message may have none. */
    jobId: z.string().max(64).nullable().optional(),

    /** A saved resume the user explicitly selected as context. */
    resumeId: z.string().max(64).nullable().optional(),

    /** Tone. Validated against what is allowed for this type by the service. */
    tone: z.string().max(20).optional(),

    /** Length preference. Validated against what is allowed for this type. */
    length: z.string().max(20).optional(),

    /** Free-text instructions from the user. Bounded server-side. */
    instructions: z.string().max(2000).optional(),

    /** A pasted conversation, when the user supplied one. */
    conversation: z.string().max(4000).optional(),

    /** A named recipient, only when meaningful for this material. */
    recipientName: z.string().max(120).optional(),

    /** The current draft text when this is a revision. */
    sourceDraft: z.string().max(8000).optional(),

    /** The material being revised, when creating a revision. */
    supersedesId: z.string().max(64).nullable().optional(),
  })
  .strict();

export type GenerateMaterialRequest = z.infer<typeof generateMaterialRequestSchema>;

/**
 * A save/edit request.
 *
 * `expectedEditVersion` implements optimistic concurrency: the client echoes
 * the version it loaded, and a mismatch is rejected with 409 rather than
 * silently clobbering a newer edit — the same mechanism as
 * `UserProfile.careerProfileVersion`.
 */
export const saveMaterialRequestSchema = z
  .object({
    id: z.string().min(1).max(64),
    content: z.string().max(20_000),
    subject: z.string().max(200).nullable().optional(),
    expectedEditVersion: z.number().int().min(1),
  })
  .strict();

export type SaveMaterialRequest = z.infer<typeof saveMaterialRequestSchema>;

/**
 * A revision request: produce a revised draft from an existing saved material.
 */
export const reviseMaterialRequestSchema = z
  .object({
    id: z.string().min(1).max(64),
    instructions: z.string().trim().min(1).max(2000),
    tone: z.string().max(20).optional(),
    length: z.string().max(20).optional(),
  })
  .strict();

export type ReviseMaterialRequest = z.infer<typeof reviseMaterialRequestSchema>;

/**
 * A delete request.
 */
export const deleteMaterialRequestSchema = z.object({
  id: z.string().min(1).max(64),
});

export type DeleteMaterialRequest = z.infer<typeof deleteMaterialRequestSchema>;

/** Field paths that failed validation, for a safe error envelope. */
export function validationFields(error: z.ZodError): Array<{ path: string; message: string }> {
  return error.issues.slice(0, 6).map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}
