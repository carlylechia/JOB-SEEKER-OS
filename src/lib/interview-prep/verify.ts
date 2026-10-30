/**
 * Server-side verification of generated interview preparation content.
 *
 * This runs between the provider returning and anything being written to the
 * database. The model is not a witness. Every claim it makes is re-checked
 * against the sources of truth we hold:
 *
 *  1. COMPANY CLAIMS ARE SOURCE-BOUND. A SOURCE claim needs a valid supplied
 *     source index whose text supports it. Otherwise the claim is dropped or
 *     downgraded to an inference.
 *  2. EVIDENCE IS RE-QUOTED. Job quotes must appear in the posting; candidate
 *     quotes must appear in the profile/resume corpus.
 *  3. QUESTIONS ARE DEDUPLICATED AND BOUNDED. No repeated generic questions,
 *     no invented source references, no claim of inside knowledge.
 *  4. FEEDBACK QUOTES ARE RE-QUOTED and unsupportable promises are
 *     neutralised.
 *  5. EVERYTHING IS BOUNDED. Lengths, array sizes and counts are re-applied.
 *
 * Pure: the same input always gives the same output, testable without a
 * provider.
 */

import {
  INTERVIEW_PREP_MAX_EMPLOYER_QUESTIONS,
  INTERVIEW_PREP_MAX_QUESTIONS,
  INTERVIEW_PREP_MAX_TASKS,
} from './limits';
import {
  INTERVIEW_PREP_SCHEMA_VERSION,
  type ModelBriefing,
  type ModelCompanyClaim,
  type ModelCompanySection,
  type ModelEvidenceBankItem,
  type ModelFeedback,
  type ModelLogisticsItem,
  type ModelPack,
  type ModelQuestion,
  type ModelRequirement,
  type ModelRoleSection,
  type ModelTask,
  type Rating,
  type ResearchSourceKind,
  type RubricDimension,
  ratingSchema,
} from './schema';

/** Canonical comparison key — same shape as the job-intelligence verifier. */
export function normaliseKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9+#.]+/g, ' ').trim();
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

function tidyArray(values: readonly string[], maxItems: number, maxLength: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const clean = tidy(value, maxLength);
    if (!clean) continue;
    const key = normaliseKey(clean);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
    if (result.length >= maxItems) break;
  }
  return result;
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
  /\b(?:we|they|the (?:employer|company|interviewer)) (?:will|can|would)\b(?! )/i,
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
      return 'That is not in your current profile — if you have it, adding it will change what we can suggest.';
  }
}

function neutraliseText(text: string): string {
  const legal = LEGAL_DETERMINATION_PATTERNS.some((pattern) => pattern.test(text));
  if (legal) return neutralisedCopy('legal');
  const promise = PROMISE_PATTERNS.some((pattern) => pattern.test(text));
  if (promise) return neutralisedCopy('promise');
  return neutralisedCopy('capability');
}

function tidyText(text: string | null | undefined, max: number): string {
  const clean = tidy(text, max);
  if (!clean) return '';
  return containsUnsupportableClaim(clean) ? neutraliseText(clean) : clean;
}

/**
 * Multiline text keeps paragraph and list breaks (model answers are read as a
 * script), while still normalising line endings and bounding the length.
 *
 * The promise/legal detector is intentionally not applied to model answers:
 * they are first-person scripts and may legitimately say what an employer or
 * team will do. Applying the coaching-claim filter here would replace a whole
 * answer with a generic warning.
 */
function tidyMultilineText(text: string | null | undefined, max: number): string {
  if (typeof text !== 'string') return '';
  const clean = text.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();
  if (!clean) return '';
  return clean.length > max ? clean.slice(0, max).trim() : clean;
}

function normaliseScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(10, Math.max(0, Math.round(value)));
}

// ─── Sources ───────────────────────────────────────────────────────────────

export type VerificationSource = {
  index: number;
  kind: ResearchSourceKind;
  title: string;
  url: string | null;
  text: string;
};

function usableSourceIndexes(sources: VerificationSource[]): Set<number> {
  return new Set(sources.filter((source) => source.text.trim().length >= 40).map((source) => source.index));
}

function validIndexes(indexes: number[], usable: Set<number>): number[] {
  return [...new Set(indexes)].filter((index) => usable.has(index)).slice(0, 8);
}

function sourceTextAt(sources: VerificationSource[], indexes: number[]): string {
  return indexes
    .map((index) => sources.find((source) => source.index === index)?.text ?? '')
    .filter(Boolean)
    .join('\n');
}

// ─── Profile evidence re-checking ──────────────────────────────────────────

/** The subset of profile data verification needs. */
export type ProfileEvidence = {
  projectNames: string[];
  experienceTitles: string[];
  skillNames: string[];
};

/** Does the profile actually contain a project or experience by this name? */
export function profileSupportsExperience(profile: ProfileEvidence, reference: string): boolean {
  const needle = normaliseKey(reference);
  if (!needle) return false;
  const haystack = [...profile.projectNames, ...profile.experienceTitles, ...profile.skillNames];
  return haystack.some((name) => {
    const key = normaliseKey(name);
    if (!key) return false;
    return key === needle || key.includes(needle) || needle.includes(key);
  });
}

// ─── Company claims ────────────────────────────────────────────────────────

function verifyCompanyClaim(
  claim: ModelCompanyClaim,
  usable: Set<number>,
  sources: VerificationSource[],
): ModelCompanyClaim | null {
  const text = tidy(claim.claim, 700);
  if (!text) return null;

  const indexes = validIndexes(claim.sourceIndexes, usable);
  let basis = claim.basis;

  if (basis === 'SOURCE') {
    if (indexes.length === 0) return null;
    // The claim must have some lexical connection to the cited text. This is
    // not semantic entailment, but it catches invented facts attached to a
    // real source. A claim that shares almost nothing is dropped.
    const sourceText = normaliseKey(sourceTextAt(sources, indexes));
    if (sourceText) {
      const claimWords = new Set(normaliseKey(text).split(' ').filter((word) => word.length >= 4));
      const sourceWords = new Set(sourceText.split(' ').filter((word) => word.length >= 4));
      let overlap = 0;
      for (const word of claimWords) if (sourceWords.has(word)) overlap += 1;
      if (claimWords.size >= 4 && overlap === 0) return null;
    }
  } else if (indexes.length > 0) {
    // An inference with source indexes is still an inference; keep the
    // indexes but never present it as sourced.
    basis = 'INFERENCE';
  }

  return {
    claim: containsUnsupportableClaim(text) ? neutralisedCopy('capability') : text,
    basis,
    sourceIndexes: indexes,
    whyItMatters: tidy(claim.whyItMatters, 600),
  };
}

function verifyCompanySection(
  section: ModelCompanySection,
  usable: Set<number>,
  sources: VerificationSource[],
): ModelCompanySection {
  const claim = (value: ModelCompanyClaim | null) =>
    value ? verifyCompanyClaim(value, usable, sources) : null;
  const claims = (values: ModelCompanyClaim[]) =>
    values
      .map((value) => verifyCompanyClaim(value, usable, sources))
      .filter((value): value is ModelCompanyClaim => value !== null);

  const recentDevelopments = section.recentDevelopments
    .map((item) => {
      const title = tidy(item.title, 220);
      const summary = tidy(item.summary, 900);
      if (!title || !summary) return null;
      const indexes = validIndexes(item.sourceIndexes, usable);
      let basis = item.basis;
      if (basis === 'SOURCE' && indexes.length === 0) return null;
      if (basis === 'INFERENCE') basis = 'INFERENCE';
      return {
        title,
        date: /^\d{4}-\d{2}-\d{2}$/.test(item.date ?? '') ? item.date : null,
        summary: containsUnsupportableClaim(summary) ? neutralisedCopy('capability') : summary,
        basis,
        sourceIndexes: indexes,
        whyItMatters: tidy(item.whyItMatters, 600),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .slice(0, 5);

  return {
    overview: claim(section.overview),
    products: claims(section.products).slice(0, 6),
    customers: claim(section.customers),
    mission: claim(section.mission),
    values: claims(section.values).slice(0, 8),
    cultureNotes: claims(section.cultureNotes).slice(0, 6),
    recentDevelopments,
    roleContext: tidyArray(section.roleContext, 6, 600),
    whyThisCompanyDraft: tidyText(section.whyThisCompanyDraft, 1400),
    whyThisCompanyPlaceholders: tidyArray(section.whyThisCompanyPlaceholders, 8, 160),
    researchLimitations: tidyArray(section.researchLimitations, 6, 320),
  };
}

// ─── Role and evidence ─────────────────────────────────────────────────────

function verifyRequirement(params: {
  requirement: ModelRequirement;
  jobText: string;
  candidateText: string;
}): ModelRequirement | null {
  const requirement = tidy(params.requirement.requirement, 500);
  if (!requirement) return null;

  let evidenceQuote = tidy(params.requirement.evidenceQuote, 500);
  if (evidenceQuote && !excerptAppearsIn(evidenceQuote, params.candidateText)) {
    evidenceQuote = null;
  }

  let evidenceStatus = params.requirement.evidenceStatus;
  let evidenceSource = params.requirement.evidenceSource;
  if (!evidenceQuote) {
    if (evidenceStatus === 'DEMONSTRATED') evidenceStatus = 'UNCLEAR';
    if (evidenceSource !== 'NONE') evidenceSource = 'NONE';
  }

  let sourceQuote = tidy(params.requirement.sourceQuote, 500);
  if (sourceQuote && !excerptAppearsIn(sourceQuote, params.jobText)) {
    sourceQuote = null;
  }

  return {
    requirement,
    importance: params.requirement.importance,
    requirementType: params.requirement.requirementType,
    evidenceStatus,
    evidenceQuote,
    evidenceExplanation: tidy(params.requirement.evidenceExplanation, 700),
    evidenceSource,
    gap: tidy(params.requirement.gap, 600),
    preparationAction: tidyText(params.requirement.preparationAction, 700),
    confidence: params.requirement.confidence,
    sourceQuote,
  };
}

function verifyRoleSection(params: {
  section: ModelRoleSection;
  jobText: string;
  candidateText: string;
}): ModelRoleSection {
  const requirements = params.section.requirements
    .map((requirement) =>
      verifyRequirement({ requirement, jobText: params.jobText, candidateText: params.candidateText }),
    )
    .filter((requirement): requirement is ModelRequirement => requirement !== null)
    .slice(0, 12);

  const competencies = params.section.competencies
    .map((competency) => {
      const name = tidy(competency.name, 180);
      const why = tidy(competency.why, 700);
      const sampleQuestion = tidy(competency.sampleQuestion, 900);
      const strongAnswerShows = tidy(competency.strongAnswerShows, 800);
      const practiceAdvice = tidy(competency.practiceAdvice, 700);
      if (!name || !sampleQuestion) return null;

      let evidenceQuote = tidy(competency.evidenceQuote, 500);
      if (evidenceQuote && !excerptAppearsIn(evidenceQuote, params.candidateText)) {
        evidenceQuote = null;
      }

      return {
        name,
        why: why ?? '',
        requirement: tidy(competency.requirement, 500),
        evidenceQuote,
        evidenceExplanation: tidy(competency.evidenceExplanation, 700),
        sampleQuestion,
        strongAnswerShows: strongAnswerShows ?? '',
        practiceAdvice: practiceAdvice ?? '',
        evidenceBasis: competency.evidenceBasis,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .slice(0, 8);

  return {
    summary: tidyText(params.section.summary, 1200),
    responsibilities: tidyArray(params.section.responsibilities, 10, 500),
    requirements,
    competencies,
    likelyChallenges: tidyArray(params.section.likelyChallenges, 6, 600),
    occupationalFamily: tidy(params.section.occupationalFamily, 80) ?? 'General professional',
  };
}

function verifyBriefing(params: {
  briefing: ModelBriefing;
  usable: Set<number>;
  sources: VerificationSource[];
  candidateText: string;
}): ModelBriefing {
  const topPriorities = params.briefing.topPriorities
    .map((item) => {
      const title = tidy(item.title, 220);
      const why = tidy(item.why, 600);
      if (!title || !why) return null;
      return {
        title,
        why: tidyText(why, 600),
        basis: item.basis,
        priority: item.priority,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .slice(0, 5);

  const strongestEvidence = params.briefing.strongestEvidence
    .map((item) => {
      const theme = tidy(item.theme, 160);
      const explanation = tidy(item.explanation, 600);
      if (!theme || !explanation) return null;
      let quote = tidy(item.evidenceQuote, 500);
      if (quote && !excerptAppearsIn(quote, params.candidateText)) quote = null;
      return {
        theme,
        evidenceQuote: quote,
        explanation: tidyText(explanation, 600),
        verification: quote ? ('CONFIRMED_PROFILE' as const) : ('NEEDS_USER_INPUT' as const),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .slice(0, 5);

  const gaps = params.briefing.gaps
    .map((item) => {
      const gap = tidy(item.gap, 500);
      const action = tidy(item.preparationAction, 600);
      if (!gap || !action) return null;
      return {
        gap,
        preparationAction: tidyText(action, 600),
        evidenceStatus: item.evidenceStatus,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .slice(0, 6);

  const keyCompanyFacts = params.briefing.keyCompanyFacts
    .map((item) => {
      const fact = tidy(item.fact, 500);
      if (!fact) return null;
      const indexes = validIndexes(item.sourceIndexes, params.usable);
      if (indexes.length === 0) return null;
      return { fact, sourceIndexes: indexes };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .slice(0, 6);

  return {
    summary: tidyText(params.briefing.summary, 1200),
    topPriorities,
    strongestEvidence,
    gaps,
    keyCompanyFacts,
    nextAction: tidyText(params.briefing.nextAction, 500),
  };
}

function verifyEvidenceBank(params: {
  items: ModelEvidenceBankItem[];
  candidateText: string;
}): ModelEvidenceBankItem[] {
  return params.items
    .map((item) => {
      const title = tidy(item.title, 220);
      const note = tidy(item.evidenceNote, 700);
      if (!title || !note) return null;

      let evidenceQuote = tidy(item.evidenceQuote, 500);
      if (evidenceQuote && !excerptAppearsIn(evidenceQuote, params.candidateText)) {
        evidenceQuote = null;
      }

      const verification = evidenceQuote
        ? ('CONFIRMED_PROFILE' as const)
        : item.verification === 'NEEDS_USER_INPUT'
          ? ('NEEDS_USER_INPUT' as const)
          : ('UNCONFIRMED_PROFILE' as const);

      return {
        theme: tidy(item.theme, 160) ?? 'General',
        title,
        evidenceQuote,
        evidenceNote: tidyText(note, 700),
        sourceLabel: tidy(item.sourceLabel, 160) ?? 'Candidate profile',
        whatItSupports: tidy(item.whatItSupports, 600) ?? '',
        missingDetails: tidyArray(item.missingDetails, 5, 300),
        competencies: tidyArray(item.competencies, 5, 180),
        verification,
      };
    })
    .filter((item): item is ModelEvidenceBankItem => item !== null)
    .slice(0, 8);
}

// ─── Question verification ─────────────────────────────────────────────────

function tokens(value: string): Set<string> {
  return new Set(normaliseKey(value).split(' ').filter((word) => word.length >= 3));
}

/** Jaccard similarity used only to catch near-duplicate practice questions. */
export function textSimilarity(a: string, b: string): number {
  const left = tokens(a);
  const right = tokens(b);
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function verifyQuestion(params: {
  question: ModelQuestion;
  jobText: string;
  candidateText: string;
  usable: Set<number>;
  profile: ProfileEvidence;
}): ModelQuestion | null {
  const text = tidy(params.question.question, 1200);
  if (!text) return null;

  const whyMatters = tidy(params.question.whyMatters, 700) ?? '';
  if (containsUnsupportableClaim(whyMatters)) return null;

  let candidateEvidenceQuote = tidy(params.question.candidateEvidenceQuote, 500);
  if (candidateEvidenceQuote && !excerptAppearsIn(candidateEvidenceQuote, params.candidateText)) {
    candidateEvidenceQuote = null;
  }

  const sourceIndexes = validIndexes(params.question.sourceIndexes, params.usable);
  let evidenceBasis = params.question.evidenceBasis;
  if (evidenceBasis === 'COMPANY_RESEARCH' && sourceIndexes.length === 0) {
    evidenceBasis = params.jobText.trim().length >= 40 ? 'JOB_DESCRIPTION' : 'GENERAL_PRACTICE';
  }

  const relatedRequirement = tidy(params.question.relatedRequirement, 400);
  void params.profile;

  return {
    generationId: tidy(params.question.generationId, 80) ?? `q-${normaliseKey(text).slice(0, 40)}`,
    category: params.question.category,
    difficulty: params.question.difficulty,
    competency: tidy(params.question.competency, 300) ?? 'General',
    question: text,
    whyMatters,
    relatedRequirement,
    candidateEvidenceQuote,
    candidateEvidenceNote: tidy(params.question.candidateEvidenceNote, 500),
    prepNotes: tidy(params.question.prepNotes, 700),
    answerStructure: params.question.answerStructure,
    strongAnswerShows: tidy(params.question.strongAnswerShows, 800) ?? '',
    commonPitfalls: tidyArray(params.question.commonPitfalls, 5, 400),
    coaching: {
      whatInterviewerAssesses: tidy(params.question.coaching.whatInterviewerAssesses, 700) ?? '',
      keyPoints: tidyArray(params.question.coaching.keyPoints, 6, 400),
      practiceExercise: tidy(params.question.coaching.practiceExercise, 600) ?? '',
      sampleWordingPlaceholder: tidy(params.question.coaching.sampleWordingPlaceholder, 900),
    },
    evidenceBasis,
    priority: params.question.priority,
    sourceIndexes,
    followUpQuestions: tidyArray(params.question.followUpQuestions, 3, 300),
    isPrediction: true,
  };
}

function verifyQuestions(params: {
  questions: ModelQuestion[];
  jobText: string;
  candidateText: string;
  usable: Set<number>;
  profile: ProfileEvidence;
  maxQuestions: number;
}): ModelQuestion[] {
  const result: ModelQuestion[] = [];
  for (const question of params.questions) {
    const verified = verifyQuestion({
      question,
      jobText: params.jobText,
      candidateText: params.candidateText,
      usable: params.usable,
      profile: params.profile,
    });
    if (!verified) continue;
    if (result.some((existing) => textSimilarity(existing.question, verified.question) >= 0.82)) continue;
    result.push(verified);
    if (result.length >= params.maxQuestions) break;
  }
  return result;
}

// ─── Tasks ─────────────────────────────────────────────────────────────────

function taskKey(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'preparation-task';
}

function verifyTasks(tasks: ModelTask[], maxTasks: number): ModelTask[] {
  const keys = new Set<string>();
  const result: ModelTask[] = [];
  for (const task of tasks) {
    const title = tidy(task.title, 220);
    const description = tidy(task.description, 900);
    if (!title || !description) continue;
    const key = taskKey(task.taskKey || title);
    if (keys.has(key)) continue;
    keys.add(key);
    result.push({
      taskKey: key,
      title,
      description: tidyText(description, 900),
      whyItMatters: tidyText(task.whyItMatters, 600),
      expectedOutput: tidy(task.expectedOutput, 500) ?? '',
      priority: task.priority,
      category: task.category,
      estimatedMinutes: Math.min(90, Math.max(5, Math.round(task.estimatedMinutes))),
      horizon: task.horizon,
    });
    if (result.length >= maxTasks) break;
  }
  return result;
}

// ─── Pack verification ─────────────────────────────────────────────────────

export type VerifyPackOptions = {
  pack: ModelPack;
  sources: VerificationSource[];
  jobText: string;
  candidateText: string;
  profile: ProfileEvidence;
  maxQuestions?: number;
  maxTasks?: number;
};

export type VerifiedPackResult = {
  pack: ModelPack;
  stats: {
    questions: number;
    tasks: number;
    employerQuestions: number;
    sourcesUsed: number;
    companyClaimsKept: number;
    companyClaimsDropped: number;
  };
};

/**
 * Verify and prune a whole pack.
 *
 * Returns the sanitised pack plus counts so the service can decide between
 * READY and PARTIALLY_READY and explain what was lost.
 */
export function verifyPack(options: VerifyPackOptions): VerifiedPackResult {
  const { pack, sources, jobText, candidateText, profile } = options;
  const maxQuestions = options.maxQuestions ?? INTERVIEW_PREP_MAX_QUESTIONS;
  const maxTasks = options.maxTasks ?? INTERVIEW_PREP_MAX_TASKS;
  const usable = usableSourceIndexes(sources);

  const originalClaims =
    (pack.company.overview ? 1 : 0) +
    pack.company.products.length +
    (pack.company.customers ? 1 : 0) +
    (pack.company.mission ? 1 : 0) +
    pack.company.values.length +
    pack.company.cultureNotes.length +
    pack.company.recentDevelopments.length;

  const company = verifyCompanySection(pack.company, usable, sources);
  const keptClaims =
    (company.overview ? 1 : 0) +
    company.products.length +
    (company.customers ? 1 : 0) +
    (company.mission ? 1 : 0) +
    company.values.length +
    company.cultureNotes.length +
    company.recentDevelopments.length;

  const role = verifyRoleSection({ section: pack.role, jobText, candidateText });
  const questions = verifyQuestions({
    questions: pack.questions,
    jobText,
    candidateText,
    usable,
    profile,
    maxQuestions,
  });

  const employerQuestions = pack.employerQuestions
    .map((item) => {
      const question = tidy(item.question, 600);
      if (!question) return null;
      const indexes = validIndexes(item.sourceIndexes, usable);
      return {
        question,
        why: tidy(item.why, 500) ?? '',
        category: item.category,
        priority: indexes.length > 0 || item.category !== 'COMPANY' ? item.priority : ('MEDIUM' as const),
        sourceIndexes: indexes,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .filter((item, index, all) => all.findIndex((other) => textSimilarity(other.question, item.question) >= 0.85) === index)
    .slice(0, INTERVIEW_PREP_MAX_EMPLOYER_QUESTIONS);

  const tasks = verifyTasks(pack.tasks, maxTasks);

  const logistics: ModelLogisticsItem[] = pack.logistics
    .map((item) => {
      const topic = tidy(item.topic, 160);
      const guidance = tidy(item.guidance, 700);
      if (!topic || !guidance) return null;
      return { topic, guidance: tidyText(guidance, 700), basis: item.basis };
    })
    .filter((item): item is ModelLogisticsItem => item !== null)
    .slice(0, 8);

  const cheatSheet = {
    companyFacts: tidyArray(pack.cheatSheet.companyFacts, 6, 400),
    topCompetencies: tidyArray(pack.cheatSheet.topCompetencies, 5, 260),
    strongestExamples: tidyArray(pack.cheatSheet.strongestExamples, 4, 400),
    questionsToAsk: tidyArray(pack.cheatSheet.questionsToAsk, 5, 400),
    logistics: tidyArray(pack.cheatSheet.logistics, 5, 400),
    reminders: tidyArray(pack.cheatSheet.reminders, 5, 300),
    unknowns: tidyArray(pack.cheatSheet.unknowns, 4, 300),
  };

  const preparationGuidance = tidy(pack.preparationGuidance, 1200);

  return {
    pack: {
      schemaVersion: INTERVIEW_PREP_SCHEMA_VERSION,
      title: tidy(pack.title, 160) ?? 'Interview preparation pack',
      context: pack.context,
      briefing: verifyBriefing({
        briefing: pack.briefing,
        usable,
        sources,
        candidateText,
      }),
      company,
      role,
      evidenceBank: verifyEvidenceBank({ items: pack.evidenceBank, candidateText }),
      questions,
      employerQuestions,
      tasks,
      logistics,
      cheatSheet,
      preparationGuidance,
      limitations: tidyArray(pack.limitations, 10, 300),
    },
    stats: {
      questions: questions.length,
      tasks: tasks.length,
      employerQuestions: employerQuestions.length,
      sourcesUsed: usable.size,
      companyClaimsKept: keptClaims,
      companyClaimsDropped: Math.max(0, originalClaims - keptClaims),
    },
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
  'PROFESSIONAL_JUDGMENT',
  'SAFETY_CONSIDERATIONS',
];

function allowedRating(value: unknown): value is Rating {
  return typeof value === 'string' && ratingSchema.safeParse(value).success;
}

export type VerifyFeedbackOptions = {
  feedback: ModelFeedback;
  answerText: string;
  allowedDimensions?: string[];
};

/**
 * Verify one generated feedback result.
 *
 * Drops dimensions that are not relevant, drops evidence quotes that do not
 * appear in the answer, neutralises promises and legal determinations, and
 * bounds everything.
 */
export function verifyFeedback(params: VerifyFeedbackOptions): ModelFeedback {
  const { feedback, answerText } = params;
  const normalisedAnswer = normaliseKey(answerText);
  const allowed = new Set(params.allowedDimensions ?? ALLOWED_DIMENSIONS);
  const seen = new Set<string>();

  const dimensions: ModelFeedback['dimensions'] = [];
  for (const dimension of feedback.dimensions) {
    if (!allowed.has(dimension.dimension) || seen.has(dimension.dimension)) continue;
    seen.add(dimension.dimension);
    const note = tidy(dimension.note, 600) ?? '';
    const neutralised = containsUnsupportableClaim(note) ? neutraliseText(note) : note;
    let quote = tidy(dimension.evidenceQuote, 280);
    if (quote && !normalisedAnswer.includes(normaliseKey(quote))) quote = null;
    dimensions.push({
      dimension: dimension.dimension,
      rating: allowedRating(dimension.rating) ? dimension.rating : 'INSUFFICIENT_EVIDENCE',
      note: neutralised || 'No note provided.',
      evidenceQuote: quote,
    });
    if (dimensions.length >= 10) break;
  }

  const adaptive = feedback.adaptiveFollowUp
    ? {
        question: tidy(feedback.adaptiveFollowUp.question, 500) ?? '',
        why: tidy(feedback.adaptiveFollowUp.why, 400) ?? '',
        whatToInclude: tidyArray(feedback.adaptiveFollowUp.whatToInclude, 4, 300),
      }
    : null;

  // The score must never contradict the rubric in the candidate's favour.
  // If nothing could be assessed, the answer cannot be better than "broken";
  // if every scored dimension is absent, it cannot be better than "partial".
  let score = normaliseScore(feedback.score);
  if (dimensions.length === 0 || dimensions.every((dimension) => dimension.rating === 'INSUFFICIENT_EVIDENCE')) {
    score = Math.min(score, 2);
  } else if (dimensions.every((dimension) => dimension.rating === 'NOT_EVIDENT')) {
    score = Math.min(score, 4);
  }

  const scoreRationale =
    tidyText(feedback.scoreRationale, 700) ||
    `This answer scores ${score}/10 against the rubric. The notes below explain the main gap.`;

  const modelAnswer =
    tidyMultilineText(feedback.modelAnswer, 2_400) ||
    'A complete model answer could not be generated for this attempt. Use the structure guidance and your own verified evidence to draft one.';

  return {
    score,
    scoreRationale,
    modelAnswer,
    dimensions,
    whatWorked: tidyText(feedback.whatWorked, 600) || 'Your answer addresses the question.',
    needsImprovement: tidyText(feedback.needsImprovement, 600),
    missing: tidyText(feedback.missing, 600),
    structureSuggestion: tidyText(feedback.structureSuggestion, 600),
    revisedStructure: feedback.revisedStructure
      ? tidyText(feedback.revisedStructure, 900)
      : null,
    followUpPractice: tidyArray(feedback.followUpPractice, 3, 300),
    adaptiveFollowUp: adaptive && adaptive.question ? adaptive : null,
    limitations: feedback.limitations ? tidyText(feedback.limitations, 600) : null,
  };
}
