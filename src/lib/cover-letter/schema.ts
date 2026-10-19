/**
 * Versioned cover letter contract.
 *
 * Same rules as `src/lib/job-intelligence/schema.ts` and
 * `src/lib/resume/schema.ts`:
 *
 *  1. The schema describes the shape of generated content, not a prompt.
 *     Every field is validated on the server before anything is stored.
 *  2. The schema is PURE: no `.refine()`, no `.transform()`, no `.catch()`,
 *     no `.trim()`. Strict JSON Schema only; every judgement (anti-hallucination,
 *     evidence re-checking, gap flagging) happens in `verify.ts`.
 *  3. There are no employer-specific claims here. The model is asked to write
 *     a letter grounded in the user's real experience and the actual job
 *     description, never to invent "why this company is special" or
 *     "the five things this employer values".
 *
 * Bumping `COVER_LETTER_SCHEMA_VERSION` invalidates cached letters.
 */

import { z } from 'zod';

export const COVER_LETTER_SCHEMA_VERSION = 1;

/** Schema name registered with the provider's structured-output format. */
export const COVER_LETTER_SCHEMA_NAME = 'cover_letter';

/**
 * Bumped when the PROMPT changes but the output shape does not.
 *
 * Folded into the input fingerprint so a prompt tweak invalidates cached
 * letters without pretending the contract changed shape.
 */
export const COVER_LETTER_PROMPT_VERSION = 1;

// ─── Vocabularies ───────────────────────────────────────────────────────────

/** Letter status. DRAFT means the user has not yet confirmed it to send. */
export const coverLetterStatusSchema = z.enum([
  'DRAFT',
  'GENERATED',
  'SENT',
  'ARCHIVED',
]);
export type CoverLetterStatus = z.infer<typeof coverLetterStatusSchema>;

export const COVER_LETTER_STATUS_LABELS: Record<CoverLetterStatus, string> = {
  DRAFT: 'Draft',
  GENERATED: 'Generated',
  SENT: 'Sent',
  ARCHIVED: 'Archived',
};

// ─── Shared shapes ─────────────────────────────────────────────────────────

const shortText = z.string().max(280);
const sentence = z.string().max(600);

/**
 * One traceability record for a claim in the letter.
 *
 * `excerpt` is a short verbatim quote from the job description or the user's
 * profile. verify.ts drops any job-description excerpt it cannot find in the
 * posting, so a fabricated quote cannot reach the database.
 */
export const evidenceSchema = z.object({
  source: z.enum(['JOB_DESCRIPTION', 'JOB_METADATA', 'CAREER_PROFILE', 'WORK_EXPERIENCE']),
  field: z.string().max(160),
  excerpt: z.string().max(300).nullable(),
  supports: shortText,
});
export type Evidence = z.infer<typeof evidenceSchema>;

// ─── Letter generation contract ─────────────────────────────────────────────

export const modelCoverLetterSchema = z
  .object({
    schemaVersion: z.number(),
    /** Optional subject line, e.g. "Application for Backend Engineer". */
    subject: z.string().max(160).nullable(),
    /** The letter body, ready to render. One page, concise, persuasive. */
    content: z.string().max(1200),
    /** Salutation, e.g. "Dear Hiring Team," or null to use a default. */
    salutation: z.string().max(120).nullable(),
    /** Sign-off, e.g. "Sincerely," or null to use a default. */
    signOff: z.string().max(120).nullable(),
    /**
     * Claims the letter makes, each tied to evidence. verify.ts re-checks that
     * every experience claim exists in the user's profile and every posting
     * quote is findable in the job description.
     */
    keyClaims: z.array(
      z.object({
        claim: sentence,
        evidence: z.array(evidenceSchema).max(3),
      }),
    ).max(6),
    /**
     * Honest input gaps: missing description, thin profile, no matching
     * experience. The letter will say what it can and the UI surfaces these
     * so the user can fill them in rather than receiving a fabricated letter.
     */
    limitations: z.array(shortText).max(6),
  })
  .strict();

export type ModelCoverLetter = z.infer<typeof modelCoverLetterSchema>;

// ─── Errors ────────────────────────────────────────────────────────────────

export type CoverLetterErrorCode =
  | 'NO_JOB_DATA'
  | 'NO_PROFILE_CONTEXT'
  | 'AI_NOT_CONFIGURED'
  | 'AI_RATE_LIMITED'
  | 'AI_TIMEOUT'
  | 'AI_REFUSED'
  | 'AI_EMPTY_RESPONSE'
  | 'AI_INVALID_RESPONSE'
  | 'AI_UNAVAILABLE';

export const COVER_LETTER_ERROR_MESSAGES: Record<CoverLetterErrorCode, string> = {
  NO_JOB_DATA:
    'There is not enough on this job yet to write a cover letter. Add the job description or edit the role details, then try again.',
  NO_PROFILE_CONTEXT:
    'We could not find enough in your career profile to write a meaningful letter. Add some skills or work history first.',
  AI_NOT_CONFIGURED:
    'Cover letter generation is not available right now. Our team has been notified — please try again later.',
  AI_RATE_LIMITED: 'Our letter-writing service is busy. Please wait a moment and try again.',
  AI_TIMEOUT: 'The letter took too long to write and stopped. Please try again.',
  AI_REFUSED: 'Our letter-writing provider could not process this job.',
  AI_EMPTY_RESPONSE: 'The letter came back empty. Please try again.',
  AI_INVALID_RESPONSE: 'The letter came back in a form we could not use. Please try again.',
  AI_UNAVAILABLE: 'Our letter-writing service is temporarily unavailable. Please try again.',
};

/** What the service returns to routes, server-owned. */
export type CoverLetterData = {
  id: string;
  userId: string;
  jobId: string;
  title: string;
  subject: string | null;
  content: string;
  salutation: string | null;
  signOff: string | null;
  status: CoverLetterStatus;
  schemaVersion: number;
  promptVersion: number;
  inputFingerprint: string;
  version: number;
  thinInputs: boolean;
  keyClaims: Array<{
    claim: string;
    evidence: Evidence[];
  }>;
  limitations: string[];
};
