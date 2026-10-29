/**
 * Deterministic planning for interview preparation.
 *
 * The AI proposes content; this module decides how it is scheduled, how
 * progress is counted and what "readiness" may honestly mean. Nothing here
 * predicts an interview outcome. Every number is derived from persisted
 * work the candidate actually completed.
 */

import type {
  EvidenceStatus,
  ModelTask,
  PrepContent,
  PrepHorizon,
  PrepTask,
  Priority,
  PracticeMode,
  PracticeSessionSummary,
  QuestionCategory,
  ReadinessSummary,
  ResearchStatus,
  RubricDimension,
  Rating,
} from './schema';

export const HORIZON_LABELS: Record<PrepHorizon, string> = {
  WITHIN_24_HOURS: 'Within 24 hours',
  TWO_THREE_DAYS: 'In 2–3 days',
  WITHIN_A_WEEK: 'Within a week',
  MORE_THAN_A_WEEK: 'More than a week away',
  UNKNOWN: 'Date not specified',
};

const HORIZON_ORDER: PrepHorizon[] = [
  'WITHIN_24_HOURS',
  'TWO_THREE_DAYS',
  'WITHIN_A_WEEK',
  'MORE_THAN_A_WEEK',
  'UNKNOWN',
];

export function horizonRank(horizon: PrepHorizon): number {
  const index = HORIZON_ORDER.indexOf(horizon);
  return index === -1 ? HORIZON_ORDER.length : index;
}

/** Convert an exact interview date into a coarse, user-facing horizon. */
export function horizonForDate(interviewAt: Date | null | undefined, now = new Date()): PrepHorizon {
  if (!interviewAt) return 'UNKNOWN';
  const ms = interviewAt.getTime() - now.getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'UNKNOWN';
  const hours = ms / 3_600_000;
  if (hours <= 24) return 'WITHIN_24_HOURS';
  if (hours <= 72) return 'TWO_THREE_DAYS';
  if (hours <= 24 * 7) return 'WITHIN_A_WEEK';
  return 'MORE_THAN_A_WEEK';
}

/**
 * Resolve the planning horizon from an exact date first, then the supplied
 * approximation. A date in the past is treated as unknown rather than as an
 * emergency; the UI separately shows that it is overdue.
 */
export function resolveHorizon(params: {
  interviewAt: Date | null;
  timing: PrepHorizon;
  now?: Date;
}): PrepHorizon {
  if (params.interviewAt) return horizonForDate(params.interviewAt, params.now ?? new Date());
  return params.timing;
}

export function horizonIsImminent(horizon: PrepHorizon): boolean {
  return horizon === 'WITHIN_24_HOURS' || horizon === 'TWO_THREE_DAYS';
}

/**
 * Deterministic fallback plan.
 *
 * Used when the provider returns too few usable tasks, or when a pack is
 * generated without company research. Keys are stable across regeneration so
 * completed work survives.
 */
export function fallbackTasks(params: {
  horizon: PrepHorizon;
  roleTitle: string;
  company: string;
  researchAvailable: boolean;
  hasCandidateEvidence: boolean;
  hadInterviewerInfo: boolean;
  concerns: string | null;
}): ModelTask[] {
  const { horizon, roleTitle, company, researchAvailable, hasCandidateEvidence, hadInterviewerInfo, concerns } = params;
  const tasks: ModelTask[] = [];

  if (horizonIsImminent(horizon)) {
    tasks.push({
      taskKey: 'immediate-priorities',
      title: 'Confirm the interview logistics',
      description: `Re-read the invitation for ${roleTitle} at ${company}: time zone, joining link or address, who you are meeting, and what to bring.`,
      whyItMatters: 'Logistics are the one part of an interview you can completely control.',
      expectedOutput: 'A short note with the time, format, contact and joining details.',
      priority: 'HIGH',
      category: 'LOGISTICS',
      estimatedMinutes: 10,
      horizon: 'WITHIN_24_HOURS',
    });
  }

  tasks.push({
    taskKey: 'practice-priority-questions',
    title: 'Practise your highest-priority questions out loud',
    description: 'Answer each high-priority question without notes, then compare your answer with the coaching notes. Revise once.',
    whyItMatters: 'Speaking an answer reveals gaps that reading it never does.',
    expectedOutput: 'One written or recorded revision for each high-priority question.',
    priority: 'HIGH',
    category: 'PRACTICE',
    estimatedMinutes: 30,
    horizon: horizonIsImminent(horizon) ? 'WITHIN_24_HOURS' : 'TWO_THREE_DAYS',
  });

  tasks.push({
    taskKey: 'prepare-star-examples',
    title: 'Prepare three concrete examples',
    description: 'Choose three real situations from your own experience that can support different competencies. Write the situation, your action and the verified result.',
    whyItMatters: 'Concrete evidence is more convincing than adjectives, and reused stories can be adapted honestly.',
    expectedOutput: 'Three STAR outlines based only on work you actually did.',
    priority: 'HIGH',
    category: 'WRITING',
    estimatedMinutes: 25,
    horizon: horizonIsImminent(horizon) ? 'WITHIN_24_HOURS' : 'TWO_THREE_DAYS',
  });

  tasks.push({
    taskKey: 'research-employer',
    title: researchAvailable ? 'Read the supplied company sources' : 'Add one official company source',
    description: researchAvailable
      ? 'Read the company pages already saved with this pack and write down two facts you could discuss accurately.'
      : 'Open the company website or careers page, add the URL to this pack and regenerate the company section. Without a source we cannot verify company facts.',
    whyItMatters: 'Specific, sourced company context makes a “why this company” answer credible without inventing anything.',
    expectedOutput: researchAvailable ? 'Two sourced company facts and one question to ask.' : 'At least one official URL saved to the pack.',
    priority: researchAvailable ? 'MEDIUM' : 'HIGH',
    category: 'RESEARCH',
    estimatedMinutes: 20,
    horizon: horizonIsImminent(horizon) ? 'WITHIN_24_HOURS' : 'WITHIN_A_WEEK',
  });

  if (!hasCandidateEvidence) {
    tasks.push({
      taskKey: 'add-candidate-evidence',
      title: 'Add a work example to your career profile',
      description: 'Add at least one project or role with the action you took and a real result. The pack can then ground questions and feedback in your own evidence.',
      whyItMatters: 'Without candidate evidence, examples stay generic and you have to supply the substance yourself.',
      expectedOutput: 'One project or experience entry with a concrete contribution and result.',
      priority: 'HIGH',
      category: 'WRITING',
      estimatedMinutes: 20,
      horizon: horizonIsImminent(horizon) ? 'WITHIN_24_HOURS' : 'TWO_THREE_DAYS',
    });
  }

  if (hadInterviewerInfo) {
    tasks.push({
      taskKey: 'review-interviewer-context',
      title: 'Review the interviewer details you supplied',
      description: 'Check the names, roles and any topics you noted. Decide which questions are appropriate for each person.',
      whyItMatters: 'Using the details you supplied avoids generic questions and respects what you actually know.',
      expectedOutput: 'One tailored question per interviewer.',
      priority: 'MEDIUM',
      category: 'REVIEW',
      estimatedMinutes: 10,
      horizon: horizonIsImminent(horizon) ? 'WITHIN_24_HOURS' : 'TWO_THREE_DAYS',
    });
  }

  if (concerns) {
    tasks.push({
      taskKey: 'address-stated-concern',
      title: 'Prepare for the concern you raised',
      description: `You noted: “${concerns.slice(0, 220)}”. Write a short, honest answer and one piece of evidence that addresses it.`,
      whyItMatters: 'Naming a concern early turns it from a surprise into a prepared talking point.',
      expectedOutput: 'A two-minute answer and one supporting example.',
      priority: 'HIGH',
      category: 'PRACTICE',
      estimatedMinutes: 20,
      horizon: horizonIsImminent(horizon) ? 'WITHIN_24_HOURS' : 'TWO_THREE_DAYS',
    });
  }

  if (horizon === 'MORE_THAN_A_WEEK' || horizon === 'WITHIN_A_WEEK') {
    tasks.push({
      taskKey: 'mock-interview',
      title: 'Complete one mock interview',
      description: 'Run a timed mock session in this workspace, answer every question and request feedback. Review the weakest rubric dimension afterwards.',
      whyItMatters: 'A full run exposes pacing and structure problems that isolated practice hides.',
      expectedOutput: 'One completed mock session with feedback.',
      priority: 'MEDIUM',
      category: 'PRACTICE',
      estimatedMinutes: 45,
      horizon: 'WITHIN_A_WEEK',
    });
  }

  tasks.push({
    taskKey: 'prepare-questions-to-ask',
    title: 'Choose your questions for the employer',
    description: 'Pick three questions from the employer question bank that you genuinely want answered. Rewrite them in your own words.',
    whyItMatters: 'A considered question demonstrates real interest and helps you evaluate the role.',
    expectedOutput: 'Three final questions, ordered by priority.',
    priority: 'MEDIUM',
    category: 'REVIEW',
    estimatedMinutes: 15,
    horizon: horizonIsImminent(horizon) ? 'WITHIN_24_HOURS' : 'TWO_THREE_DAYS',
  });

  return tasks.slice(0, 8);
}

export function sortTasks(tasks: ModelTask[]): ModelTask[] {
  return [...tasks].sort((a, b) => {
    const horizonDiff = horizonRank(a.horizon) - horizonRank(b.horizon);
    if (horizonDiff !== 0) return horizonDiff;
    const priority: Record<Priority, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    return priority[a.priority] - priority[b.priority];
  });
}

// ─── Progress and readiness ────────────────────────────────────────────────

export type ReadinessInput = {
  content: PrepContent | null;
  questions: Array<{ id: string; category: string; priority: string }>;
  tasks: PrepTask[];
  attempts: Array<{ questionId: string; feedback: unknown | null }>;
  sessions: Array<{ status: string }>;
  researchStatus: ResearchStatus;
  sourcesAvailable: number;
};

function percent(completed: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((completed / total) * 100);
}

function practiceLabel(attempted: number, total: number, feedbackCount: number): string {
  if (total === 0) return 'No question bank yet';
  if (attempted === 0) return 'Practice not started';
  if (attempted < total) return `${attempted} of ${total} questions practised`;
  if (feedbackCount === 0) return 'All questions attempted — request feedback to go deeper';
  return 'Every question attempted with feedback';
}

/**
 * Honest readiness summary.
 *
 * "WELL_PREPARED" means the candidate has worked through most of their own
 * plan and practised broadly. It is not a prediction of the hiring decision,
 * and the limitations say so.
 */
export function calculateReadiness(input: ReadinessInput): ReadinessSummary {
  const activeTasks = input.tasks.filter((task) => task.status !== 'DEFERRED');
  const completedTasks = activeTasks.filter((task) => task.status === 'COMPLETED').length;
  const coveragePercent = percent(completedTasks, activeTasks.length);

  const attemptedQuestions = new Set(
    input.attempts.filter((attempt) => Boolean(attempt.questionId)).map((attempt) => attempt.questionId),
  );
  const feedbackCount = input.attempts.filter((attempt) => attempt.feedback !== null && attempt.feedback !== undefined).length;
  const mockSessionsCompleted = input.sessions.filter((session) => session.status === 'COMPLETED').length;
  const questionCount = input.questions.length;
  const attemptedCount = attemptedQuestions.size;

  const gaps =
    input.content?.briefing.gaps
      .filter((gap) => gap.evidenceStatus === 'NO_EVIDENCE_FOUND' || gap.evidenceStatus === 'UNCLEAR')
      .map((gap) => ({
        gap: gap.gap,
        action: gap.preparationAction,
        evidenceStatus: gap.evidenceStatus,
      })) ?? [];

  const outstandingHighPriority = input.tasks.filter(
    (task) => task.priority === 'HIGH' && task.status === 'PENDING',
  );

  const practiceRatio = questionCount > 0 ? attemptedCount / questionCount : 0;
  const coverageRatio = coveragePercent === null ? 0 : coveragePercent / 100;
  const highPriorityDone = !outstandingHighPriority.length;

  let level: ReadinessSummary['level'] = 'STARTING';
  if (attemptedCount > 0 || completedTasks > 0 || feedbackCount > 0) level = 'BUILDING';
  if (practiceRatio >= 0.5 && (coveragePercent ?? 0) >= 40) level = 'PRACTISING';
  if (
    practiceRatio >= 0.8 &&
    coverageRatio >= 0.7 &&
    highPriorityDone &&
    (mockSessionsCompleted > 0 || gaps.length === 0)
  ) {
    level = 'WELL_PREPARED';
  }

  const levelLabels: Record<ReadinessSummary['level'], string> = {
    STARTING: 'Getting started',
    BUILDING: 'Building your case',
    PRACTISING: 'Practising under pressure',
    WELL_PREPARED: 'Well prepared',
  };

  const limitations: string[] = [
    'Readiness reflects the preparation and practice saved in this pack. It does not predict the employer’s decision.',
  ];
  if (questionCount < 6) limitations.push('The question bank is small, so practice coverage is a weak signal.');
  if (input.researchStatus !== 'COMPLETED') {
    limitations.push('Company research is incomplete, so company-specific questions may be thinner.');
  }
  if (feedbackCount === 0) limitations.push('No answer has been evaluated yet, so practice quality is not evidenced.');
  if (!input.questions.some((question) => question.priority === 'HIGH')) {
    limitations.push('No high-priority questions were identified, which is unusual for a detailed posting.');
  }

  return {
    preparationCoverage: {
      completedTasks,
      totalTasks: activeTasks.length,
      percent: coveragePercent,
      label:
        activeTasks.length === 0
          ? 'No preparation tasks yet'
          : `${completedTasks} of ${activeTasks.length} tasks complete`,
    },
    practiceEvidence: {
      questionsAttempted: attemptedCount,
      questionCount,
      feedbackCount,
      mockSessionsCompleted,
      label: practiceLabel(attemptedCount, questionCount, feedbackCount),
    },
    researchCompleteness: {
      status: input.researchStatus,
      sourcesAvailable: input.sourcesAvailable,
      label:
        input.researchStatus === 'COMPLETED'
          ? `${input.sourcesAvailable} sources saved`
          : input.researchStatus === 'PARTIAL'
            ? 'Some sources could not be read'
            : input.researchStatus === 'NOT_AVAILABLE'
              ? 'No official company sources supplied'
              : input.researchStatus === 'FAILED'
                ? 'Supplied sources could not be read'
                : 'Research not started',
    },
    unresolvedGaps: gaps,
    outstandingHighPriority,
    level,
    levelLabel: levelLabels[level],
    limitations,
  };
}

// ─── Practice modes ────────────────────────────────────────────────────────

export const PRACTICE_MODE_DESCRIPTIONS: Record<PracticeMode, string> = {
  FULL: 'A mixed run across the pack, high-priority questions first.',
  BEHAVIORAL: 'Behavioural and collaboration questions that ask for real examples.',
  ROLE_SPECIFIC: 'Technical, scenario and project-decision questions for this role.',
  COMPANY_MOTIVATION: 'Motivation and company-understanding questions.',
  WEAK_AREA: 'Questions you have not tried, or where feedback found the most gaps.',
  QUICK: 'Three high-priority questions when time is short.',
};

const BEHAVIORAL_CATEGORIES: QuestionCategory[] = [
  'BEHAVIORAL',
  'COLLABORATION',
  'OWNERSHIP',
  'HANDLING_AMBIGUITY',
];

const ROLE_CATEGORIES: QuestionCategory[] = [
  'TECHNICAL_FUNDAMENTALS',
  'APPLIED_PROBLEM_SOLVING',
  'ARCHITECTURE_TRADE_OFFS',
  'DEBUGGING',
  'PROJECT_DECISIONS',
  'ROLE_SCENARIO',
];

type PracticeQuestion = {
  id: string;
  category: string;
  priority: string;
  ordinal: number;
};

/** Select a bounded, deterministic question set for a practice mode. */
export function selectPracticeQuestionIds(params: {
  mode: PracticeMode;
  questions: PracticeQuestion[];
  attemptedQuestionIds?: Set<string>;
}): string[] {
  const priorityRank: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  const byPriority = [...params.questions].sort((a, b) => {
    const diff = (priorityRank[a.priority] ?? 1) - (priorityRank[b.priority] ?? 1);
    return diff !== 0 ? diff : a.ordinal - b.ordinal;
  });

  let selected = byPriority;
  switch (params.mode) {
    case 'BEHAVIORAL':
      selected = byPriority.filter((question) => BEHAVIORAL_CATEGORIES.includes(question.category as QuestionCategory));
      break;
    case 'ROLE_SPECIFIC':
      selected = byPriority.filter((question) => ROLE_CATEGORIES.includes(question.category as QuestionCategory));
      break;
    case 'COMPANY_MOTIVATION':
      selected = byPriority.filter((question) => question.category === 'MOTIVATION');
      break;
    case 'WEAK_AREA':
      selected = byPriority.filter((question) => !params.attemptedQuestionIds?.has(question.id));
      if (selected.length === 0) selected = byPriority;
      break;
    case 'QUICK':
      return byPriority.slice(0, 3).map((question) => question.id);
    case 'FULL':
    default:
      break;
  }

  if (selected.length === 0) selected = byPriority;
  const cap = params.mode === 'FULL' ? 10 : 6;
  return selected.slice(0, cap).map((question) => question.id);
}

/** Summarise a completed session from persisted attempt feedback. */
export function summariseSession(params: {
  attempts: Array<{ questionId: string; feedback: unknown | null }>;
  questionCount: number;
}): PracticeSessionSummary {
  const strengths: string[] = [];
  const priorities: string[] = [];
  const dimensionCounts = new Map<RubricDimension, Map<Rating, number>>();
  const seenQuestions = new Set<string>();
  let withFeedback = 0;

  for (const attempt of params.attempts) {
    seenQuestions.add(attempt.questionId);
    const feedback = attempt.feedback as
      | {
          dimensions?: Array<{ dimension?: string; rating?: string }>;
          whatWorked?: string;
          needsImprovement?: string;
        }
      | null;
    if (!feedback) continue;
    withFeedback += 1;
    if (feedback.whatWorked && strengths.length < 3 && !strengths.includes(feedback.whatWorked)) {
      strengths.push(feedback.whatWorked);
    }
    if (feedback.needsImprovement && priorities.length < 3 && !priorities.includes(feedback.needsImprovement)) {
      priorities.push(feedback.needsImprovement);
    }
    for (const dimension of feedback.dimensions ?? []) {
      if (!dimension.dimension || !dimension.rating) continue;
      const key = dimension.dimension as RubricDimension;
      const inner = dimensionCounts.get(key) ?? new Map<Rating, number>();
      const rating = dimension.rating as Rating;
      inner.set(rating, (inner.get(rating) ?? 0) + 1);
      dimensionCounts.set(key, inner);
    }
  }

  const dimensions = [...dimensionCounts.entries()].map(([dimension, ratings]) => {
    const ranked: Rating[] = ['EVIDENT', 'PARTIAL', 'NOT_EVIDENT', 'INSUFFICIENT_EVIDENCE'];
    const rating = ranked.find((value) => (ratings.get(value) ?? 0) > 0) ?? 'INSUFFICIENT_EVIDENCE';
    return { dimension, rating, count: [...ratings.values()].reduce((sum, count) => sum + count, 0) };
  });

  return {
    questionsAttempted: seenQuestions.size,
    questionsWithFeedback: withFeedback,
    strengths,
    priorities,
    dimensions,
    note:
      withFeedback === 0
        ? 'No attempt in this session has feedback yet. Request feedback on an answer to make the summary meaningful.'
        : 'This summary reflects only the answers saved in this session. It is coaching input, not an interview prediction.',
  };
}
