/**
 * Client-side shapes for the interview preparation API.
 *
 * Dates cross the wire as ISO strings. These types are intentionally local to
 * the browser bundle: the server types in `@/lib/interview-prep` carry Prisma
 * and provider details that must not be imported into client components.
 */

import type {
  AnswerStructure,
  CompanyClaimBasis,
  Difficulty,
  EvidenceStatus,
  InterviewContext,
  InterviewTrack,
  PracticeMode,
  PracticeSessionSummary,
  PrepHorizon,
  Priority,
  QuestionCategory,
  Rating,
  ResearchFetchStatus,
  ResearchSourceKind,
  ResearchStatus,
  ResearchVerification,
  RubricDimension,
  TaskCategory,
  TaskStatus,
} from '@/lib/interview-prep/schema';

export type {
  AnswerStructure,
  CompanyClaimBasis,
  Difficulty,
  EvidenceStatus,
  InterviewContext,
  InterviewTrack,
  PracticeMode,
  PracticeSessionSummary,
  PrepHorizon,
  Priority,
  QuestionCategory,
  Rating,
  ResearchFetchStatus,
  ResearchSourceKind,
  ResearchStatus,
  ResearchVerification,
  RubricDimension,
  TaskCategory,
  TaskStatus,
};

export type PackSummary = {
  id: string;
  jobId: string | null;
  title: string;
  company: string;
  roleTitle: string;
  location: string | null;
  jobUrl: string | null;
  context: string;
  interviewAt: string | null;
  interviewFormat: string;
  timing: string;
  status: string;
  researchStatus: string;
  questionCount: number;
  practicedCount: number;
  feedbackCount: number;
  lastPracticedAt: string | null;
  lastActivityAt: string;
  generatedAt: string | null;
  isFresh: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CompanyClaim = {
  claim: string;
  basis: CompanyClaimBasis;
  sourceIndexes: number[];
  whyItMatters: string | null;
};

export type EvidenceBankItem = {
  theme: string;
  title: string;
  evidenceQuote: string | null;
  evidenceNote: string;
  sourceLabel: string;
  whatItSupports: string;
  missingDetails: string[];
  competencies: string[];
  verification: 'CONFIRMED_PROFILE' | 'UNCONFIRMED_PROFILE' | 'NEEDS_USER_INPUT';
};

export type PrepContent = {
  briefing: {
    summary: string;
    topPriorities: Array<{
      title: string;
      why: string;
      basis: string;
      priority: Priority;
    }>;
    strongestEvidence: Array<{
      theme: string;
      evidenceQuote: string | null;
      explanation: string;
      verification: 'CONFIRMED_PROFILE' | 'UNCONFIRMED_PROFILE' | 'NEEDS_USER_INPUT';
    }>;
    gaps: Array<{ gap: string; preparationAction: string; evidenceStatus: EvidenceStatus }>;
    keyCompanyFacts: Array<{ fact: string; sourceIndexes: number[] }>;
    nextAction: string;
  };
  company: {
    overview: CompanyClaim | null;
    products: CompanyClaim[];
    customers: CompanyClaim | null;
    mission: CompanyClaim | null;
    values: CompanyClaim[];
    cultureNotes: CompanyClaim[];
    recentDevelopments: Array<{
      title: string;
      date: string | null;
      summary: string;
      basis: CompanyClaimBasis;
      sourceIndexes: number[];
      whyItMatters: string | null;
    }>;
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
    requirements: Array<{
      requirement: string;
      importance: 'CRITICAL' | 'IMPORTANT' | 'VALUABLE';
      requirementType: 'EXPLICIT' | 'INFERRED';
      evidenceStatus: EvidenceStatus;
      evidenceQuote: string | null;
      evidenceExplanation: string | null;
      evidenceSource: 'PROFILE' | 'RESUME' | 'USER_INPUT' | 'NONE';
      gap: string | null;
      preparationAction: string;
      confidence: 'HIGH' | 'MEDIUM' | 'LOW';
      sourceQuote: string | null;
    }>;
    competencies: Array<{
      name: string;
      why: string;
      requirement: string | null;
      evidenceQuote: string | null;
      evidenceExplanation: string | null;
      sampleQuestion: string;
      strongAnswerShows: string;
      practiceAdvice: string;
      evidenceBasis: string;
    }>;
    likelyChallenges: string[];
    occupationalFamily: string;
  };
  evidenceBank: EvidenceBankItem[];
  employerQuestions: Array<{
    question: string;
    why: string;
    category: 'ROLE' | 'COMPANY' | 'TEAM' | 'PROCESS' | 'GROWTH';
    priority: Priority;
    sourceIndexes: number[];
  }>;
  logistics: Array<{
    topic: string;
    guidance: string;
    basis: 'USER_SUPPLIED' | 'FORMAT_GENERAL' | 'JOB_REQUIREMENT';
  }>;
  cheatSheet: {
    companyName: string;
    roleTitle: string;
    interviewAt: string | null;
    generatedNote: string;
    companyFacts: string[];
    topCompetencies: string[];
    strongestExamples: string[];
    questionsToAsk: string[];
    logistics: string[];
    reminders: string[];
    unknowns: string[];
  };
};

export type Question = {
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
  sourceType: string;
  sourceEvidence: string | null;
  priority: Priority;
  evidenceBasis: string;
  strongAnswerShows: string | null;
  commonPitfalls: string[];
  coaching: {
    whatInterviewerAssesses: string;
    keyPoints: string[];
    practiceExercise: string;
    sampleWordingPlaceholder: string | null;
  } | null;
  sourceRefs: string[];
  isPrediction: boolean;
  isActive: boolean;
};

export type PackData = {
  id: string;
  jobId: string | null;
  title: string;
  company: string;
  roleTitle: string;
  location: string | null;
  jobUrl: string | null;
  context: InterviewContext;
  interviewAt: string | null;
  interviewFormat: InterviewContext;
  timing: PrepHorizon;
  interviewLanguage: string | null;
  interviewerInfo: string | null;
  concerns: string | null;
  focusTopics: string[];
  companyWebsiteUrl: string | null;
  careersUrl: string | null;
  status: string;
  researchStatus: ResearchStatus;
  schemaVersion: number;
  promptVersion: number;
  inputFingerprint: string;
  content: PrepContent | null;
  questions: Question[];
  preparationGuidance: string | null;
  limitations: string[];
};

export type ResearchSource = {
  id: string;
  position: number;
  kind: ResearchSourceKind;
  url: string | null;
  canonicalUrl: string | null;
  title: string;
  publisher: string | null;
  publishedAt: string | null;
  retrievedAt: string | null;
  excerpt: string | null;
  summary: string | null;
  fetchStatus: ResearchFetchStatus;
  verification: ResearchVerification;
  errorCode: string | null;
};

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
  completedAt: string | null;
};

export type ReadinessSummary = {
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

export type Attempt = {
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
  createdAt: string;
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
  adaptiveFollowUp: {
    question: string;
    why: string;
    whatToInclude: string[];
  } | null;
  limitations: string | null;
};

export type PracticeSession = {
  id: string;
  packId: string;
  mode: PracticeMode;
  status: 'ACTIVE' | 'COMPLETED';
  questionIds: string[];
  summary: PracticeSessionSummary | null;
  startedAt: string;
  completedAt: string | null;
  updatedAt: string;
};

export type PackDetail = {
  available: true;
  pack: PackSummary;
  data: PackData;
  sources: ResearchSource[];
  tasks: PrepTask[];
  sessions: PracticeSession[];
  readiness: ReadinessSummary;
  practicedQuestionIds: string[];
  feedbackQuestionIds: string[];
};

export type PackListItem = PackSummary;

export type ApiErrorEnvelope = {
  error?: { code?: string; message?: string; codeDetail?: string };
};
