/**
 * Centralised limits for job intelligence.
 *
 * There is exactly one place that decides how much job text we will send to a
 * provider, how much profile context to include, how many requirements we
 * accept, and how long a call may run. Components import from here for
 * client-side hints; the server re-checks every one of these independently and
 * never trusts the client.
 *
 * The job-description ceiling is lower than the resume one
 * (`RESUME_MAX_EXTRACTED_CHARS`) on purpose. A job posting is a small,
 * self-contained document; anything much beyond this is boilerplate, EEO
 * language, or a second role pasted underneath, and paying to send it is
 * paying for noise.
 */

/**
 * Ceiling on job text sent to the provider.
 *
 * ~12k characters is roughly 3k tokens — comfortably more than a real posting
 * and well inside any model's context window. Truncation is explicit so the
 * model knows the posting continues rather than believing it read everything.
 */
export const JOB_INTELLIGENCE_MAX_JOB_CHARS = 12_000;

/**
 * Ceiling on the user's career-profile context in the same prompt.
 *
 * Bounded separately so a very large confirmed profile cannot quietly eat the
 * budget that belongs to the job posting.
 */
export const JOB_INTELLIGENCE_MAX_PROFILE_CHARS = 6_000;

/**
 * Minimum job text before we consider an analysis worth running.
 *
 * Below this we can still analyse metadata, but we record `wasTruncated`
 * semantics honestly: the caller is told the analysis ran on thin data. This
 * floor exists to avoid spending a provider call on a two-word job title.
 */
export const JOB_INTELLIGENCE_MIN_JOB_CHARS = 40;

/**
 * Letters and digits required before we treat job text as real content rather
 * than a row of bullet glyphs.
 */
export const JOB_INTELLIGENCE_MEANINGFUL_CHAR_FLOOR = 20;

/**
 * Provider call ceiling. Bounded inside the serverless function budget; the
 * same ceiling the resume feature uses.
 */
export const JOB_INTELLIGENCE_AI_TIMEOUT_MS = 45_000;

/**
 * How long a run may sit in PROCESSING before another request may take it
 * over. A killed serverless function never writes FAILED, so without this the
 * row would block that exact input set forever.
 */
export const JOB_INTELLIGENCE_PROCESSING_STALE_MS = 2 * 60 * 1000;

/**
 * Maximum requirements we keep from a provider response.
 *
 * Mirrors the schema cap. Re-applied server-side after validation, because a
 * schema hint is not a validation pass.
 */
export const JOB_INTELLIGENCE_MAX_REQUIREMENTS = 30;

/**
 * Minimum excerpt length before a quote is treated as real evidence.
 *
 * A three-character match proves nothing, and the resume feature established
 * this precedent. Long enough that line wrapping and punctuation differences do
 * not cause false negatives.
 */
export const JOB_INTELLIGENCE_MIN_EVIDENCE_CHARS = 12;

/**
 * Maximum length of a stored evidence excerpt.
 *
 * Quotes have to stay short enough to read comfortably next to a claim, and
 * long enough to be recognisable. Anything longer is truncated rather than
 * dropped, because a truncated quote is still evidence.
 */
export const JOB_INTELLIGENCE_MAX_EVIDENCE_CHARS = 300;
