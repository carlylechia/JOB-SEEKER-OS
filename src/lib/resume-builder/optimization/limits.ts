/**
 * Centralised limits for resume optimisation.
 *
 * Mirrors `src/lib/job-intelligence/limits.ts` and `src/lib/resume/limits.ts`:
 * exactly one place decides how much text is sent, how much may be proposed, and
 * how long a call may run. Components read these for client-side hints; the
 * server re-checks every one independently and never trusts the client.
 *
 * The job-text ceiling is reused from the job intelligence feature rather than
 * re-declared, because an optimisation prompt contains the SAME posting — a
 * second, larger ceiling for the same bytes would just be a way to spend more
 * money on the same input.
 */

import { JOB_INTELLIGENCE_MAX_JOB_CHARS, JOB_INTELLIGENCE_MIN_JOB_CHARS } from '@/lib/job-intelligence/limits';
import { RESUME_MAX_BULLET_LENGTH, RESUME_MAX_SUMMARY_LENGTH } from '../schema';

export { JOB_INTELLIGENCE_MAX_JOB_CHARS, JOB_INTELLIGENCE_MIN_JOB_CHARS };

/**
 * Ceiling on the resume text sent to the provider.
 *
 * Larger than the job ceiling and comparable to the extraction ceiling, because
 * the resume is the document being rewritten and truncating it would produce
 * proposals against a document the user cannot see.
 */
export const OPTIMIZATION_MAX_RESUME_CHARS = 20_000;

/**
 * Ceiling on the career-profile context in the same prompt.
 *
 * Bounded separately so a large confirmed profile cannot eat the budget that
 * belongs to the resume and the posting.
 */
export const OPTIMIZATION_MAX_PROFILE_CHARS = 5_000;

/** Provider call ceiling. Matches the sibling features. */
export const OPTIMIZATION_AI_TIMEOUT_MS = 45_000;

/**
 * How long a run may sit in PROCESSING before another request may take it over.
 *
 * A killed serverless function never writes FAILED, so without this the row
 * would block that exact input set for ever.
 */
export const OPTIMIZATION_PROCESSING_STALE_MS = 2 * 60 * 1000;

/** Maximum operations accepted from one response. Mirrors the schema cap. */
export const OPTIMIZATION_MAX_OPERATIONS = 20;

/** Maximum questions raised for the user. */
export const OPTIMIZATION_MAX_GAPS = 8;

/**
 * Maximum length of a stored evidence excerpt.
 *
 * Excerpts are re-checked verbatim against the resume or the profile; one that
 * cannot be found is dropped rather than trusted.
 */
export const OPTIMIZATION_MAX_EVIDENCE_CHARS = 300;

/** Minimum excerpt length before a quote counts as evidence. */
export const OPTIMIZATION_MIN_EVIDENCE_CHARS = 8;

/**
 * Output ceilings re-applied after validation.
 *
 * A schema hint is not a validation pass, so every bound is enforced again in
 * `verify.ts` against server-side code.
 */
export const OPTIMIZATION_MAX_SUMMARY_LENGTH = RESUME_MAX_SUMMARY_LENGTH;
export const OPTIMIZATION_MAX_PROPOSED_LENGTH = RESUME_MAX_BULLET_LENGTH;

/** Thinnest resume we will spend a provider call on. */
export const OPTIMIZATION_MIN_RESUME_CHARS = 80;

/** Thinnest career profile context we will spend a provider call on. */
export const OPTIMIZATION_MIN_PROFILE_CHARS = 40;