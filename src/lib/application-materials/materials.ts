/**
 * Typed definitions for the material types this product supports.
 *
 * A type is only listed here once its workflow can be supported correctly. That
 * is the rule: shipping a type whose inputs we cannot honestly populate is how
 * you end up generating "thanks for the interview" for someone who has not had
 * one.
 *
 * Everything downstream — the API contract, the conditional form fields, the
 * prompt, the verification rules, the export format — is derived from this one
 * file. Adding a seventh material type means adding an entry here and its
 * context builder, not redesigning the service.
 */

import { z } from 'zod';

/**
 * Material types, mirroring the `ApplicationMaterialType` enum in
 * `prisma/schema.prisma`. Kept in this file as the canonical TypeScript source
 * and asserted against the Prisma client in the test suite, so the two cannot
 * drift.
 */
export const MATERIAL_TYPES = [
  'COVER_LETTER',
  'RECRUITER_OUTREACH',
  'LINKEDIN_CONNECTION',
  'APPLICATION_FOLLOW_UP',
  'APPLICATION_STATUS_CHECK',
  'INTERVIEW_THANK_YOU',
] as const;

export type MaterialType = (typeof MATERIAL_TYPES)[number];

export const materialTypeSchema = z.enum(MATERIAL_TYPES);

export function isMaterialType(value: unknown): value is MaterialType {
  return typeof value === 'string' && (MATERIAL_TYPES as readonly string[]).includes(value);
}

// ─── Tone ───────────────────────────────────────────────────────────────────

/**
 * Five tones, deliberately.
 *
 * The obvious move is to offer twenty. That produces a form nobody reads and a
 * model that hedges between instructions. Tone should change HOW something is
 * written; it must never change WHAT is claimed, and the prompt states that in
 * those terms because "confident" is exactly the kind of word a model reads as
 * permission to overstate.
 */
export const TONES = ['PROFESSIONAL', 'CONFIDENT', 'WARM', 'CONCISE', 'FORMAL'] as const;

export type Tone = (typeof TONES)[number];

export const toneSchema = z.enum(TONES);

/** Which tones make sense for each material. */
const TONES_BY_TYPE: Record<MaterialType, readonly Tone[]> = {
  COVER_LETTER: ['PROFESSIONAL', 'CONFIDENT', 'WARM', 'CONCISE', 'FORMAL'],
  RECRUITER_OUTREACH: ['PROFESSIONAL', 'CONFIDENT', 'WARM', 'CONCISE'],
  LINKEDIN_CONNECTION: ['PROFESSIONAL', 'CONFIDENT', 'WARM', 'CONCISE'],
  APPLICATION_FOLLOW_UP: ['PROFESSIONAL', 'CONFIDENT', 'WARM', 'CONCISE', 'FORMAL'],
  APPLICATION_STATUS_CHECK: ['PROFESSIONAL', 'CONCISE', 'WARM', 'FORMAL'],
  INTERVIEW_THANK_YOU: ['PROFESSIONAL', 'WARM', 'FORMAL', 'CONCISE'],
};

export function tonesFor(type: MaterialType): readonly Tone[] {
  return TONES_BY_TYPE[type];
}

/** Server-side validation of a tone for a type. Fails closed. */
export function isToneFor(type: MaterialType, value: unknown): value is Tone {
  return typeof value === 'string' && (TONES_BY_TYPE[type] as readonly string[]).includes(value);
}

export function resolveTone(type: MaterialType, value: unknown): Tone {
  return isToneFor(type, value) ? value : 'PROFESSIONAL';
}

export const TONE_LABELS: Record<Tone, string> = {
  PROFESSIONAL: 'Professional',
  CONFIDENT: 'Confident',
  WARM: 'Warm',
  CONCISE: 'Concise',
  FORMAL: 'Formal',
};

/**
 * What each tone is allowed to change.
 *
 * Sent to the model verbatim so "confident" cannot be read as licence to
 * overstate. This is the single most important guard on tone: a confident tone
 * must produce firmer wording of the same facts, never a stronger claim.
 */
export const TONE_INSTRUCTIONS: Record<Tone, string> = {
  PROFESSIONAL:
    'Standard professional register. Clear, direct and courteous without being stiff.',
  CONFIDENT:
    'Write with assurance about what the candidate has actually done. Confidence comes from specificity, not from overstating: do not add a claim, a number or a qualification that is not in the source facts.',
  WARM:
    'Friendly and human. Acknowledge the reader as a person without becoming chatty or unprofessional.',
  CONCISE: 'Tight and economical. Cut filler and hedging, but never cut a required fact or a caveat.',
  FORMAL:
    'Formal and traditional business register. Avoid contractions and casual phrasing. Do not become stiff enough to obscure the candidate\'s actual experience.',
};

// ─── Length ─────────────────────────────────────────────────────────────────

export const LENGTHS = ['SHORT', 'STANDARD', 'DETAILED'] as const;

export type MaterialLength = (typeof LENGTHS)[number];

export const materialLengthSchema = z.enum(LENGTHS);

/**
 * Target character budget per length.
 *
 * Advisory, not enforced as a hard cut: verification can only remove text, and
 * a hard cut mid-sentence is worse than a slightly long draft. The budgets are
 * stated in the prompt as a target, and the real ceiling is
 * `MATERIAL_MAX_CONTENT_CHARS`.
 *
 * The budgets are deliberately specific to the material type. A LinkedIn
 * connection note at the same length as a cover letter is not a shorter cover
 * letter, it is a paragraph nobody reads.
 */
const LENGTH_BUDGETS: Record<MaterialType, Record<MaterialLength, number>> = {
  COVER_LETTER: { SHORT: 900, STANDARD: 1_600, DETAILED: 2_600 },
  RECRUITER_OUTREACH: { SHORT: 500, STANDARD: 900, DETAILED: 1_400 },
  LINKEDIN_CONNECTION: { SHORT: 220, STANDARD: 400, DETAILED: 650 },
  APPLICATION_FOLLOW_UP: { SHORT: 450, STANDARD: 800, DETAILED: 1_200 },
  APPLICATION_STATUS_CHECK: { SHORT: 400, STANDARD: 700, DETAILED: 1_000 },
  INTERVIEW_THANK_YOU: { SHORT: 450, STANDARD: 800, DETAILED: 1_200 },
};

export function lengthBudget(type: MaterialType, length: MaterialLength): number {
  return LENGTH_BUDGETS[type][length];
}

/**
 * Whether a length option makes sense for a type.
 *
 * A 2,600-character LinkedIn note is not a user preference, it is a field
 * nobody can satisfy meaningfully.
 */
const AVAILABLE_LENGTHS: Record<MaterialType, readonly MaterialLength[]> = {
  COVER_LETTER: ['SHORT', 'STANDARD', 'DETAILED'],
  RECRUITER_OUTREACH: ['SHORT', 'STANDARD', 'DETAILED'],
  LINKEDIN_CONNECTION: ['SHORT', 'STANDARD'],
  APPLICATION_FOLLOW_UP: ['SHORT', 'STANDARD', 'DETAILED'],
  APPLICATION_STATUS_CHECK: ['SHORT', 'STANDARD'],
  INTERVIEW_THANK_YOU: ['SHORT', 'STANDARD', 'DETAILED'],
};

export function lengthsFor(type: MaterialType): readonly MaterialLength[] {
  return AVAILABLE_LENGTHS[type];
}

export function resolveLength(type: MaterialType, value: unknown): MaterialLength {
  if (typeof value === 'string' && (AVAILABLE_LENGTHS[type] as readonly string[]).includes(value)) {
    return value as MaterialLength;
  }
  return 'STANDARD';
}

export const LENGTH_LABELS: Record<MaterialLength, string> = {
  SHORT: 'Short',
  STANDARD: 'Standard',
  DETAILED: 'Detailed',
};

// ─── Presentation metadata ──────────────────────────────────────────────────

export type MaterialTypeMeta = {
  label: string;
  /** One line, user-facing, describing what this produces. */
  description: string;
  /**
   * Which optional form fields this type needs. Drives the conditional form so
   * a LinkedIn connection request is not asked for an interview date.
   */
  fields: MaterialField[];
  /** Whether a target job is required. */
  requiresJob: boolean;
  /** Whether a stored template can be used as the starting point. */
  supportsTemplate: boolean;
  /** Whether a PDF export makes sense. */
  supportsPdf: boolean;
  /** Whether a subject line is meaningful. */
  supportsSubject: boolean;
  /**
   * Template categories that suit this material, matching the existing
   * `FollowUpTemplate.type` vocabulary. Preserved rather than renamed, so
   * templates users already saved keep working.
   */
  templateTypes: readonly string[];
};

export type MaterialField =
  | 'JOB'
  | 'CONTACT'
  | 'RECIPIENT_NAME'
  | 'INTERVIEW_DATE'
  | 'INTERVIEWER'
  | 'CONVERSATION'
  | 'WHY_CONTACT'
  | 'SHARED_CONTEXT'
  | 'OBJECTIVE'
  | 'INTERVIEW_NOTES'
  | 'KEY_POINTS'
  | 'STAGE';

export const MATERIAL_TYPE_META: Record<MaterialType, MaterialTypeMeta> = {
  COVER_LETTER: {
    label: 'Cover letter',
    description:
      'A tailored letter for a specific role, written from your confirmed career profile and the real job description.',
    fields: ['JOB', 'STAGE', 'OBJECTIVE'],
    requiresJob: true,
    supportsTemplate: true,
    supportsPdf: true,
    supportsSubject: true,
    templateTypes: ['intro'],
  },
  RECRUITER_OUTREACH: {
    label: 'Recruiter message',
    description:
      'A professional first message to a recruiter or hiring contact, grounded in the role and your real background.',
    fields: ['JOB', 'CONTACT', 'RECIPIENT_NAME', 'WHY_CONTACT'],
    requiresJob: false,
    supportsTemplate: true,
    supportsPdf: false,
    supportsSubject: true,
    templateTypes: ['intro', 'referral'],
  },
  LINKEDIN_CONNECTION: {
    label: 'LinkedIn connection request',
    description:
      'A short connection note. We generate a reasonable length target rather than claiming to match any platform rule.',
    fields: ['JOB', 'CONTACT', 'RECIPIENT_NAME', 'SHARED_CONTEXT'],
    requiresJob: false,
    supportsTemplate: true,
    supportsPdf: false,
    supportsSubject: false,
    templateTypes: ['intro'],
  },
  APPLICATION_FOLLOW_UP: {
    label: 'Application follow-up',
    description:
      'A follow-up after submitting an application. Only available once your pipeline shows this role as applied or beyond.',
    fields: ['JOB', 'STAGE', 'CONTACT', 'RECIPIENT_NAME', 'OBJECTIVE'],
    requiresJob: true,
    supportsTemplate: true,
    supportsPdf: false,
    supportsSubject: true,
    templateTypes: ['follow_up', 'check_in'],
  },
  APPLICATION_STATUS_CHECK: {
    label: 'Application status check',
    description:
      'A brief, courteous check on where an application stands. Used when a role has gone quiet.',
    fields: ['JOB', 'STAGE', 'CONTACT', 'RECIPIENT_NAME'],
    requiresJob: true,
    supportsTemplate: true,
    supportsPdf: false,
    supportsSubject: true,
    templateTypes: ['check_in', 'follow_up'],
  },
  INTERVIEW_THANK_YOU: {
    label: 'Interview thank-you',
    description:
      'A thank-you after a real interview, referencing what actually happened. Requires a recorded interview or your own notes.',
    fields: ['JOB', 'STAGE', 'INTERVIEW_DATE', 'INTERVIEWER', 'CONTACT', 'INTERVIEW_NOTES', 'KEY_POINTS'],
    requiresJob: true,
    supportsTemplate: true,
    supportsPdf: false,
    supportsSubject: true,
    templateTypes: ['thank_you'],
  },
};

/**
 * Material types whose honesty depends on a real application record.
 *
 * The service refuses to generate these unless the job genuinely supports the
 * claim. A follow-up that says "I wanted to follow up on my application" for a
 * role the user has not applied to is a fabricated fact, so it is not produced.
 */
export const APPLICATION_GROUNDED_TYPES: readonly MaterialType[] = [
  'APPLICATION_FOLLOW_UP',
  'APPLICATION_STATUS_CHECK',
  'INTERVIEW_THANK_YOU',
];

/**
 * Job statuses that represent a submitted application.
 *
 * `APPLYING` is included deliberately: the existing product treats it as part of
 * the applied column, and a user mid-application is not making a false claim
 * when they follow up about it. `LEAD` and `SAVED` are not.
 */
export const APPLIED_STATUSES: readonly string[] = ['APPLYING', 'APPLIED', 'INTERVIEWING', 'OFFER'];

/**
 * Materials that describe an interview need real interview evidence: either a
 * scheduled interview in the job's own record, or notes the user supplied
 * themselves. Never inferred from the job status alone.
 */
export const INTERVIEW_GROUNDED_TYPES: readonly MaterialType[] = ['INTERVIEW_THANK_YOU'];

// ─── Evidence sources ───────────────────────────────────────────────────────

/**
 * Where a claim came from.
 *
 * Labels match the real field paths in this repository, so a reviewer can look
 * the value up. `JOB_INTELLIGENCE` is deliberately separate from
 * `JOB_DESCRIPTION`: an AI analysis of a posting is the model's reading of
 * third-party text, not a verified fact about the employer.
 */
export const EVIDENCE_SOURCES = [
  'CAREER_PROFILE',
  'WORK_EXPERIENCE',
  'RESUME',
  'JOB_DESCRIPTION',
  'JOB_METADATA',
  'JOB_INTELLIGENCE',
  'APPLICATION_RECORD',
  'USER_INSTRUCTIONS',
  'USER_CONFIRMED_CONTEXT',
  'TEMPLATE',
] as const;

export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

export const evidenceSourceSchema = z.enum(EVIDENCE_SOURCES);

export const EVIDENCE_SOURCE_LABELS: Record<EvidenceSource, string> = {
  CAREER_PROFILE: 'Your career profile',
  WORK_EXPERIENCE: 'Your work experience',
  RESUME: 'Your selected resume',
  JOB_DESCRIPTION: 'The job description',
  JOB_METADATA: 'The role details',
  JOB_INTELLIGENCE: 'Your saved job analysis',
  APPLICATION_RECORD: 'Your application record',
  USER_INSTRUCTIONS: 'Your instructions',
  USER_CONFIRMED_CONTEXT: 'Context you confirmed',
  TEMPLATE: 'Your template',
};

/**
 * Which sources describe the CANDIDATE, as opposed to the role.
 *
 * This distinction drives verification: a claim about the candidate must be
 * grounded in one of these, never in the job description. "The role asks for
 * Kubernetes and the posting mentions Kubernetes" is not evidence that the
 * candidate can use Kubernetes.
 */
export const CANDIDATE_SOURCES: readonly EvidenceSource[] = [
  'CAREER_PROFILE',
  'WORK_EXPERIENCE',
  'RESUME',
  'USER_INSTRUCTIONS',
  'USER_CONFIRMED_CONTEXT',
];

/**
 * Sources whose text we hold verbatim and can therefore re-quote.
 *
 * `JOB_INTELLIGENCE` is absent on purpose: it is model output, so an excerpt
 * attributed to it cannot be verified against a source of truth and is treated
 * as an unverified claim rather than as evidence.
 */
export const QUOTABLE_SOURCES: readonly EvidenceSource[] = [
  'CAREER_PROFILE',
  'WORK_EXPERIENCE',
  'RESUME',
  'JOB_DESCRIPTION',
  'JOB_METADATA',
  'APPLICATION_RECORD',
  'USER_INSTRUCTIONS',
  'USER_CONFIRMED_CONTEXT',
  'TEMPLATE',
];
