/**
 * Versioned analysis contract for AI Job Intelligence.
 *
 * Two rules govern this file, and they are the same two that govern
 * `src/lib/resume/schema.ts`:
 *
 *  1. The schema describes CONCLUSIONS ABOUT KNOWN FACTS, not a prompt
 *     response. Every field is either something the application computed, or a
 *     claim the server re-checks against source text before storing. There is
 *     no field the model can fill "to be helpful".
 *
 *  2. The schema is PURE. No `.refine()`, no `.transform()`, no `.catch()`,
 *     no `.trim()`. OpenAI's strict Structured Outputs mode refuses those, and
 *     a contract that cannot be expressed as strict JSON Schema cannot be
 *     enforced by the provider. Everything that needs judgement — evidence
 *     re-checking, bounds, normalisation, category assignment — happens in
 *     `verify.ts` against server-side code.
 *
 * The single most important property: **there is no numeric score field here.**
 * The deterministic fit score is computed by `src/lib/scoring.ts` and is
 * attached by the server in `assembleAnalysis()`. The model has no way to
 * invent one, quote one, or change one — there is nowhere to put it.
 *
 * Bumping `ANALYSIS_SCHEMA_VERSION` invalidates cached analyses: the
 * `(userId, jobId, inputFingerprint, schemaVersion)` key changes, so an old
 * result is never silently reused under a newer contract.
 */

import { z } from 'zod';

export const ANALYSIS_SCHEMA_VERSION = 1;

/** Schema name registered with the provider's structured-output format. */
export const ANALYSIS_SCHEMA_NAME = 'job_intelligence_analysis';

/**
 * Bumped when the PROMPT changes but the output shape does not.
 *
 * Kept separate from the schema version on purpose: a prompt tweak should
 * invalidate a cached analysis without pretending the contract changed shape.
 * Both feed the input fingerprint.
 */
export const ANALYSIS_PROMPT_VERSION = 1;

// ─── Vocabularies ──────────────────────────────────────────────────────────

/**
 * How a dimension resolved.
 *
 * `UNKNOWN` and `NOT_APPLICABLE` are distinct on purpose. `UNKNOWN` means "we
 * looked and the information is not there". `NOT_APPLICABLE` means "this
 * dimension does not apply to this job" — a salary question about an unpaid
 * internship is not a mismatch, it is not a question. Collapsing the two would
 * make a missing salary look like a failed requirement.
 */
export const dimensionOutcomeSchema = z.enum([
  'MATCH',
  'PARTIAL_MATCH',
  'MISMATCH',
  'UNKNOWN',
  'NOT_APPLICABLE',
]);

export type DimensionOutcome = z.infer<typeof dimensionOutcomeSchema>;

/** Where a claim came from. Used to render "why we said that" in the UI. */
export const evidenceSourceSchema = z.enum([
  'JOB_DESCRIPTION',
  'JOB_METADATA',
  'CAREER_PROFILE',
  'WORK_EXPERIENCE',
  'USER_PREFERENCES',
  'DETERMINISTIC_SCORE',
]);

export type EvidenceSource = z.infer<typeof evidenceSourceSchema>;

/**
 * Requirement importance, as stated by the posting.
 *
 * `UNCLEAR` exists because a great many postings have a requirements list with
 * no indication of which items are dealbreakers. Pretending to know would be a
 * fabrication.
 */
export const requirementImportanceSchema = z.enum([
  'REQUIRED',
  'PREFERRED',
  'HELPFUL',
  'UNCLEAR',
]);

export type RequirementImportance = z.infer<typeof requirementImportanceSchema>;

/**
 * Relationship between the posting's title and the user's target roles.
 *
 * `CONFLICTING_ROLE` is not "a worse match" — it means the role is a different
 * kind of job from what the user is looking for (a manager role for someone
 * targeting individual-contributor engineering, for example).
 */
export const titleRelationshipSchema = z.enum([
  'DIRECT_TARGET_MATCH',
  'RELATED_ROLE',
  'ADJACENT_OPPORTUNITY',
  'WEAK_MATCH',
  'CONFLICTING_ROLE',
  'INSUFFICIENT_INFORMATION',
]);

export type TitleRelationship = z.infer<typeof titleRelationshipSchema>;

/**
 * Seniority resolution. `UNCLEAR_SENIORITY` is a real, expected outcome: most
 * postings do not state a level, and inferring one from "senior" in a title is
 * exactly the keyword-matching the brief tells us not to do.
 */
export const seniorityOutcomeSchema = z.enum([
  'GOOD_MATCH',
  'POTENTIALLY_APPROPRIATE',
  'STRETCH_ROLE',
  'BELOW_TARGET',
  'ABOVE_TARGET',
  'UNCLEAR_SENIORITY',
]);

export type SeniorityOutcome = z.infer<typeof seniorityOutcomeSchema>;

/** Work arrangement, as stated by the posting. Never inferred. */
export const workArrangementSchema = z.enum([
  'REMOTE',
  'HYBRID',
  'ON_SITE',
  'MULTIPLE_OPTIONS',
  'NOT_STATED',
]);

export type WorkArrangement = z.infer<typeof workArrangementSchema>;

/**
 * Compensation compatibility. `NOT_COMPARABLE` is for the case the brief calls
 * out explicitly: two currencies with no reliable conversion available. We say
 * "we could not compare these precisely" rather than inventing a rate.
 */
export const compensationOutcomeSchema = z.enum([
  'WITHIN_PREFERENCE',
  'BELOW_PREFERENCE',
  'ABOVE_PREFERENCE',
  'PARTIALLY_OVERLAPPING',
  'NOT_STATED_BY_EMPLOYER',
  'NOT_COMPARABLE',
]);

export type CompensationOutcome = z.infer<typeof compensationOutcomeSchema>;

/**
 * The qualitative verdict.
 *
 * This is NOT a score and does not replace one. `calculateFitTier()` remains
 * the product's ranking vocabulary; these categories explain it. The mapping
 * between the two lives in `categories.ts` and is documented.
 */
export const overallCategorySchema = z.enum([
  'STRONG_MATCH',
  'POTENTIAL_MATCH',
  'STRETCH_OPPORTUNITY',
  'LOW_MATCH',
  'INSUFFICIENT_INFORMATION',
]);

export type OverallCategory = z.infer<typeof overallCategorySchema>;

/**
 * Next steps the user can actually take.
 *
 * Every value is something the user or the employer can act on. There is no
 * "APPLY_NOW" here — this feature advises, it never acts.
 */
export const recommendationActionSchema = z.enum([
  'CONFIRM_WITH_EMPLOYER',
  'CLARIFY_SALARY_RANGE',
  'VERIFY_REMOTE_ELIGIBILITY',
  'EMPHASISE_EXISTING_EVIDENCE',
  'UPDATE_CAREER_PROFILE',
  'CONSIDER_ADJACENT_ROLE',
  'ADD_JOB_DESCRIPTION',
  'REVIEW_TARGET_TITLES',
]);

export type RecommendationAction = z.infer<typeof recommendationActionSchema>;

// ─── Shared shapes ─────────────────────────────────────────────────────────

const shortText = z.string().max(280);
const sentence = z.string().max(600);

/**
 * A single traceability record.
 *
 * `excerpt` is meant to be a SHORT verbatim quote. `verify.ts` re-checks every
 * `JOB_DESCRIPTION` excerpt against the actual posting text and drops any it
 * cannot find, so a fabricated quote cannot survive to the database. Excerpts
 * sourced from the career profile are checked the same way against the profile
 * context. A claim with no excerpt is allowed — it just renders without one.
 */
export const evidenceSchema = z.object({
  source: evidenceSourceSchema,
  /** Real field path, e.g. "JobLead.salaryMin" or "CareerExperience.technologies". */
  field: z.string().max(160),
  excerpt: z.string().max(300).nullable(),
  /** What this specific piece of evidence supports. */
  supports: shortText,
});

export type Evidence = z.infer<typeof evidenceSchema>;

// ─── Dimensions ────────────────────────────────────────────────────────────

const dimensionSchema = z.object({
  outcome: dimensionOutcomeSchema,
  /** One or two sentences, user-facing. No chain of thought, no reasoning trace. */
  explanation: sentence,
  evidence: z.array(evidenceSchema).max(6),
  /** Present when the outcome is UNKNOWN. Says what is missing, not why we are unsure. */
  uncertainty: z.string().max(300).nullable(),
});

export type DimensionAnalysis = z.infer<typeof dimensionSchema>;

/**
 * Every dimension the brief asks for, always present.
 *
 * Making them all required rather than a partial array means the UI never has
 * to guard against a missing section, and it forces the model to account for
 * each one — including saying "not applicable" where that is the honest answer.
 */
export const dimensionsSchema = z.object({
  jobTitleFit: dimensionSchema,
  seniorityFit: dimensionSchema,
  requiredSkills: dimensionSchema,
  preferredSkills: dimensionSchema,
  relevantExperience: dimensionSchema,
  education: dimensionSchema,
  location: dimensionSchema,
  remoteWork: dimensionSchema,
  eligibility: dimensionSchema,
  timeZone: dimensionSchema,
  compensation: dimensionSchema,
});

export type DimensionMap = z.infer<typeof dimensionsSchema>;

export const DIMENSION_KEYS = Object.keys(dimensionsSchema.shape) as Array<
  keyof DimensionMap
>;

export const DIMENSION_LABELS: Record<keyof DimensionMap, string> = {
  jobTitleFit: 'Role title',
  seniorityFit: 'Seniority',
  requiredSkills: 'Required skills',
  preferredSkills: 'Preferred skills',
  relevantExperience: 'Relevant experience',
  education: 'Education & certifications',
  location: 'Location',
  remoteWork: 'Remote work',
  eligibility: 'Eligibility',
  timeZone: 'Time zone',
  compensation: 'Compensation',
};

// ─── Requirements ──────────────────────────────────────────────────────────

const requirementSchema = z.object({
  /** The requirement as the posting states it. Not paraphrased into something stronger. */
  requirement: shortText,
  importance: requirementImportanceSchema,
  outcome: dimensionOutcomeSchema,
  explanation: sentence,
  evidence: z.array(evidenceSchema).max(5),
  /**
   * Phrased as a search result, never as a verdict on the person.
   * "We could not find evidence of Kubernetes in your current profile" —
   * not "You do not know Kubernetes". The distinction is enforced in the
   * prompt and re-checked in `verify.ts`.
   */
  uncertainty: z.string().max(300).nullable(),
});

export type RequirementAnalysis = z.infer<typeof requirementSchema>;

export const requirementsSchema = z.array(requirementSchema).max(30);

// ─── Recommendations ───────────────────────────────────────────────────────

const recommendationSchema = z.object({
  action: recommendationActionSchema,
  detail: sentence,
  /** What in the analysis prompted this. Grounds the advice in something real. */
  rationale: shortText,
});

export type RecommendationAnalysis = z.infer<typeof recommendationSchema>;

export const recommendationsSchema = z.array(recommendationSchema).max(6);

// ─── The full analysis ─────────────────────────────────────────────────────

/**
 * What the model returns. Note what is absent: any numeric score, any user id,
 * any job id, any plan, any tool name, any instruction. Nothing in this object
 * can change state, and nothing in it identifies a record.
 */
export const modelAnalysisSchema = z
  .object({
    schemaVersion: z.number(),

    /** Two or three sentences. Why this job, for this person, in these words. */
    summary: sentence,

    overallCategory: overallCategorySchema,
    /** Why that category. Must reference dimensions, not vibes. */
    categoryRationale: sentence,

    titleRelationship: titleRelationshipSchema,
    seniorityOutcome: seniorityOutcomeSchema,
    workArrangement: workArrangementSchema,
    compensationOutcome: compensationOutcomeSchema,

    dimensions: dimensionsSchema,
    requirements: requirementsSchema,
    recommendations: recommendationsSchema,

    /**
     * Material gaps in OUR OWN inputs — a missing description, an unconfirmed
     * career profile, an unspecified salary. This is a list of things that
     * materially affect confidence, not a list of things the model is unsure
     * about. An empty array is a valid, honest answer.
     */
    limitations: z.array(shortText).max(10),
  })
  .strict();

export type ModelAnalysis = z.infer<typeof modelAnalysisSchema>;

// ─── What we store and render ──────────────────────────────────────────────

/**
 * Analysis metadata. Server-owned — the model contributes nothing here.
 */
export const analysisMetaSchema = z.object({
  schemaVersion: z.number(),
  promptVersion: z.number(),
  /** SHA-256 over the normalised inputs that produced this result. */
  inputFingerprint: z.string().max(64),
  /** Stable hash of the job + profile + preference inputs, for debugging. */
  generatedAt: z.string().max(40),
  /**
   * Whether the inputs were complete enough for a confident read.
   * Computed server-side from what data actually existed, not by the model.
   */
  dataCompleteness: z.enum(['COMPLETE', 'PARTIAL', 'MINIMAL']),
  provider: z.string().max(40),
  model: z.string().max(80),
  /** True when a job description was available to the analysis. */
  hadJobDescription: z.boolean(),
  /** True when a confirmed career profile was available. */
  hadConfirmedCareerProfile: z.boolean(),
});

export type AnalysisMeta = z.infer<typeof analysisMetaSchema>;

/**
 * The persisted result.
 *
 * `deterministic` is the application's own answer, computed by
 * `src/lib/scoring.ts` and attached after the model returns. It is never
 * model-generated, which is why it lives in its own block rather than in
 * `dimensions`.
 */
export const jobIntelligenceResultSchema = z.object({
  meta: analysisMetaSchema,

  /** Human-readable verdict. Explained by `dimensions`, never a replacement for a score. */
  overallCategory: overallCategorySchema,
  categoryRationale: z.string().max(600),

  /** The application's own numbers. Source of truth for ranking. */
  deterministic: z.object({
    fitScore: z.number(),
    fitTier: z.string().max(4),
    /** The existing `titleMatchesAny` result. Advisory explanations must agree with it. */
    titleMatch: z.boolean(),
    /** Hard gates that zeroed the score, if any. */
    blockedBy: z.array(z.string().max(80)).max(4),
  }),

  summary: z.string().max(600),
  titleRelationship: titleRelationshipSchema,
  seniorityOutcome: seniorityOutcomeSchema,
  workArrangement: workArrangementSchema,
  compensationOutcome: compensationOutcomeSchema,

  dimensions: dimensionsSchema,
  requirements: requirementsSchema,
  recommendations: recommendationsSchema,
  limitations: z.array(shortText).max(12),
});

export type JobIntelligenceResult = z.infer<typeof jobIntelligenceResultSchema>;

export type JobIntelligenceAnalysisStatus = 'PROCESSING' | 'COMPLETED' | 'FAILED';

export type AnalysisErrorCode =
  | 'NO_JOB_DATA'
  | 'NO_PROFILE_CONTEXT'
  | 'AI_NOT_CONFIGURED'
  | 'AI_RATE_LIMITED'
  | 'AI_TIMEOUT'
  | 'AI_REFUSED'
  | 'AI_EMPTY_RESPONSE'
  | 'AI_INVALID_RESPONSE'
  | 'AI_UNAVAILABLE';

/**
 * Human copy for a stored failure. Safe to show to the user.
 *
 * `NO_JOB_DATA` and `NO_PROFILE_CONTEXT` are real states a user can fix, so
 * they get actionable copy rather than a generic failure.
 */
export const ANALYSIS_ERROR_MESSAGES: Record<AnalysisErrorCode, string> = {
  NO_JOB_DATA:
    'There is not enough on this job yet to analyse it. Add the job description or edit the role details, then try again.',
  NO_PROFILE_CONTEXT:
    'We could not find anything in your career profile or preferences to compare this job against. Add some skills or target roles first.',
  AI_NOT_CONFIGURED:
    'Job intelligence is not available right now. Our team has been notified — please try again later.',
  AI_RATE_LIMITED: 'Our analysis service is busy. Please wait a moment and try again.',
  AI_TIMEOUT: 'Analysis took too long and stopped. Please try again.',
  AI_REFUSED: 'Our analysis provider could not process this job.',
  AI_EMPTY_RESPONSE: 'The analysis returned no usable results. Please try again.',
  AI_INVALID_RESPONSE: 'The analysis returned results we could not verify. Please try again.',
  AI_UNAVAILABLE: 'Our analysis service is temporarily unavailable. Please try again.',
};