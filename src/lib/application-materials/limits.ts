/**
 * Centralised limits for application materials.
 *
 * Exactly one place decides how much user text, job text, profile context and
 * output we will send to a provider, how many claims we accept, and how long a
 * call may run. The client imports these for hints; the server re-checks every
 * one independently and never trusts what it is told.
 *
 * The reasoning behind each number is the same as in the resume and job
 * intelligence releases: an unbounded prompt is an unbounded bill, and a
 * silently truncated one is a lie about what the model saw.
 */

/**
 * Ceiling on the user's own free-text instructions.
 *
 * Instructions are the single most abusable input in this feature: a user can
 * paste an entire document and call it "notes". 2,000 characters is a
 * paragraph of genuine guidance and comfortably more than any real request.
 */
export const MATERIAL_MAX_INSTRUCTION_CHARS = 2_000;

/**
 * Ceiling on a pasted conversation snippet.
 *
 * A real recruiter exchange is short. Anything much longer is not context for a
 * short message, it is a data dump, and paying to send it is paying for noise.
 */
export const MATERIAL_MAX_CONVERSATION_CHARS = 4_000;

/**
 * Ceiling on job text sent to the provider.
 *
 * Lower than the resume ceiling on purpose: a posting is a small,
 * self-contained document, and anything far beyond this is boilerplate, EEO
 * language, or a second role pasted underneath.
 */
export const MATERIAL_MAX_JOB_CHARS = 8_000;

/**
 * Ceiling on the career-profile context in the same prompt.
 *
 * Bounded separately from the job so a very large confirmed profile cannot
 * quietly consume the budget that belongs to the posting.
 */
export const MATERIAL_MAX_PROFILE_CHARS = 5_000;

/**
 * Ceiling on a stored template's body passed as style guidance.
 *
 * Templates are the user's own writing and are already bounded on save, but the
 * value is re-checked here rather than trusted.
 */
export const MATERIAL_MAX_TEMPLATE_CHARS = 3_000;

/**
 * Ceiling on the draft text supplied when asking for a revision.
 */
export const MATERIAL_MAX_SOURCE_DRAFT_CHARS = 8_000;

/**
 * Hard ceiling on any material the user saves by hand, and on any generated
 * body we will store. A cover letter is not a novel.
 */
export const MATERIAL_MAX_CONTENT_CHARS = 20_000;

/** Ceiling on a stored title. */
export const MATERIAL_MAX_TITLE_CHARS = 120;

/**
 * Provider call ceiling. Same ceiling the other AI features use, bounded inside
 * the serverless function budget.
 */
export const MATERIAL_AI_TIMEOUT_MS = 45_000;

/**
 * How long a run may sit in PROCESSING before another request may take it
 * over. A killed serverless function never writes FAILED, so without this a row
 * would block that exact input set for as long as it is displayed.
 */
export const MATERIAL_PROCESSING_STALE_MS = 2 * 60 * 1000;

/** Maximum claims accepted from a provider response. Mirrors the schema cap. */
export const MATERIAL_MAX_CLAIMS = 12;

/** Maximum review notes accepted from a provider response. */
export const MATERIAL_MAX_REVIEW_NOTES = 10;

/**
 * Minimum excerpt length before a quote is treated as real evidence.
 *
 * A three-character match proves nothing. Long enough that line wrapping and
 * punctuation differences do not cause false negatives.
 */
export const MATERIAL_MIN_EVIDENCE_CHARS = 12;

/** Maximum length of a stored evidence excerpt. */
export const MATERIAL_MAX_EVIDENCE_CHARS = 240;

/**
 * Minimum body length before a generation is considered usable.
 *
 * A cover letter shorter than this is a fragment, and presenting it as a
 * finished draft would waste the user's time. We treat it as an empty response
 * rather than saving it.
 */
export const MATERIAL_MIN_CONTENT_CHARS = 120;

/**
 * Maximum characters in the exported plain-text file.
 *
 * Well above `MATERIAL_MAX_CONTENT_CHARS`, so it can never truncate a stored
 * draft. It exists only so a pathological row cannot produce an unbounded
 * response.
 */
export const MATERIAL_MAX_EXPORT_CHARS = 60_000;
