/**
 * Versioned contract for job-specific resume optimisation.
 *
 * Three rules govern this file, and they are the same three that govern
 * `src/lib/job-intelligence/schema.ts` and `src/lib/resume/schema.ts`:
 *
 *  1. THE MODEL PROPOSES; THE SERVER APPLIES. Every operation names a target
 *     inside the actual document — a section, an entry index, a field, a bullet
 *     index — and carries the text it believes is there. The server looks that
 *     text up, and refuses the operation if it is not what the model said. There
 *     is no "instructions" field, no "patch" field, no free-form instruction the
 *     server could be talked into executing. The model has no tools, no database
 *     access and no ability to change anything by writing; it can only fill in
 *     this shape.
 *
 *  2. THE SCHEMA IS PURE. No `.refine()`, no `.transform()`, no `.catch()`.
 *     OpenAI's Structured Outputs mode refuses those, and a contract that cannot
 *     be expressed as strict JSON Schema cannot be enforced by the provider.
 *     Everything requiring judgement — index bounds, evidence re-checking, the
 *     anti-fabrication pass — happens in `verify.ts` against server code.
 *
 *  3. NO NEW CLAIMS. `proposedText` may be clearer, shorter, better ordered and
 *     better matched to the posting's vocabulary. It may not contain a number,
 *     metric, employer, technology or qualification that is not already present
 *     in the resume, the career profile or the posting. That is a server-side
 *     check, not a prompt request, and `verify.ts` enforces it by token rather
 *     than by trusting the model to have behaved.
 */

import { z } from 'zod';

export const OPTIMIZATION_SCHEMA_VERSION = 1;
export const OPTIMIZATION_SCHEMA_NAME = 'resume_optimization_proposal';

/** Bumped when the PROMPT changes but the output shape does not. */
export const OPTIMIZATION_PROMPT_VERSION = 1;

const shortText = z.string().max(400);
const sentence = z.string().max(600);
const longText = z.string().max(2000);

// ─── Vocabulary ─────────────────────────────────────────────────────────────

/**
 * Sections the model may target.
 *
 * A closed enum rather than a free string: a model that returned "Experience
 * & Achievements" or "../../etc/passwd" simply fails to validate.
 */
export const targetSectionSchema = z.enum([
  'BASICS',
  'SUMMARY',
  'EXPERIENCE',
  'SKILLS',
  'EDUCATION',
  'PROJECTS',
  'CREDENTIALS',
]);
export type TargetSection = z.infer<typeof targetSectionSchema>;

/**
 * The mutations this feature actually supports.
 *
 * Deliberately small and explicit. "Improve the resume" is not an operation; a
 * reviewer can only meaningfully approve or reject something they can see.
 */
export const operationKindSchema = z.enum([
  /** Rewrite the whole professional summary. */
  'REPLACE_SUMMARY',
  /** Rewrite the professional headline. */
  'REWRITE_HEADLINE',
  /** Rewrite one existing bullet, without changing what it claims. */
  'REWRITE_BULLET',
  /** Propose removing one bullet the user approved as redundant. */
  'REMOVE_BULLET',
  /** Propose a new ordering for the skills list. */
  'REORDER_SKILLS',
  /** Propose a new ordering for the experience entries. */
  'REORDER_EXPERIENCE',
]);
export type OperationKind = z.infer<typeof operationKindSchema>;

/**
 * Which text field inside the target entry is being changed.
 *
 * Enumerated so the server can check the field exists on that section rather
 * than indexing into arbitrary object paths with a model-supplied string.
 */
export const targetFieldSchema = z.enum([
  'summary',
  'headline',
  'responsibilities',
  'achievements',
  'results',
  'description',
  'technologies',
]);
export type TargetField = z.infer<typeof targetFieldSchema>;

/** Where a piece of supporting text came from. */
export const evidenceSourceSchema = z.enum([
  'RESUME_TEXT',
  'CAREER_PROFILE',
  'JOB_DESCRIPTION',
  'JOB_METADATA',
]);
export type EvidenceSource = z.infer<typeof evidenceSourceSchema>;

export const confidenceSchema = z.enum(['HIGH', 'MEDIUM', 'LOW']);
export type Confidence = z.infer<typeof confidenceSchema>;

// ─── Shapes ─────────────────────────────────────────────────────────────────

/**
 * A traceability record.
 *
 * `excerpt` must be a SHORT VERBATIM quote. `verify.ts` re-checks every one of
 * them against the actual resume, profile or posting text and drops any it
 * cannot find, so a fabricated quote never reaches the database.
 */
export const evidenceSchema = z.object({
  source: evidenceSourceSchema,
  /** What this piece of evidence supports. Not a path. */
  field: shortText,
  excerpt: z.string().max(300).nullable(),
});
export type Evidence = z.infer<typeof evidenceSchema>;

/**
 * Points at exactly one piece of text in the document.
 *
 * Indices, not ids: the model cannot see ids, and an index is resolved against
 * the real array server-side and bounds-checked. `bulletIndex` is the position
 * within the named bullet-array field.
 */
export const operationTargetSchema = z.object({
  section: targetSectionSchema,
  /** Position in the section's array. Omit for document-level fields. */
  entryIndex: z.number().int().min(0).nullable(),
  field: targetFieldSchema.nullable(),
  bulletIndex: z.number().int().min(0).nullable(),
});
export type OperationTarget = z.infer<typeof operationTargetSchema>;

export const operationSchema = z.object({
  kind: operationKindSchema,
  target: operationTargetSchema,
  /**
   * The text the model believes is currently there.
   *
   * This is the staleness check. If the document says something else now, the
   * operation is refused — a proposal generated against a version the user has
   * since edited cannot be applied safely, whatever it proposed.
   */
  originalText: longText,
  /**
   * The replacement text. Empty for `REMOVE_BULLET`; a comma-separated order
   * for the two `REORDER_*` kinds.
   */
  proposedText: longText,
  /** Why this helps for this specific job. One or two sentences. */
  reason: sentence,
  /** The posting requirement this addresses, quoted or closely paraphrased. */
  targetRequirement: z.string().max(300).nullable(),
  evidence: z.array(evidenceSchema).max(4),
  /**
   * The model's own claim that the rewrite keeps the original assertion. Checked
   * anyway — see `verify.ts`, which does not take this field's word for
   * anything.
   */
  preservesOriginalClaim: z.boolean(),
  confidence: confidenceSchema,
  /** Anything the user must look at before accepting. */
  warnings: z.array(shortText).max(4),
  /**
   * Where this operation should move the entry to. Only meaningful for
   * `REORDER_EXPERIENCE`; null everywhere else.
   */
  moveTo: z.number().int().min(0).nullable(),
});
export type ProposedOperation = z.infer<typeof operationSchema>;

/**
 * A question for the user, not a change.
 *
 * "Can you provide a measured result for this improvement?" is the honest
 * output when a bullet would be stronger with a number and no source supports
 * one. The model is told to raise a question rather than supply the figure.
 */
export const informationGapSchema = z.object({
  /** The question, addressed to the user. */
  question: sentence,
  /** Which part of the resume prompted it. */
  section: targetSectionSchema,
  /** Why the answer would change the resume. */
  why: sentence,
});
export type InformationGap = z.infer<typeof informationGapSchema>;

/** What the model returns. */
export const modelProposalSchema = z
  .object({
    schemaVersion: z.number(),
    /** Two or three sentences describing the overall approach. */
    summary: sentence,
    operations: z.array(operationSchema).max(20),
    informationGaps: z.array(informationGapSchema).max(8),
    /** Material limitations of this run. An empty array is a valid answer. */
    warnings: z.array(shortText).max(8),
  })
  .strict();

export type ModelProposal = z.infer<typeof modelProposalSchema>;

// ─── What we store and render ──────────────────────────────────────────────

/** Server-owned. The model contributes nothing here. */
export const proposalMetaSchema = z.object({
  schemaVersion: z.number(),
  promptVersion: z.number(),
  /** SHA-256 over the normalised inputs that produced this result. */
  inputFingerprint: z.string().max(64),
  generatedAt: z.string().max(40),
  provider: z.string().max(40),
  model: z.string().max(80),
  /** The resume revision the model was given. */
  baseRevision: z.number(),
  /** True when the posting had no description. */
  hadJobDescription: z.boolean(),
  /** True when a confirmed career profile was available. */
  hadConfirmedProfile: z.boolean(),
  /** True when a bullet was truncated to fit the provider budget. */
  resumeTruncated: z.boolean(),
  /** How many operations the model returned before verification. */
  proposedCount: z.number(),
  /** How many survived verification and are reviewable. */
  acceptedCount: z.number(),
});
export type ProposalMeta = z.infer<typeof proposalMetaSchema>;

/**
 * Why an operation was not offered to the user.
 *
 * The comments below are line comments, not JSDoc, for a reason that cost an
 * afternoon: a `/** … *\/` block inside a `z.enum()` array stops TypeScript
 * inferring the tuple of string literals, and every member is then reported as
 * an undefined name. Line comments keep the tuple intact.
 */
export const rejectionReasonSchema = z.enum([
  // `originalText` did not match the document: it has been edited since.
  'STALE',
  // The target section, entry or bullet does not exist.
  'INVALID_TARGET',
  // The operation kind is not permitted against that target.
  'PERMISSION_DENIED',
  // The proposal introduced a claim the sources do not support.
  'FABRICATED_CLAIM',
  // The evidence quotes could not be found in the sources.
  'UNSUPPORTED_EVIDENCE',
  // Beyond the schema cap, so it was never even parsed.
  'OVER_LIMIT',
]);

export type RejectionReason = z.infer<typeof rejectionReasonSchema>;

/**
 * A reviewable operation.
 *
 * `id` is assigned by the SERVER. The model returns no identifier, and an
 * identifier it chose would be a second thing to trust.
 */
export const reviewOperationSchema = z.object({
  id: z.string().max(64),
  kind: operationKindSchema,
  section: targetSectionSchema,
  sectionLabel: z.string().max(80),
  entryIndex: z.number().int().nullable(),
  field: targetFieldSchema.nullable(),
  bulletIndex: z.number().int().nullable(),
  moveTo: z.number().int().nullable(),
  originalText: z.string().max(2000),
  proposedText: z.string().max(2000),
  reason: z.string().max(600),
  targetRequirement: z.string().max(300).nullable(),
  evidence: z.array(evidenceSchema).max(4),
  confidence: confidenceSchema,
  /** Server findings the user must see. The model's own warnings are merged in. */
  warnings: z.array(z.string().max(400)).max(6),
});
export type ReviewOperation = z.infer<typeof reviewOperationSchema>;

export const rejectedOperationSchema = z.object({
  kind: operationKindSchema,
  section: targetSectionSchema,
  reason: rejectionReasonSchema,
  /** User-facing explanation. Never a stack trace or a provider message. */
  detail: z.string().max(400),
});
export type RejectedOperation = z.infer<typeof rejectedOperationSchema>;

/** The persisted, verified result. */
export const optimizationResultSchema = z.object({
  meta: proposalMetaSchema,
  summary: z.string().max(600),
  operations: z.array(reviewOperationSchema).max(20),
  rejected: z.array(rejectedOperationSchema).max(20),
  informationGaps: z.array(informationGapSchema).max(8),
  /** Deterministic job facts, attached by the server. Never model-generated. */
  job: z.object({
    id: z.string().max(64),
    title: z.string().max(300),
    company: z.string().max(300),
    fitScore: z.number(),
    fitTier: z.string().max(4),
  }),
});

export type OptimizationResult = z.infer<typeof optimizationResultSchema>;

export type OptimizationStatus = 'PROCESSING' | 'COMPLETED' | 'FAILED';

export type OptimizationErrorCode =
  | 'NO_JOB_DATA'
  | 'NO_RESUME_CONTENT'
  | 'NO_PROFILE_CONTEXT'
  | 'AI_NOT_CONFIGURED'
  | 'AI_RATE_LIMITED'
  | 'AI_TIMEOUT'
  | 'AI_REFUSED'
  | 'AI_EMPTY_RESPONSE'
  | 'AI_INVALID_RESPONSE'
  | 'AI_UNAVAILABLE';

/**
 * Human copy for a stored failure.
 *
 * `NO_RESUME_CONTENT` and `NO_JOB_DATA` are states the user can fix, so they
 * get actionable copy rather than a generic failure.
 */
export const OPTIMIZATION_ERROR_MESSAGES: Record<OptimizationErrorCode, string> = {
  NO_JOB_DATA:
    'There is not enough on this job yet to optimise for it. Add the job description first, then try again.',
  NO_RESUME_CONTENT:
    'This resume is too empty to optimise. Add at least a summary and one role, then try again.',
  NO_PROFILE_CONTEXT:
    'We could not find anything in your career profile to check this resume against. Add some skills or target roles first.',
  AI_NOT_CONFIGURED:
    'Resume optimisation is not available right now. Our team has been notified — please try again later.',
  AI_RATE_LIMITED: 'Our optimisation service is busy. Please wait a moment and try again.',
  AI_TIMEOUT: 'That took too long and stopped. Please try again.',
  AI_REFUSED: 'Our provider could not process this resume.',
  AI_EMPTY_RESPONSE: 'The result contained nothing usable. Please try again.',
  AI_INVALID_RESPONSE: 'The result did not pass our checks, so nothing was proposed. Please try again.',
  AI_UNAVAILABLE: 'Our optimisation service is temporarily unavailable. Please try again.',
};

/** Labels for the review UI. Presentation only. */
export const OPERATION_LABELS: Record<OperationKind, string> = {
  REPLACE_SUMMARY: 'Rewrite your summary',
  REWRITE_HEADLINE: 'Rewrite your headline',
  REWRITE_BULLET: 'Rewrite a bullet',
  REMOVE_BULLET: 'Remove a redundant bullet',
  REORDER_SKILLS: 'Reorder your skills',
  REORDER_EXPERIENCE: 'Reorder your experience',
};

export const SECTION_LABELS: Record<TargetSection, string> = {
  BASICS: 'Basic information',
  SUMMARY: 'Professional Summary',
  EXPERIENCE: 'Work Experience',
  SKILLS: 'Skills',
  EDUCATION: 'Education',
  PROJECTS: 'Projects',
  CREDENTIALS: 'Certifications & Awards',
};

export const FIELD_LABELS: Record<TargetField, string> = {
  summary: 'summary',
  headline: 'headline',
  responsibilities: 'responsibility',
  achievements: 'achievement',
  results: 'result',
  description: 'description',
  technologies: 'technologies',
};