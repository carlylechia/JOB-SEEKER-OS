/**
 * Centralised limits for interview preparation.
 *
 * One place decides how much job text and profile context we send to the
 * provider, how many questions a pack contains, how long an answer may be,
 * and how long a call may run. Components import from here for client-side
 * hints; the server re-checks every limit independently.
 */

import { JOB_INTELLIGENCE_MAX_JOB_CHARS, JOB_INTELLIGENCE_MIN_JOB_CHARS } from '../job-intelligence/limits';

/**
 * Ceiling on job text sent to the provider for pack generation.
 *
 * Reuses the job-intelligence ceiling: a posting is a small document and we
 * pay only for signal.
 */
export const INTERVIEW_PREP_MAX_JOB_CHARS = JOB_INTELLIGENCE_MAX_JOB_CHARS;

/**
 * Ceiling on career-profile context in the same prompt.
 */
export const INTERVIEW_PREP_MAX_PROFILE_CHARS = 6_000;

/**
 * Minimum meaningful job text before a pack is worth generating.
 */
export const INTERVIEW_PREP_MIN_JOB_CHARS = JOB_INTELLIGENCE_MIN_JOB_CHARS;

/**
 * Maximum questions in a pack. Relevance over volume: a small, high-quality
 * set is better than an overwhelming pack of repeated generic questions.
 */
export const INTERVIEW_PREP_MAX_QUESTIONS = 8;

/**
 * Maximum follow-up questions generated from any one question.
 */
export const INTERVIEW_PREP_MAX_FOLLOW_UPS = 3;

/**
 * Ceiling on a practice answer. Long answers do not demonstrate more
 * competence; this keeps provider cost bounded.
 */
export const INTERVIEW_PREP_MAX_ANSWER_CHARS = 3000;

/**
 * Minimum answer length before feedback is meaningful.
 */
export const INTERVIEW_PREP_MIN_ANSWER_CHARS = 30;

/**
 * Provider call ceiling, matching the other AI features' serverless budget.
 */
export const INTERVIEW_PREP_AI_TIMEOUT_MS = 45_000;

/**
 * How long a pack row may sit in GENERATING before another request may take
 * it over.
 */
export const INTERVIEW_PREP_PROCESSING_STALE_MS = 2 * 60 * 1000;

/** Maximum preparation guidance length. */
export const INTERVIEW_PREP_MAX_GUIDANCE_CHARS = 900;
