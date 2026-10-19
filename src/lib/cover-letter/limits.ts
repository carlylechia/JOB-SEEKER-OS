/**
 * Centralised limits for cover letter generation.
 *
 * One place decides how much job text and profile context we send to the
 * provider, how long a letter may be, and how long a call may run. Components
 * import from here for client-side hints; the server re-checks every limit
 * independently.
 */

import { JOB_INTELLIGENCE_MAX_JOB_CHARS, JOB_INTELLIGENCE_MIN_JOB_CHARS } from '../job-intelligence/limits';

/**
 * Ceiling on job text sent to the provider for cover letter generation.
 *
 * Reuses the job-intelligence ceiling: a posting is a small document.
 */
export const COVER_LETTER_MAX_JOB_CHARS = JOB_INTELLIGENCE_MAX_JOB_CHARS;

/**
 * Ceiling on career-profile context in the same prompt.
 */
export const COVER_LETTER_MAX_PROFILE_CHARS = 6_000;

/**
 * Minimum meaningful job text before a letter is worth generating.
 */
export const COVER_LETTER_MIN_JOB_CHARS = JOB_INTELLIGENCE_MIN_JOB_CHARS;

/**
 * Maximum letter length. A cover letter should fit on one page; longer does
 * not mean more persuasive, and this keeps provider cost bounded.
 */
export const COVER_LETTER_MAX_CONTENT_CHARS = 1200;

/**
 * Provider call ceiling, matching the other AI features' serverless budget.
 */
export const COVER_LETTER_AI_TIMEOUT_MS = 45_000;

/**
 * How long a letter row may sit in GENERATING before another request may take
 * it over.
 */
export const COVER_LETTER_PROCESSING_STALE_MS = 2 * 60 * 1000;
