/**
 * Versioned interview preparation contract.
 *
 * Same rules as `src/lib/job-intelligence/schema.ts`:
 *
 *  1. The schema describes the shape of generated content, not a prompt.
 *     Every field is validated on the server before anything is stored.
 *  2. The schema is PURE: no `.refine()`, no `.transform()`, no `.catch()`,
 *     no `.trim()`. Strict JSON Schema only; every judgement (evidence
 *     re-checking, anti-fabrication, category assignment) happens in
 *     `verify.ts`.
 *  3. There are no employer-specific questions here. The model is asked for
 *     competency-targeted questions grounded in a real posting, never for
 *     "the five questions this company always asks".
 *
 * Bumping `INTERVIEW_PREP_SCHEMA_VERSION` invalidates cached packs.
 */

import { z } from 'zod';

export const INTERVIEW_PREP_SCHEMA_VERSION = 1;

/** Schema name registered with the provider's structured-output format. */
export const INTERVIEW_PREP_SCHEMA_NAME = 'interview_preparation_pack';

/**
 * Bumped when the PROMPT changes but the output shape does not.
 *
 * Folded into the input fingerprint so a prompt tweak invalidates cached
 * packs without pretending the contract changed shape.
 */
export const INTERVIEW_PREP_PROMPT_VERSION = 1;

// ─── Vocabularies ───────────────────────────────────────────────────────────

/**
 * Preparation contexts. BALANCED is the honest default when the actual
 * interview stage is unknown: the pack covers a spread of competencies
 * without claiming to know the employer's process.
 */
export const interviewContextSchema = z.enum([
  'RECRUITER_SCREEN',
  'HIRING_MANAGER',
  'BEHAVIORAL',
  'TECHNICAL',
  'SYSTEM_DESIGN',
  'PROJECT_DISCUSSION',
  'PROBLEM_SOLVING',
  'SITUATIONAL',
  'FINAL_ROUND',
  'QUESTIONS_TO_ASK',
  'BALANCED',
]);
export type InterviewContext = z.infer<typeof interviewContextSchema>;

export const INTERVIEW_CONTEXT_LABELS: Record<InterviewContext, string> = {
  RECRUITER_SCREEN: 'Recruiter screening',
  HIRING_MANAGER: 'Hiring manager interview',
  BEHAVIORAL: 'Behavioral interview',
  TECHNICAL: 'Technical interview',
  SYSTEM_DESIGN: 'System design interview',
  PROJECT_DISCUSSION: 'Project discussion',
  PROBLEM_SOLVING: 'Problem-solving assessment',
  SITUATIONAL: 'Situational / scenario interview',
  FINAL_ROUND: 'Final-round interview',
  QUESTIONS_TO_ASK: 'Questions to ask the employer',
  BALANCED: 'Balanced preparation pack',
};

export const INTERVIEW_CONTEXT_DESCRIPTIONS: Record<InterviewContext, string> = {
  RECRUITER_SCREEN: 'Focus on background, motivation and fit screening.',
  HIRING_MANAGER: 'Focus on team needs, expectations and past work.',
  BEHAVIORAL: 'Focus on STAR-structured examples from your experience.',
  TECHNICAL: 'Focus on role-specific technical fundamentals.',
  SYSTEM_DESIGN: 'Focus on architecture, data flow and trade-offs.',
  PROJECT_DISCUSSION: 'Focus on your own projects and decisions.',
  PROBLEM_SOLVING: 'Focus on working through a practical problem.',
  SITUATIONAL: 'Focus on hypothetical workplace scenarios.',
  FINAL_ROUND: 'Focus on leadership, stakeholder and closing topics.',
  QUESTIONS_TO_ASK: 'Focus on questions for the interviewer.',
  BALANCED: 'A spread across the competencies this role emphasizes.',
};

/** What a single question is evaluating. */
export const questionCategorySchema = z.enum([
  'TECHNICAL_FUNDAMENTALS',
  'APPLIED_PROBLEM_SOLVING',
  'ARCHITECTURE_TRADE_OFFS',
  'BEHAVIORAL',
  'COMMUNICATION',
  'OWNERSHIP',
  'COLLABORATION',
  'HANDLING_AMBIGUITY',
  'DEBUGGING',
  'PROJECT_DECISIONS',
  'ROLE_SCENARIO',
  'EMPLOYER_QUESTIONS',
]);
export type QuestionCategory = z.infer<typeof questionCategorySchema>;

export const QUESTION_CATEGORY_LABELS: Record<QuestionCategory, string> = {
  TECHNICAL_FUNDAMENTALS: 'Technical fundamentals',
  APPLIED_PROBLEM_SOLVING: 'Applied problem-solving',
  ARCHITECTURE_TRADE_OFFS: 'Architecture and trade-offs',
  BEHAVIORAL: 'Behavioral',
  COMMUNICATION: 'Communication',
  OWNERSHIP: 'Ownership',
  COLLABORATION: 'Collaboration',
  HANDLING_AMBIGUITY: 'Handling ambiguity',
  DEBUGGING: 'Debugging',
  PROJECT_DECISIONS: 'Project decisions',
  ROLE_SCENARIO: 'Role-specific scenario',
  EMPLOYER_QUESTIONS: 'Questions to ask the employer',
};

/** Target seniority of the question. */
export const difficultySchema = z.enum(['FOUNDATION', 'APPLIED', 'ADVANCED']);
export type Difficulty = z.infer<typeof difficultySchema>;

/** Which answer framework, if any, suits this question type. */
export const answerStructureSchema = z.enum(['STAR', 'TECHNICAL', 'ARCHITECTURE']).nullable();
export type AnswerStructure = z.infer<typeof answerStructureSchema>;

/** Where the question content came from. */
export const sourceTypeSchema = z.enum(['GENERATED', 'MANUAL', 'EDITED']);
export type SourceType = z.infer<typeof sourceTypeSchema>;

/** Feedback rubric dimensions. A question is scored only on dimensions that
 *  make sense for its category; unrelated dimensions are never scored. */
export const rubricDimensionSchema = z.enum([
  'RELEVANCE',
  'CLARITY_STRUCTURE',
  'CONCRETE_EXAMPLE',
  'ROLE_SKILLS',
  'TECHNICAL_CORRECTNESS',
  'REASONING_TRADE_OFFS',
  'COMMUNICATION',
  'COMPLETENESS',
  'SUPPORTED_OUTCOMES',
]);
export type RubricDimension = z.infer<typeof rubricDimensionSchema>;

export const RUBRIC_DIMENSION_LABELS: Record<RubricDimension, string> = {
  RELEVANCE: 'Answers the question asked',
  CLARITY_STRUCTURE: 'Clarity and structure',
  CONCRETE_EXAMPLE: 'Uses a concrete example',
  ROLE_SKILLS: 'Role-relevant skills',
  TECHNICAL_CORRECTNESS: 'Technical correctness',
  REASONING_TRADE_OFFS: 'Reasoning and trade-offs',
  COMMUNICATION: 'Communication',
  COMPLETENESS: 'Completeness',
  SUPPORTED_OUTCOMES: 'Supported outcomes',
};

/** Per-dimension rating. INSUFFICIENT_EVIDENCE means the answer was too
 *  short or off-topic to judge that dimension at all. */
export const ratingSchema = z.enum([
  'EVIDENT',
  'PARTIAL',
  'NOT_EVIDENT',
  'INSUFFICIENT_EVIDENCE',
]);
export type Rating = z.infer<typeof ratingSchema>;

// ─── Shared shapes ─────────────────────────────────────────────────────────

const shortText = z.string().max(280);
const sentence = z.string().max(600);

/**
 * One traceability record for a question.
 *
 * `excerpt` is a short verbatim quote from the job description or profile.
 * verify.ts drops any job-description excerpt it cannot find in the posting,
 * so a fabricated quote cannot reach the database.
 */
export const evidenceSchema = z.object({
  source: z.enum(['JOB_DESCRIPTION', 'JOB_METADATA', 'CAREER_PROFILE', 'USER_PREFERENCES']),
  field: z.string().max(160),
  excerpt: z.string().max(300).nullable(),
  supports: shortText,
});
export type Evidence = z.infer<typeof evidenceSchema>;

// ─── Question contract ─────────────────────────────────────────────────────

export const modelQuestionSchema = z
  .object({
    /** Stable within one generation; the server re-issues persistent ids. */
    generationId: z.string().max(80),
    category: questionCategorySchema,
    difficulty: difficultySchema,
    competency: shortText,
    /** The question the user will actually practice. */
    question: z.string().max(1000),
    whyMatters: sentence,
    /** The job requirement this targets, in the posting's own terms. */
    relatedRequirement: z.string().max(300).nullable(),
    /**
     * A grounded pointer to the user's own experience, e.g.
     * "Your API integration project". null when the profile has nothing
     * suitable — never invented.
     */
    relevantExperience: z.string().max(400).nullable(),
    prepNotes: z.string().max(600).nullable(),
    answerStructure: answerStructureSchema,
    /** Bounded: a few natural follow-ups, never an open-ended loop. */
    followUpQuestions: z.array(z.string().max(220)).max(3),
    sourceType: sourceTypeSchema.default('GENERATED'),
    sourceEvidence: z.string().max(300).nullable(),
  })
  .strict();

export type ModelQuestion = z.infer<typeof modelQuestionSchema>;

// ─── Pack generation contract ──────────────────────────────────────────────

export const modelPackSchema = z
  .object({
    schemaVersion: z.number(),
    title: z.string().max(160),
    context: interviewContextSchema,
    /** Small, high-quality set: never more than 12 questions. */
    questions: z.array(modelQuestionSchema).max(12),
    preparationGuidance: z.string().max(900).nullable(),
    /**
     * Honest input gaps: missing description, thin profile, no matching
     * experience. An empty array is valid.
     */
    limitations: z.array(shortText).max(8),
  })
  .strict();

export type ModelPack = z.infer<typeof modelPackSchema>;

// ─── Feedback contract ─────────────────────────────────────────────────────

export const modelDimensionRatingSchema = z.object({
  dimension: rubricDimensionSchema,
  rating: ratingSchema,
  note: sentence,
  /** Short verbatim quote from the submitted answer, or null. */
  evidenceQuote: z.string().max(220).nullable(),
});
export type ModelDimensionRating = z.infer<typeof modelDimensionRatingSchema>;

export const modelFeedbackSchema = z
  .object({
    dimensions: z.array(modelDimensionRatingSchema).max(10),
    whatWorked: sentence,
    needsImprovement: sentence,
    missing: sentence,
    structureSuggestion: sentence,
    followUpPractice: z.array(z.string().max(220)).max(3),
    /**
     * Honest limits of written-only evaluation; null when none apply.
     */
    limitations: z.string().max(500).nullable(),
  })
  .strict();

export type ModelFeedback = z.infer<typeof modelFeedbackSchema>;

// ─── Errors ────────────────────────────────────────────────────────────────

export type InterviewPrepErrorCode =
  | 'NO_JOB_DATA'
  | 'NO_PROFILE_CONTEXT'
  | 'AI_NOT_CONFIGURED'
  | 'AI_RATE_LIMITED'
  | 'AI_TIMEOUT'
  | 'AI_REFUSED'
  | 'AI_EMPTY_RESPONSE'
  | 'AI_INVALID_RESPONSE'
  | 'AI_UNAVAILABLE';

export const INTERVIEW_PREP_ERROR_MESSAGES: Record<InterviewPrepErrorCode, string> = {
  NO_JOB_DATA:
    'There is not enough on this job yet to build a preparation pack. Add the job description or edit the role details, then try again.',
  NO_PROFILE_CONTEXT:
    'We could not find anything in your career profile or preferences to prepare against. Add some skills or work history first.',
  AI_NOT_CONFIGURED:
    'Interview preparation is not available right now. Our team has been notified — please try again later.',
  AI_RATE_LIMITED: 'Our preparation service is busy. Please wait a moment and try again.',
  AI_TIMEOUT: 'Preparation took too long and stopped. Please try again.',
  AI_REFUSED: 'Our preparation provider could not process this job.',
  AI_EMPTY_RESPONSE: 'The preparation pack returned no usable questions. Please try again.',
  AI_INVALID_RESPONSE: 'The preparation pack returned results we could not verify. Please try again.',
  AI_UNAVAILABLE: 'Our preparation service is temporarily unavailable. Please try again.',
};

export type PackStatus = 'ACTIVE' | 'ARCHIVED';

/** What the service returns to routes, server-owned. */
export type InterviewPrepPackData = {
  id: string;
  userId: string;
  jobId: string;
  title: string;
  context: InterviewContext;
  status: PackStatus;
  schemaVersion: number;
  promptVersion: number;
  inputFingerprint: string;
  questions: Array<{
    id: string;
    version: number;
    ordinal: number;
    category: QuestionCategory;
    difficulty: Difficulty;
    competency: string;
    question: string;
    whyMatters: string;
    relatedRequirement: string | null;
    relevantExperience: string | null;
    prepNotes: string | null;
    answerStructure: AnswerStructure | null;
    followUpQuestionIds: string[];
    sourceType: SourceType;
    sourceEvidence: string | null;
    isActive: boolean;
  }>;
  preparationGuidance: string | null;
  limitations: string[];
};
