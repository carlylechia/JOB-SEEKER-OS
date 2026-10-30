/**
 * Versioned interview preparation contract.
 *
 * Two rules govern this file:
 *
 *  1. The schema describes the SHAPE of generated preparation content, never a
 *     prompt. Every field is validated on the server before persistence.
 *  2. The schema is PURE: no `.refine()`, no `.transform()`, no `.catch()`.
 *     OpenAI Structured Outputs receives a JSON Schema derived directly from
 *     these objects. Every judgement (evidence re-checking, source resolution,
 *     anti-fabrication) happens in `verify.ts`.
 *
 * There are deliberately no employer-specific questions here. The model is
 * asked for competency-targeted practice questions grounded in a real posting,
 * never for "the questions this company asks". Every generated question is
 * marked as a prediction.
 */

import { z } from 'zod';

export const INTERVIEW_PREP_SCHEMA_VERSION = 2;
export const INTERVIEW_PREP_PROMPT_VERSION = 3;
export const INTERVIEW_PREP_SCHEMA_NAME = 'interview_preparation_pack';

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
  'PRACTICAL_ASSESSMENT',
  'CASE_STUDY',
  'PANEL',
  'PROJECT_DISCUSSION',
  'PROBLEM_SOLVING',
  'SITUATIONAL',
  'CULTURE_FIT',
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
  PRACTICAL_ASSESSMENT: 'Practical assessment',
  CASE_STUDY: 'Case study',
  PANEL: 'Panel interview',
  PROJECT_DISCUSSION: 'Project discussion',
  PROBLEM_SOLVING: 'Problem-solving assessment',
  SITUATIONAL: 'Situational / scenario interview',
  CULTURE_FIT: 'Culture and values conversation',
  FINAL_ROUND: 'Final-round interview',
  QUESTIONS_TO_ASK: 'Questions to ask the employer',
  BALANCED: 'Balanced preparation pack',
};

export const INTERVIEW_CONTEXT_DESCRIPTIONS: Record<InterviewContext, string> = {
  RECRUITER_SCREEN: 'Background, motivation and fit screening.',
  HIRING_MANAGER: 'Team needs, expectations and past work.',
  BEHAVIORAL: 'Examples from your own experience.',
  TECHNICAL: 'Role-specific technical fundamentals and reasoning.',
  SYSTEM_DESIGN: 'Architecture, data flow and trade-offs.',
  PRACTICAL_ASSESSMENT: 'A realistic task or work sample.',
  CASE_STUDY: 'Structured analysis of a realistic business case.',
  PANEL: 'Multiple interviewers and stakeholder perspectives.',
  PROJECT_DISCUSSION: 'Your own projects and the decisions behind them.',
  PROBLEM_SOLVING: 'Working through a practical problem out loud.',
  SITUATIONAL: 'Hypothetical workplace scenarios.',
  CULTURE_FIT: 'Values, working style and collaboration.',
  FINAL_ROUND: 'Leadership, stakeholder and closing topics.',
  QUESTIONS_TO_ASK: 'Thoughtful questions for the interviewer.',
  BALANCED: 'A spread across the competencies this role emphasizes.',
};

// ─── Interview tracks ──────────────────────────────────────────────────────

/**
 * A small, stable grouping used for UI filtering, question ranking and prompt
 * playbooks. Contexts remain the precise user choice; tracks are derived so a
 * pack can never belong to two tracks at once.
 */
export const interviewTrackSchema = z.enum([
  'BEHAVIORAL',
  'TECHNICAL',
  'CASE_STUDY',
  'ROLE_AND_COMPANY',
  'MIXED',
]);
export type InterviewTrack = z.infer<typeof interviewTrackSchema>;

export const INTERVIEW_TRACK_LABELS: Record<InterviewTrack, string> = {
  BEHAVIORAL: 'Behavioural',
  TECHNICAL: 'Technical',
  CASE_STUDY: 'Case study',
  ROLE_AND_COMPANY: 'Role and company',
  MIXED: 'Mixed',
};

export const INTERVIEW_TRACK_DESCRIPTIONS: Record<InterviewTrack, string> = {
  BEHAVIORAL:
    'Questions about your own experience, judgement and collaboration. Answers should use real examples with a clear situation, action and result.',
  TECHNICAL:
    'Role-specific fundamentals, applied problem solving, debugging, architecture and trade-offs. Answers should show reasoning, not just a conclusion.',
  CASE_STUDY:
    'A structured analysis of a realistic business or product case. Answers should state assumptions, use a clear framework, weigh options and recommend a defensible next step.',
  ROLE_AND_COMPANY:
    'Motivation, role fit, employer understanding and the questions you ask. Answers should connect verified company facts to your own evidence.',
  MIXED:
    'A balanced preparation pack covering behavioural, technical and role-specific ground. Use it when the actual interview format is unknown or spans several stages.',
};

export const INTERVIEW_TRACK_CONTEXTS: Record<InterviewTrack, InterviewContext[]> = {
  BEHAVIORAL: ['BEHAVIORAL', 'SITUATIONAL', 'CULTURE_FIT'],
  TECHNICAL: ['TECHNICAL', 'SYSTEM_DESIGN', 'PRACTICAL_ASSESSMENT', 'PROBLEM_SOLVING', 'PROJECT_DISCUSSION'],
  CASE_STUDY: ['CASE_STUDY'],
  ROLE_AND_COMPANY: ['RECRUITER_SCREEN', 'HIRING_MANAGER', 'FINAL_ROUND', 'QUESTIONS_TO_ASK'],
  MIXED: ['BALANCED', 'PANEL'],
};

/** Every context maps to exactly one track. */
export function interviewTrackForContext(context: InterviewContext): InterviewTrack {
  for (const track of Object.keys(INTERVIEW_TRACK_CONTEXTS) as InterviewTrack[]) {
    if (INTERVIEW_TRACK_CONTEXTS[track].includes(context)) return track;
  }
  return 'MIXED';
}

/** The most representative context for a track, used when one is needed. */
export function primaryContextForTrack(track: InterviewTrack): InterviewContext {
  switch (track) {
    case 'BEHAVIORAL':
      return 'BEHAVIORAL';
    case 'TECHNICAL':
      return 'TECHNICAL';
    case 'CASE_STUDY':
      return 'CASE_STUDY';
    case 'ROLE_AND_COMPANY':
      return 'HIRING_MANAGER';
    case 'MIXED':
    default:
      return 'BALANCED';
  }
}

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
  'MOTIVATION',
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
  MOTIVATION: 'Motivation and employer understanding',
};

/**
 * Deterministic question preferences per track. These influence ranking and
 * fallback selection only; the provider still chooses the actual questions.
 */
export const INTERVIEW_TRACK_PREFERRED_CATEGORIES: Record<InterviewTrack, QuestionCategory[]> = {
  BEHAVIORAL: ['BEHAVIORAL', 'COLLABORATION', 'OWNERSHIP', 'HANDLING_AMBIGUITY', 'COMMUNICATION'],
  TECHNICAL: [
    'TECHNICAL_FUNDAMENTALS',
    'APPLIED_PROBLEM_SOLVING',
    'ARCHITECTURE_TRADE_OFFS',
    'DEBUGGING',
    'PROJECT_DECISIONS',
    'ROLE_SCENARIO',
  ],
  CASE_STUDY: ['APPLIED_PROBLEM_SOLVING', 'ARCHITECTURE_TRADE_OFFS', 'HANDLING_AMBIGUITY', 'COMMUNICATION', 'ROLE_SCENARIO'],
  ROLE_AND_COMPANY: ['MOTIVATION', 'EMPLOYER_QUESTIONS', 'ROLE_SCENARIO', 'PROJECT_DECISIONS', 'COMMUNICATION'],
  MIXED: [
    'BEHAVIORAL',
    'TECHNICAL_FUNDAMENTALS',
    'APPLIED_PROBLEM_SOLVING',
    'ARCHITECTURE_TRADE_OFFS',
    'COLLABORATION',
    'OWNERSHIP',
    'HANDLING_AMBIGUITY',
    'DEBUGGING',
    'PROJECT_DECISIONS',
    'ROLE_SCENARIO',
    'MOTIVATION',
    'COMMUNICATION',
    'EMPLOYER_QUESTIONS',
  ],
};

/** Prompt-ready guidance for how material should differ by track. */
export const INTERVIEW_TRACK_GUIDANCE: Record<InterviewTrack, string> = {
  BEHAVIORAL:
    'Build a behavioural bank. At least two-thirds of questions should ask for a real past example and use the STAR structure. Cover ownership, collaboration, conflict, ambiguity, failure and impact. Every sample wording must contain bracketed placeholders rather than an invented story. In feedback, reward a specific situation, the candidate’s own actions and a verified result; penalise vague generalisations and “we” answers that hide personal contribution.',
  TECHNICAL:
    'Build a technical bank. Cover fundamentals, applied reasoning, debugging, architecture and trade-offs appropriate to the seniority in the posting. Questions should ask the candidate to explain assumptions, alternatives, failure modes and validation. In feedback, check technical correctness explicitly, reward reasoning and trade-offs, and correct misconceptions in the model answer without inventing production facts.',
  CASE_STUDY:
    'Build a case-study bank. Questions should present a realistic business or product situation with incomplete information and ask for structure, assumptions, analysis, options, a recommendation and success measures. Include at least one quantitative or prioritisation case when the role supports it. In feedback, reward a clear framework, explicit assumptions, quantified reasoning where possible and a decision with trade-offs; penalise jumping to a solution without diagnosis.',
  ROLE_AND_COMPANY:
    'Build a role-and-company bank. Cover motivation, understanding of the employer, role fit, recruiter-screen questions, stakeholder scenarios and thoughtful questions to ask. Use only sourced company facts and the candidate’s verified evidence. In feedback, reward a specific, honest connection between the candidate’s evidence and the role; penalise generic praise of the company and unsupported claims about its culture or process.',
  MIXED:
    'Build a balanced bank across behavioural, technical, case-style and role-and-company questions, weighted to the posting. Do not let one track dominate unless the job description clearly demands it. In feedback, apply the rubric that fits the individual question rather than forcing one framework onto every answer.',
};

export const difficultySchema = z.enum(['FOUNDATION', 'APPLIED', 'ADVANCED']);
export type Difficulty = z.infer<typeof difficultySchema>;

/** Which answer framework, if any, suits this question type. */
export const answerStructureSchema = z.enum(['STAR', 'TECHNICAL', 'ARCHITECTURE', 'SITUATIONAL']).nullable();
export type AnswerStructure = z.infer<typeof answerStructureSchema>;

export const sourceTypeSchema = z.enum(['GENERATED', 'MANUAL', 'EDITED']);
export type SourceType = z.infer<typeof sourceTypeSchema>;

export const prioritySchema = z.enum(['HIGH', 'MEDIUM', 'LOW']);
export type Priority = z.infer<typeof prioritySchema>;

export const importanceSchema = z.enum(['CRITICAL', 'IMPORTANT', 'VALUABLE']);
export type Importance = z.infer<typeof importanceSchema>;

export const requirementTypeSchema = z.enum(['EXPLICIT', 'INFERRED']);
export type RequirementType = z.infer<typeof requirementTypeSchema>;

export const evidenceStatusSchema = z.enum([
  'DEMONSTRATED',
  'TRANSFERABLE',
  'NO_EVIDENCE_FOUND',
  'UNCLEAR',
]);
export type EvidenceStatus = z.infer<typeof evidenceStatusSchema>;

export const evidenceSourceSchema = z.enum(['PROFILE', 'RESUME', 'USER_INPUT', 'NONE']);
export type EvidenceSource = z.infer<typeof evidenceSourceSchema>;

export const confidenceSchema = z.enum(['HIGH', 'MEDIUM', 'LOW']);
export type Confidence = z.infer<typeof confidenceSchema>;

export const questionEvidenceBasisSchema = z.enum([
  'JOB_DESCRIPTION',
  'COMPANY_RESEARCH',
  'ROLE_INFERENCE',
  'GENERAL_PRACTICE',
]);
export type QuestionEvidenceBasis = z.infer<typeof questionEvidenceBasisSchema>;

export const companyClaimBasisSchema = z.enum(['SOURCE', 'INFERENCE']);
export type CompanyClaimBasis = z.infer<typeof companyClaimBasisSchema>;

export const prepHorizonSchema = z.enum([
  'WITHIN_24_HOURS',
  'TWO_THREE_DAYS',
  'WITHIN_A_WEEK',
  'MORE_THAN_A_WEEK',
  'UNKNOWN',
]);
export type PrepHorizon = z.infer<typeof prepHorizonSchema>;

/** Approximate timing supplied when the exact date is unknown. */
export const prepTimingSchema = prepHorizonSchema;
export type PrepTiming = PrepHorizon;

export const taskCategorySchema = z.enum(['RESEARCH', 'PRACTICE', 'REVIEW', 'LOGISTICS', 'WRITING']);
export type TaskCategory = z.infer<typeof taskCategorySchema>;

export const taskStatusSchema = z.enum(['PENDING', 'COMPLETED', 'DEFERRED']);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const practiceModeSchema = z.enum([
  'FULL',
  'BEHAVIORAL',
  'ROLE_SPECIFIC',
  'COMPANY_MOTIVATION',
  'WEAK_AREA',
  'QUICK',
]);
export type PracticeMode = z.infer<typeof practiceModeSchema>;

export const PRACTICE_MODE_LABELS: Record<PracticeMode, string> = {
  FULL: 'Full mock interview',
  BEHAVIORAL: 'Behavioral interview',
  ROLE_SPECIFIC: 'Role-specific interview',
  COMPANY_MOTIVATION: 'Company and motivation',
  WEAK_AREA: 'Weak-area practice',
  QUICK: 'Quick practice',
};

export const packStatusSchema = z.enum([
  'DRAFT',
  'RESEARCHING',
  'GENERATING',
  'READY',
  'PARTIALLY_READY',
  'FAILED',
  'ARCHIVED',
]);
export type PackStatus = z.infer<typeof packStatusSchema>;

export const researchStatusSchema = z.enum([
  'NOT_STARTED',
  'COMPLETED',
  'PARTIAL',
  'NOT_AVAILABLE',
  'FAILED',
]);
export type ResearchStatus = z.infer<typeof researchStatusSchema>;

export const researchSourceKindSchema = z.enum([
  'JOB_DESCRIPTION',
  'USER_NOTES',
  'OFFICIAL_CAREERS',
  'OFFICIAL_COMPANY',
  'OFFICIAL_NEWSROOM',
  'OFFICIAL_FILING',
  'NEWS',
  'OTHER',
]);
export type ResearchSourceKind = z.infer<typeof researchSourceKindSchema>;

export const RESEARCH_SOURCE_KIND_LABELS: Record<ResearchSourceKind, string> = {
  JOB_DESCRIPTION: 'Job description',
  USER_NOTES: 'User-supplied notes',
  OFFICIAL_CAREERS: 'Official careers page',
  OFFICIAL_COMPANY: 'Official company page',
  OFFICIAL_NEWSROOM: 'Official newsroom',
  OFFICIAL_FILING: 'Official filing or report',
  NEWS: 'News publication',
  OTHER: 'Other source',
};

export const researchFetchStatusSchema = z.enum(['FETCHED', 'FAILED', 'USER_SUPPLIED']);
export type ResearchFetchStatus = z.infer<typeof researchFetchStatusSchema>;

export const researchVerificationSchema = z.enum(['SOURCE_BACKED', 'USER_SUPPLIED', 'UNVERIFIED']);
export type ResearchVerification = z.infer<typeof researchVerificationSchema>;

/** Feedback rubric dimensions. Only dimensions relevant to a category are scored. */
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
  'PROFESSIONAL_JUDGMENT',
  'SAFETY_CONSIDERATIONS',
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
  PROFESSIONAL_JUDGMENT: 'Professional judgment',
  SAFETY_CONSIDERATIONS: 'Safety and risk awareness',
};

export const ratingSchema = z.enum([
  'EVIDENT',
  'PARTIAL',
  'NOT_EVIDENT',
  'INSUFFICIENT_EVIDENCE',
]);
export type Rating = z.infer<typeof ratingSchema>;

// ─── Shared primitives ─────────────────────────────────────────────────────

const shortText = z.string().max(300);
const sentence = z.string().max(700);
const longSentence = z.string().max(1200);

const sourceIndexesSchema = z.array(z.number().int().min(0)).max(8);
const sourceIndexSchema = z.number().int().min(0);

// ─── Company research dossier ──────────────────────────────────────────────

export const modelCompanyClaimSchema = z
  .object({
    /** A concise factual claim, in the user's language, not a copied paragraph. */
    claim: z.string().max(700),
    /**
     * SOURCE means the claim is supported by one or more supplied research
     * sources. INFERENCE means it is a reasonable preparation inference and is
     * labelled as such. A SOURCE claim with no valid source is dropped.
     */
    basis: companyClaimBasisSchema,
    sourceIndexes: sourceIndexesSchema,
    /** Why this matters for the target role or interview. */
    whyItMatters: z.string().max(600).nullable(),
  })
  .strict();
export type ModelCompanyClaim = z.infer<typeof modelCompanyClaimSchema>;

export const modelRecentDevelopmentSchema = z
  .object({
    title: z.string().max(220),
    /** ISO date (YYYY-MM-DD) when the source reports one, else null. */
    date: z.string().max(20).nullable(),
    summary: z.string().max(900),
    basis: companyClaimBasisSchema,
    sourceIndexes: sourceIndexesSchema,
    whyItMatters: z.string().max(600).nullable(),
  })
  .strict();
export type ModelRecentDevelopment = z.infer<typeof modelRecentDevelopmentSchema>;

export const modelCompanySectionSchema = z
  .object({
    overview: modelCompanyClaimSchema.nullable(),
    products: z.array(modelCompanyClaimSchema).max(6),
    customers: modelCompanyClaimSchema.nullable(),
    mission: modelCompanyClaimSchema.nullable(),
    values: z.array(modelCompanyClaimSchema).max(8),
    cultureNotes: z.array(modelCompanyClaimSchema).max(6),
    recentDevelopments: z.array(modelRecentDevelopmentSchema).max(5),
    /** How verified company context connects to the actual role. */
    roleContext: z.array(z.string().max(600)).max(6),
    /** A "why this company" answer using only real sources and candidate facts. */
    whyThisCompanyDraft: z.string().max(1400),
    /** Placeholders the user must fill with their own genuine motivation. */
    whyThisCompanyPlaceholders: z.array(z.string().max(160)).max(8),
    researchLimitations: z.array(z.string().max(320)).max(6),
  })
  .strict();
export type ModelCompanySection = z.infer<typeof modelCompanySectionSchema>;

// ─── Role intelligence ─────────────────────────────────────────────────────

export const modelRequirementSchema = z
  .object({
    requirement: z.string().max(500),
    importance: importanceSchema,
    requirementType: requirementTypeSchema,
    evidenceStatus: evidenceStatusSchema,
    /** A short VERBATIM profile excerpt, or null when there is no evidence. */
    evidenceQuote: z.string().max(500).nullable(),
    evidenceExplanation: z.string().max(700).nullable(),
    evidenceSource: evidenceSourceSchema,
    gap: z.string().max(600).nullable(),
    preparationAction: z.string().max(700),
    confidence: confidenceSchema,
    /** A short VERBATIM job-description excerpt, or null. */
    sourceQuote: z.string().max(500).nullable(),
  })
  .strict();
export type ModelRequirement = z.infer<typeof modelRequirementSchema>;

export const modelCompetencySchema = z
  .object({
    name: z.string().max(180),
    why: z.string().max(700),
    requirement: z.string().max(500).nullable(),
    evidenceQuote: z.string().max(500).nullable(),
    evidenceExplanation: z.string().max(700).nullable(),
    sampleQuestion: z.string().max(900),
    strongAnswerShows: z.string().max(800),
    practiceAdvice: z.string().max(700),
    evidenceBasis: questionEvidenceBasisSchema,
  })
  .strict();
export type ModelCompetency = z.infer<typeof modelCompetencySchema>;

export const modelRoleSectionSchema = z
  .object({
    summary: z.string().max(1200),
    responsibilities: z.array(z.string().max(500)).max(10),
    requirements: z.array(modelRequirementSchema).max(12),
    competencies: z.array(modelCompetencySchema).max(8),
    likelyChallenges: z.array(z.string().max(600)).max(6),
    /** Detected occupational family helps the UI choose activity language. */
    occupationalFamily: z.string().max(80),
  })
  .strict();
export type ModelRoleSection = z.infer<typeof modelRoleSectionSchema>;

// ─── Candidate evidence bank ───────────────────────────────────────────────

export const evidenceBankItemSchema = z
  .object({
    theme: z.string().max(160),
    title: z.string().max(220),
    /** A short VERBATIM excerpt from the candidate profile, or null. */
    evidenceQuote: z.string().max(500).nullable(),
    evidenceNote: z.string().max(700),
    sourceLabel: z.string().max(160),
    whatItSupports: z.string().max(600),
    missingDetails: z.array(z.string().max(300)).max(5),
    competencies: z.array(z.string().max(180)).max(5),
    /** CONFIRMED_PROFILE only when the quote was verified against the profile. */
    verification: z.enum(['CONFIRMED_PROFILE', 'UNCONFIRMED_PROFILE', 'NEEDS_USER_INPUT']),
  })
  .strict();
export type ModelEvidenceBankItem = z.infer<typeof evidenceBankItemSchema>;

// ─── Briefing ──────────────────────────────────────────────────────────────

export const modelBriefingSchema = z
  .object({
    summary: z.string().max(1200),
    topPriorities: z
      .array(
        z
          .object({
            title: z.string().max(220),
            why: z.string().max(600),
            basis: questionEvidenceBasisSchema,
            priority: prioritySchema,
          })
          .strict(),
      )
      .max(5),
    strongestEvidence: z
      .array(
        z
          .object({
            theme: z.string().max(160),
            evidenceQuote: z.string().max(500).nullable(),
            explanation: z.string().max(600),
            verification: z.enum(['CONFIRMED_PROFILE', 'UNCONFIRMED_PROFILE', 'NEEDS_USER_INPUT']),
          })
          .strict(),
      )
      .max(5),
    gaps: z
      .array(
        z
          .object({
            gap: z.string().max(500),
            preparationAction: z.string().max(600),
            evidenceStatus: evidenceStatusSchema,
          })
          .strict(),
      )
      .max(6),
    keyCompanyFacts: z
      .array(
        z
          .object({
            fact: z.string().max(500),
            sourceIndexes: sourceIndexesSchema,
          })
          .strict(),
      )
      .max(6),
    nextAction: z.string().max(500),
  })
  .strict();
export type ModelBriefing = z.infer<typeof modelBriefingSchema>;

// ─── Question bank ─────────────────────────────────────────────────────────

export const modelQuestionCoachingSchema = z
  .object({
    whatInterviewerAssesses: z.string().max(700),
    keyPoints: z.array(z.string().max(400)).max(6),
    practiceExercise: z.string().max(600),
    /** Placeholder-only sample wording. Never a fabricated personal story. */
    sampleWordingPlaceholder: z.string().max(900).nullable(),
  })
  .strict();
export type ModelQuestionCoaching = z.infer<typeof modelQuestionCoachingSchema>;

export const modelQuestionSchema = z
  .object({
    generationId: z.string().max(80),
    category: questionCategorySchema,
    difficulty: difficultySchema,
    competency: shortText,
    question: z.string().max(1200),
    whyMatters: sentence,
    relatedRequirement: z.string().max(400).nullable(),
    /** A short VERBATIM candidate-profile quote, or null. */
    candidateEvidenceQuote: z.string().max(500).nullable(),
    candidateEvidenceNote: z.string().max(500).nullable(),
    prepNotes: z.string().max(700).nullable(),
    answerStructure: answerStructureSchema,
    strongAnswerShows: z.string().max(800),
    commonPitfalls: z.array(z.string().max(400)).max(5),
    coaching: modelQuestionCoachingSchema,
    evidenceBasis: questionEvidenceBasisSchema,
    priority: prioritySchema,
    sourceIndexes: sourceIndexesSchema,
    followUpQuestions: z.array(z.string().max(300)).max(3),
    isPrediction: z.boolean(),
  })
  .strict();
export type ModelQuestion = z.infer<typeof modelQuestionSchema>;

// ─── Employer questions ────────────────────────────────────────────────────

export const modelEmployerQuestionSchema = z
  .object({
    question: z.string().max(600),
    why: z.string().max(500),
    category: z.enum(['ROLE', 'COMPANY', 'TEAM', 'PROCESS', 'GROWTH']),
    priority: prioritySchema,
    sourceIndexes: sourceIndexesSchema,
  })
  .strict();
export type ModelEmployerQuestion = z.infer<typeof modelEmployerQuestionSchema>;

// ─── Tasks and logistics ───────────────────────────────────────────────────

export const modelTaskSchema = z
  .object({
    taskKey: z.string().max(80),
    title: z.string().max(220),
    description: z.string().max(900),
    whyItMatters: z.string().max(600),
    expectedOutput: z.string().max(500),
    priority: prioritySchema,
    category: taskCategorySchema,
    estimatedMinutes: z.number().int().min(5).max(90),
    horizon: prepHorizonSchema,
  })
  .strict();
export type ModelTask = z.infer<typeof modelTaskSchema>;

export const modelLogisticsItemSchema = z
  .object({
    topic: z.string().max(160),
    guidance: z.string().max(700),
    basis: z.enum(['USER_SUPPLIED', 'FORMAT_GENERAL', 'JOB_REQUIREMENT']),
  })
  .strict();
export type ModelLogisticsItem = z.infer<typeof modelLogisticsItemSchema>;

// ─── Cheat sheet ───────────────────────────────────────────────────────────

export const modelCheatSheetSchema = z
  .object({
    companyFacts: z.array(z.string().max(400)).max(6),
    topCompetencies: z.array(z.string().max(260)).max(5),
    strongestExamples: z.array(z.string().max(400)).max(4),
    questionsToAsk: z.array(z.string().max(400)).max(5),
    logistics: z.array(z.string().max(400)).max(5),
    reminders: z.array(z.string().max(300)).max(5),
    unknowns: z.array(z.string().max(300)).max(4),
  })
  .strict();
export type ModelCheatSheet = z.infer<typeof modelCheatSheetSchema>;

// ─── Pack generation contract ──────────────────────────────────────────────

export const modelPackSchema = z
  .object({
    schemaVersion: z.number(),
    title: z.string().max(160),
    context: interviewContextSchema,
    briefing: modelBriefingSchema,
    company: modelCompanySectionSchema,
    role: modelRoleSectionSchema,
    evidenceBank: z.array(evidenceBankItemSchema).max(8),
    /** A practical default bank: 12–20 selected questions for most roles. */
    questions: z.array(modelQuestionSchema).max(20),
    employerQuestions: z.array(modelEmployerQuestionSchema).max(8),
    tasks: z.array(modelTaskSchema).max(10),
    logistics: z.array(modelLogisticsItemSchema).max(8),
    cheatSheet: modelCheatSheetSchema,
    preparationGuidance: z.string().max(1200).nullable(),
    limitations: z.array(shortText).max(10),
  })
  .strict();
export type ModelPack = z.infer<typeof modelPackSchema>;

// ─── Feedback contract ─────────────────────────────────────────────────────

export const modelDimensionRatingSchema = z.object({
  dimension: rubricDimensionSchema,
  rating: ratingSchema,
  note: sentence,
  /** Short verbatim quote from the submitted answer, or null. */
  evidenceQuote: z.string().max(280).nullable(),
});
export type ModelDimensionRating = z.infer<typeof modelDimensionRatingSchema>;

export const modelAdaptiveFollowUpSchema = z
  .object({
    question: z.string().max(500),
    why: z.string().max(400),
    whatToInclude: z.array(z.string().max(300)).max(4),
  })
  .strict();
export type ModelAdaptiveFollowUp = z.infer<typeof modelAdaptiveFollowUpSchema>;

export const modelFeedbackSchema = z
  .object({
    /** Honest overall score out of 10, anchored to the rubric. */
    score: z.number().min(0).max(10),
    /** One or two sentences explaining exactly why the score was awarded. */
    scoreRationale: sentence,
    /**
     * A complete, ready-to-say model answer to this exact question. Personal
     * facts not present in the candidate evidence must use [bracketed
     * placeholders]; never invent an employer, metric, project or outcome.
     */
    modelAnswer: z.string().max(2400),
    dimensions: z.array(modelDimensionRatingSchema).max(12),
    whatWorked: sentence,
    needsImprovement: sentence,
    missing: sentence,
    structureSuggestion: sentence,
    /** A concise outline for the candidate's own revised answer. */
    revisedStructure: z.string().max(900).nullable(),
    followUpPractice: z.array(z.string().max(300)).max(3),
    adaptiveFollowUp: modelAdaptiveFollowUpSchema.nullable(),
    limitations: z.string().max(600).nullable(),
  })
  .strict();
export type ModelFeedback = z.infer<typeof modelFeedbackSchema>;

// ─── Errors ────────────────────────────────────────────────────────────────

export type InterviewPrepErrorCode =
  | 'NO_JOB_DATA'
  | 'NO_PROFILE_CONTEXT'
  | 'JOB_URL_UNREACHABLE'
  | 'AI_NOT_CONFIGURED'
  | 'AI_RATE_LIMITED'
  | 'AI_TIMEOUT'
  | 'AI_REFUSED'
  | 'AI_EMPTY_RESPONSE'
  | 'AI_INVALID_RESPONSE'
  | 'AI_UNAVAILABLE';

export const INTERVIEW_PREP_ERROR_MESSAGES: Record<InterviewPrepErrorCode, string> = {
  NO_JOB_DATA:
    'Add the job description or edit the role details before generating a preparation pack.',
  NO_PROFILE_CONTEXT:
    'We could not find anything in your career profile or the details you supplied to prepare against. Add a few skills or a work example first.',
  JOB_URL_UNREACHABLE:
    'We could not read that job URL. Check that it is a public page, or paste the job description instead.',
  AI_NOT_CONFIGURED:
    'Interview preparation is not available right now. Our team has been notified — please try again later.',
  AI_RATE_LIMITED: 'Our preparation service is busy. Please wait a moment and try again.',
  AI_TIMEOUT: 'Preparation took too long and stopped. Please try again.',
  AI_REFUSED: 'Our preparation provider could not process this job.',
  AI_EMPTY_RESPONSE: 'The preparation pack returned no usable questions. Please try again.',
  AI_INVALID_RESPONSE: 'The preparation pack returned results we could not verify. Please try again.',
  AI_UNAVAILABLE: 'Our preparation service is temporarily unavailable. Please try again.',
};

/** What the service returns to routes, server-owned. */
export type InterviewPrepPackData = {
  id: string;
  userId: string;
  jobId: string | null;
  title: string;
  company: string;
  roleTitle: string;
  location: string | null;
  jobUrl: string | null;
  context: InterviewContext;
  interviewAt: Date | null;
  interviewFormat: InterviewContext;
  timing: PrepTiming;
  interviewLanguage: string | null;
  interviewerInfo: string | null;
  concerns: string | null;
  focusTopics: string[];
  companyWebsiteUrl: string | null;
  careersUrl: string | null;
  status: PackStatus;
  researchStatus: ResearchStatus;
  schemaVersion: number;
  promptVersion: number;
  inputFingerprint: string;
  content: PrepContent | null;
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
    priority: Priority;
    evidenceBasis: QuestionEvidenceBasis;
    strongAnswerShows: string | null;
    commonPitfalls: string[];
    coaching: QuestionCoaching | null;
    sourceRefs: string[];
    isPrediction: boolean;
    isActive: boolean;
  }>;
  preparationGuidance: string | null;
  limitations: string[];
};

// ─── Persisted content shape ───────────────────────────────────────────────

export type QuestionCoaching = {
  whatInterviewerAssesses: string;
  keyPoints: string[];
  practiceExercise: string;
  sampleWordingPlaceholder: string | null;
};

export type PrepContent = {
  briefing: {
    summary: string;
    topPriorities: Array<{
      title: string;
      why: string;
      basis: QuestionEvidenceBasis;
      priority: Priority;
    }>;
    strongestEvidence: Array<{
      theme: string;
      evidenceQuote: string | null;
      explanation: string;
      verification: 'CONFIRMED_PROFILE' | 'UNCONFIRMED_PROFILE' | 'NEEDS_USER_INPUT';
    }>;
    gaps: Array<{
      gap: string;
      preparationAction: string;
      evidenceStatus: EvidenceStatus;
    }>;
    keyCompanyFacts: Array<{ fact: string; sourceIndexes: number[] }>;
    nextAction: string;
  };
  company: {
    overview: ModelCompanyClaim | null;
    products: ModelCompanyClaim[];
    customers: ModelCompanyClaim | null;
    mission: ModelCompanyClaim | null;
    values: ModelCompanyClaim[];
    cultureNotes: ModelCompanyClaim[];
    recentDevelopments: ModelRecentDevelopment[];
    roleContext: string[];
    whyThisCompanyDraft: string;
    whyThisCompanyPlaceholders: string[];
    researchLimitations: string[];
    researchStatus: ResearchStatus;
    sourceCount: number;
    fetchedSourceCount: number;
  };
  role: {
    summary: string;
    responsibilities: string[];
    requirements: Array<
      Omit<ModelRequirement, 'evidenceQuote' | 'sourceQuote'> & {
        evidenceQuote: string | null;
        sourceQuote: string | null;
      }
    >;
    competencies: ModelCompetency[];
    likelyChallenges: string[];
    occupationalFamily: string;
  };
  evidenceBank: ModelEvidenceBankItem[];
  employerQuestions: ModelEmployerQuestion[];
  logistics: ModelLogisticsItem[];
  cheatSheet: ModelCheatSheet & {
    companyName: string;
    roleTitle: string;
    interviewAt: string | null;
    generatedNote: string;
  };
};

// ─── Progress and readiness ────────────────────────────────────────────────

export type PrepTask = {
  id: string;
  taskKey: string;
  title: string;
  description: string;
  whyItMatters: string;
  expectedOutput: string;
  priority: Priority;
  category: TaskCategory;
  estimatedMinutes: number;
  horizon: PrepHorizon;
  status: TaskStatus;
  sortOrder: number;
  completedAt: Date | null;
};

export type ResearchSourceView = {
  id: string;
  position: number;
  kind: ResearchSourceKind;
  url: string | null;
  canonicalUrl: string | null;
  title: string;
  publisher: string | null;
  publishedAt: Date | null;
  retrievedAt: Date | null;
  excerpt: string | null;
  summary: string | null;
  fetchStatus: ResearchFetchStatus;
  verification: ResearchVerification;
  errorCode: string | null;
};

export type ReadinessSummary = {
  /** How much of the recommended, currently-scheduled preparation is complete. */
  preparationCoverage: {
    completedTasks: number;
    totalTasks: number;
    percent: number | null;
    label: string;
  };
  practiceEvidence: {
    questionsAttempted: number;
    questionCount: number;
    feedbackCount: number;
    mockSessionsCompleted: number;
    label: string;
  };
  researchCompleteness: {
    status: ResearchStatus;
    sourcesAvailable: number;
    label: string;
  };
  unresolvedGaps: Array<{ gap: string; action: string; evidenceStatus: EvidenceStatus }>;
  outstandingHighPriority: PrepTask[];
  level: 'STARTING' | 'BUILDING' | 'PRACTISING' | 'WELL_PREPARED';
  levelLabel: string;
  limitations: string[];
};

export type PracticeSessionView = {
  id: string;
  packId: string;
  mode: PracticeMode;
  status: 'ACTIVE' | 'COMPLETED';
  questionIds: string[];
  summary: PracticeSessionSummary | null;
  startedAt: Date;
  completedAt: Date | null;
  updatedAt: Date;
};

export type PracticeSessionSummary = {
  questionsAttempted: number;
  questionsWithFeedback: number;
  /** Average of the latest scored attempt per question, or null when unscored. */
  averageScore: number | null;
  /** How many questions in this session have a scored evaluation. */
  scoredAttempts: number;
  strengths: string[];
  priorities: string[];
  dimensions: Array<{ dimension: RubricDimension; rating: Rating; count: number }>;
  note: string;
};

export type PracticeAttemptView = {
  id: string;
  packId: string;
  questionId: string;
  sessionId: string | null;
  kind: 'INITIAL' | 'REVISION' | 'FOLLOW_UP';
  parentAttemptId: string | null;
  followUpQuestion: string | null;
  questionVersion: number;
  attemptNumber: number;
  answer: string;
  feedback: StoredFeedback | null;
  rubricKey: string | null;
  createdAt: Date;
};

export type StoredFeedback = {
  /** Null on feedback generated before scoring was introduced. */
  score: number | null;
  scoreRationale: string | null;
  modelAnswer: string | null;
  dimensions: Array<{
    dimension: RubricDimension;
    rating: Rating;
    note: string;
    evidenceQuote: string | null;
  }>;
  whatWorked: string;
  needsImprovement: string;
  missing: string;
  structureSuggestion: string;
  revisedStructure: string | null;
  followUpPractice: string[];
  adaptiveFollowUp: ModelAdaptiveFollowUp | null;
  limitations: string | null;
};
