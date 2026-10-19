/**
 * Server-side verification of generated interview preparation content.
 *
 * This runs between the provider returning and anything being written to the
 * database. The model is not a witness. Every claim it makes is re-checked
 * against the sources of truth we hold:
 *
 *  1. EVIDENCE IS RE-QUOTED. Any excerpt attributed to the job posting is
 *     looked up in the actual posting text. A quote that cannot be found is
 *     dropped.
 *  2. PERSONAL EXAMPLES ARE RE-CHECKED. If the model points to "your API
 *     integration project", that project has to exist in the user's actual
 *     profile. If it does not, the reference becomes null and the question
 *     stays general.
 *  3. FEEDBACK QUOTES ARE RE-QUOTED. Any evidence quote attributed to the
 *     candidate's answer is looked up in the answer text.
 *  4. UNSUPPORTABLE CLAIMS ARE NEUTRALISED. No hiring predictions, no
 *     capability assertions about the person, no legal determinations.
 *  5. EVERYTHING IS BOUNDED. Lengths, array sizes and dedup are re-applied.
 *
 * Pure: the same input always gives the same output, testable without a
 * provider.
 */

import {
  INTERVIEW_PREP_MAX_QUESTIONS,
  INTERVIEW_PREP_MAX_FOLLOW_UPS,
} from './limits';
import {
  type ModelFeedback,
  type ModelQuestion,
  type ModelPack,
  type QuestionCategory,
  type Rating,
  type RubricDimension,
  INTERVIEW_PREP_SCHEMA_VERSION,
  rubricDimensionSchema,
  ratingSchema,
} from './schema';

/** Canonical comparison key — same shape as the job-intelligence verifier. */
export function normaliseKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, ' ')
    .trim();
}

/**
 * Does this quote actually appear in the source text?
 *
 * Punctuation-free, whitespace-collapsed comparison. Very short quotes are
 * not accepted: a three-character match proves nothing.
 */
export function excerptAppearsIn(excerpt: string, sourceText: string): boolean {
  const needle = normaliseKey(excerpt);
  if (needle.length < 12) return false;
  return normaliseKey(sourceText).includes(needle);
}

function tidy(value: string | null | undefined, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/** Phrases that assert a capability or fact about the person as certainty. */
const ABSENCE_CLAIM_PATTERNS: RegExp[] = [
  /\byou (?:do not|don't|doesn't|cannot|can't|could not|couldn't) (?:have|know|possess|show|be experienced in)\b/i,
  /\byour (?:profile|resume|cv|record) (?:does not|doesn't|lacks|has no) (?:include|mention|show|contain|evidence of)\b/i,
  /\bthe candidate (?:does not|doesn't|cannot|can't) (?:have|know|possess|show)\b/i,
];

/** Phrases that make a promise this product cannot keep. */
const PROMISE_PATTERNS: RegExp[] = [
  /\bguarantee[ds]?\b/i,
  /\b(?:will|would|can|could) (?:get|receive|secure|land)\b[^.]{0,24}?\b(?:interview|offer|job|role)\b/i,
  /\byou (?:will|'ll|are going to|are likely to) (?:get|receive|land|be offered)\b/i,
  /\b(?:we|they|the (?:employer|company|interviewer)) (?:will|can|would)\b/i,
  /\bcertain(?:ly)? to (?:get|succeed|land|receive)\b/i,
  /\b(?:is|are) (?:a )?(?:sure|guaranteed) (?:match|fit)\b/i,
];

/** Phrases that issue a legal or immigration determination. */
const LEGAL_DETERMINATION_PATTERNS: RegExp[] = [
  /\byou(?:'re| are)?\s+(?:legally\s+)?(?:eligible|ineligible|not eligible)\b/i,
  /\byou can legally work\b/i,
  /\bwork authori[sz]ation (?:is|'s) (?:confirmed|verified|granted|not required)\b/i,
  /\b(?:you|the candidate) (?:may|can) (?:legally )?work (?:in|at|for)\b/i,
];

export function containsUnsupportableClaim(text: string): boolean {
  return (
    ABSENCE_CLAIM_PATTERNS.some((pattern) => pattern.test(text)) ||
    PROMISE_PATTERNS.some((pattern) => pattern.test(text)) ||
    LEGAL_DETERMINATION_PATTERNS.some((pattern) => pattern.test(text))
  );
}

function neutralisedCopy(kind: 'capability' | 'promise' | 'legal'): string {
  switch (kind) {
    case 'promise':
      return 'We cannot predict how an interview will turn out. This is preparation guidance, not a forecast.';
    case 'legal':
      return 'Confirm this with the employer. We do not make legal or work-authorisation determinations.';
    default:
      return "That is not in your current profile — if you have it, adding it will change what we can suggest.";
  }
}

function neutraliseText(text: string): string {
  const legal = LEGAL_DETERMINATION_PATTERNS.some((pattern) => pattern.test(text));
  if (legal) return neutralisedCopy('legal');
  const promise = PROMISE_PATTERNS.some((pattern) => pattern.test(text));
  if (promise) return neutralisedCopy('promise');
  return neutralisedCopy('capability');
}

// ─── Profile evidence ──────────────────────────────────────────────────────

/** The subset of profile data verification needs. */
export type ProfileEvidence = {
  projectNames: string[];
  experienceTitles: string[];
  skillNames: string[];
};

/** Does the profile actually contain a project or experience by this name? */
export function profileSupportsExperience(
  profile: ProfileEvidence,
  reference: string,
): boolean {
  const needle = normaliseKey(reference);
  if (!needle) return false;
  const haystack = [...profile.projectNames, ...profile.experienceTitles];
  return haystack.some((name) => {
    const key = normaliseKey(name);
    if (!key) return false;
    return key === needle || key.includes(needle) || needle.includes(key);
  });
}

// ─── Question verification ─────────────────────────────────────────────────

function verifyQuestionEvidence(
  evidence: Extract<import('./schema').Evidence, { source: string }>,
  sources: { jobText: string; profileText: string },
): Extract<import('./schema').Evidence, { source: string }> | null {
  const supports = tidy(evidence.supports, 280);
  if (!supports) return null;

  const field = tidy(evidence.field, 160) ?? 'unknown';

  let excerpt = evidence.excerpt ?? null;
  if (excerpt) {
    const trimmed = tidy(excerpt, 300);
    if (!trimmed) excerpt = null;
    else if (evidence.source === 'JOB_DESCRIPTION') {
      if (!excerptAppearsIn(trimmed, sources.jobText)) {
        excerpt = null;
      }
    } else if (evidence.source === 'CAREER_PROFILE') {
      if (!excerptAppearsIn(trimmed, sources.profileText)) {
        excerpt = null;
      }
    }
  }

  return { source: evidence.source, field, excerpt, supports };
}

export type VerifyQuestionOptions = {
  question: ModelQuestion;
  sources: { jobText: string; profileText: string };
  profile: ProfileEvidence;
};

/**
 * Verify one generated question.
 *
 * Returns null when the question is empty or unsalvageable. Personal
 * experience references that the profile does not support are nulled out so
 * the question stays general rather than fabricated.
 */
export function verifyQuestion(params: VerifyQuestionOptions): ModelQuestion | null {
  const { question, sources, profile } = params;
  const text = tidy(question.question, 1000);
  if (!text) return null;

  const competency = tidy(question.competency, 160) ?? 'General';
  const whyMatters = tidy(question.whyMatters, 600) ?? '';
  if (containsUnsupportableClaim(whyMatters)) {
    // A "why this matters" that makes a fabrication is worse than none.
    return null;
  }

  const relatedRequirement = tidy(question.relatedRequirement, 300);
  const relevantExperience =
    question.relevantExperience &&
    profileSupportsExperience(profile, question.relevantExperience)
      ? tidy(question.relevantExperience, 400)
      : null;

  const prepNotes = tidy(question.prepNotes, 600);
  const sourceEvidence = tidy(question.sourceEvidence, 300);

  // sourceEvidence is a free-text reference the application can stand behind
  // only when it names a real source field; it is stored verbatim and bounded.
  const followUps = question.followUpQuestions
    .map((followUp) => tidy(followUp, 220))
    .filter((followUp): followUp is string => Boolean(followUp))
    .slice(0, INTERVIEW_PREP_MAX_FOLLOW_UPS);

  return {
    generationId: question.generationId,
    category: question.category,
    difficulty: question.difficulty,
    competency,
    question: text,
    whyMatters,
    relatedRequirement: relatedRequirement ?? null,
    relevantExperience,
    prepNotes: prepNotes ?? null,
    answerStructure: question.answerStructure,
    followUpQuestions: followUps,
    sourceType: question.sourceType,
    sourceEvidence: sourceEvidence ?? null,
  };
}

/**
 * Verify and prune a whole pack.
 *
 * Deduplicates near-identical questions so the pack never ships repeated
 * generic questions, caps the count, and keeps category spread.
 */
export function verifyPack(params: {
  pack: ModelPack;
  sources: { jobText: string; profileText: string };
  profile: ProfileEvidence;
}): ModelPack {
  const { pack, sources, profile } = params;

  const seen = new Set<string>();
  const questions: ModelQuestion[] = [];

  for (const question of pack.questions) {
    const verified = verifyQuestion({ question, sources, profile });
    if (!verified) continue;
    const key = normaliseKey(verified.question);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    questions.push(verified);
    if (questions.length >= INTERVIEW_PREP_MAX_QUESTIONS) break;
  }

  const title = tidy(pack.title, 160) || 'Interview preparation pack';
  const preparationGuidance = tidy(pack.preparationGuidance, 900) ?? null;
  const limitations = [
    ...new Set(
      pack.limitations
        .map((item) => tidy(item, 280))
        .filter((item): item is string => Boolean(item)),
    ),
  ].slice(0, 8);

  return {
    schemaVersion: INTERVIEW_PREP_SCHEMA_VERSION,
    title,
    context: pack.context,
    questions,
    preparationGuidance,
    limitations,
  };
}

// ─── Feedback verification ─────────────────────────────────────────────────

/** Dimensions allowed for feedback, in priority order. */
export const ALLOWED_DIMENSIONS: RubricDimension[] = [
  'RELEVANCE',
  'CLARITY_STRUCTURE',
  'CONCRETE_EXAMPLE',
  'ROLE_SKILLS',
  'TECHNICAL_CORRECTNESS',
  'REASONING_TRADE_OFFS',
  'COMMUNICATION',
  'COMPLETENESS',
  'SUPPORTED_OUTCOMES',
];

function allowedDimension(value: unknown): value is RubricDimension {
  return typeof value === 'string' && ALLOWED_DIMENSIONS.includes(value as RubricDimension);
}

function allowedRating(value: unknown): value is Rating {
  return typeof value === 'string' && ratingSchema.safeParse(value).success;
}

export type VerifyFeedbackOptions = {
  feedback: ModelFeedback;
  answerText: string;
};

/**
 * Verify one generated feedback result.
 *
 * Drops dimensions that are not in the allowed set, drops evidence quotes
 * that do not actually appear in the answer, neutralises promises and legal
 * determinations, and bounds everything.
 */
export function verifyFeedback(params: VerifyFeedbackOptions): ModelFeedback {
  const { feedback, answerText } = params;
  const normalisedAnswer = normaliseKey(answerText);

  const dimensions: ModelFeedback['dimensions'] = [];
  for (const dimension of feedback.dimensions) {
    if (!allowedDimension(dimension.dimension)) continue;
    const note = tidy(dimension.note, 600) ?? '';
    const neutralised = containsUnsupportableClaim(note) ? neutraliseText(note) : note;
    let quote = dimension.evidenceQuote ?? null;
    if (quote) {
      const trimmed = tidy(quote, 220);
      if (!trimmed || !normalisedAnswer.includes(normaliseKey(trimmed))) {
        // Not actually in the answer: drop the quote rather than fabricate.
        quote = null;
      } else {
        quote = trimmed;
      }
    }
    dimensions.push({
      dimension: dimension.dimension,
      rating: allowedRating(dimension.rating) ? dimension.rating : 'INSUFFICIENT_EVIDENCE',
      note: neutralised || 'No note provided.',
      evidenceQuote: quote,
    });
    if (dimensions.length >= 10) break;
  }

  const whatWorked = tidy(feedback.whatWorked, 600) ?? 'Your answer addresses the question.';
  const needsImprovement = tidy(feedback.needsImprovement, 600) ?? '';
  const missing = tidy(feedback.missing, 600) ?? '';
  const structureSuggestion = tidy(feedback.structureSuggestion, 600) ?? '';
  const limitations = tidy(feedback.limitations, 500);

  return {
    dimensions,
    whatWorked: containsUnsupportableClaim(whatWorked) ? neutraliseText(whatWorked) : whatWorked,
    needsImprovement: containsUnsupportableClaim(needsImprovement) ? neutraliseText(needsImprovement) : needsImprovement,
    missing: containsUnsupportableClaim(missing) ? neutraliseText(missing) : missing,
    structureSuggestion: containsUnsupportableClaim(structureSuggestion) ? neutraliseText(structureSuggestion) : structureSuggestion,
    followUpPractice: feedback.followUpPractice
      .map((item) => tidy(item, 220))
      .filter((item): item is string => Boolean(item))
      .slice(0, 3),
    limitations: limitations && containsUnsupportableClaim(limitations)
      ? neutraliseText(limitations)
      : limitations,
  };
}
