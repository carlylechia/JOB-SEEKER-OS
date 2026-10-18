/**
 * Versioned extraction contract for Resume Intelligence.
 *
 * Two rules govern everything in this file:
 *
 *  1. The schema describes RESUME FACTS, not a prompt response. Every field is
 *     either a value the document actually supports, or `null`. There is no
 *     field the model can fill "to be helpful".
 *
 *  2. The schema is PURE. No `.refine()`, no `.transform()`, no `.catch()`,
 *     no `.trim()`. OpenAI's strict Structured Outputs mode refuses those, and
 *     a contract that cannot be expressed as strict JSON Schema cannot be
 *     enforced by the provider. Anything that needs judgement (trimming,
 *     evidence classification, conflict detection) happens in
 *     `normalise.ts` / `career-profile.ts` against server-side code.
 *
 * Bumping `EXTRACTION_SCHEMA_VERSION` invalidates cached extractions: the
 * `(resumeId, contentHash, schemaVersion)` key changes, so an old result is
 * never silently reused under a newer contract.
 */

import { z } from 'zod';

export const EXTRACTION_SCHEMA_VERSION = 1;

/** Schema name registered with the provider's structured-output format. */
export const EXTRACTION_SCHEMA_NAME = 'career_extraction';

/**
 * How much we trust a value, expressed in the product's vocabulary rather than
 * as a model-reported probability.
 *
 * A confidence float from the model is not evidence — it is the model's opinion
 * of its own output. These three states are claims we can actually verify:
 * "this string is in the document", "this needs a human", "we proposed it".
 */
export const evidenceLevelSchema = z.enum(['SUPPORTED', 'NEEDS_REVIEW', 'SUGGESTED']);
export type EvidenceLevel = z.infer<typeof evidenceLevelSchema>;

/** Short, bounded text. Generous enough for a real bullet, capped defensively. */
const text = z.string().max(1200);
const shortText = z.string().max(240);
const url = z.string().max(500);

/**
 * Traceability for a single extracted value.
 *
 * `snippet` is meant to be copied verbatim from the resume. The review UI shows
 * it next to the value, so a user can check the claim without re-reading the
 * whole document. A claim without a snippet is still allowed — it just shows up
 * as needing review instead of supported.
 */
const evidenceSchema = z.object({
  snippet: z.string().max(400).nullable(),
  /** Resume section the value came from, e.g. "Experience", "Education". */
  section: z.string().max(80).nullable(),
  level: evidenceLevelSchema,
});

export type Evidence = z.infer<typeof evidenceSchema>;

/**
 * Where a skill came from.
 *
 * `STATED` is a skills section or an explicit claim. `SUPPORTED` is a named
 * technology in a role description. `INFERRED` is the model's judgement — it is
 * surfaced to the user but must never be auto-promoted to a verified skill.
 */
export const skillOriginSchema = z.enum(['STATED', 'SUPPORTED', 'INFERRED']);
export type SkillOrigin = z.infer<typeof skillOriginSchema>;

export const skillSchema = z.object({
  name: shortText,
  origin: skillOriginSchema,
  evidence: evidenceSchema,
});
export type SkillExtraction = z.infer<typeof skillSchema>;

export const workExperienceSchema = z.object({
  jobTitle: shortText.nullable(),
  company: shortText.nullable(),
  location: shortText.nullable(),
  /** `YYYY-MM`, or null when the resume does not say. Never inferred. */
  startDate: z.string().max(16).nullable(),
  endDate: z.string().max(16).nullable(),
  isCurrent: z.boolean(),
  responsibilities: z.array(text).max(20),
  achievements: z.array(text).max(20),
  /** Skills this role's description explicitly supports, with their own proof. */
  technologies: z.array(skillSchema).max(40),
  evidence: evidenceSchema,
  /**
   * Contradictions the document itself contains (two different date ranges for
   * one role, two titles at one company). Surfaced rather than resolved.
   */
  conflicts: z.array(shortText).max(5),
});

export type WorkExperienceExtraction = z.infer<typeof workExperienceSchema>;

export const educationSchema = z.object({
  institution: shortText.nullable(),
  qualification: shortText.nullable(),
  fieldOfStudy: shortText.nullable(),
  startDate: z.string().max(16).nullable(),
  endDate: z.string().max(16).nullable(),
  details: text.nullable(),
  evidence: evidenceSchema,
  conflicts: z.array(shortText).max(5),
});

export type EducationExtraction = z.infer<typeof educationSchema>;

export const projectSchema = z.object({
  name: shortText.nullable(),
  description: text.nullable(),
  role: shortText.nullable(),
  technologies: z.array(shortText).max(30),
  startDate: z.string().max(16).nullable(),
  endDate: z.string().max(16).nullable(),
  projectUrl: url.nullable(),
  results: z.array(text).max(15),
  evidence: evidenceSchema,
  conflicts: z.array(shortText).max(5),
});

export type ProjectExtraction = z.infer<typeof projectSchema>;

/**
 * Certifications, licences, languages, awards, publications and volunteer work
 * share one shape. They differ in `kind` and in whether `proficiency` applies,
 * and future resume generation treats them uniformly, so splitting them into
 * six parallel arrays would add structure without adding meaning.
 */
export const credentialKindSchema = z.enum([
  'CERTIFICATION',
  'LICENSE',
  'LANGUAGE',
  'AWARD',
  'PUBLICATION',
  'VOLUNTEER',
]);

export const credentialSchema = z.object({
  kind: credentialKindSchema,
  /** Name of the certification/award/publication, or the language. */
  name: shortText,
  /** Issuing body, publisher, or awarding organisation. */
  issuer: shortText.nullable(),
  issuedDate: z.string().max(16).nullable(),
  expiresDate: z.string().max(16).nullable(),
  /** Only meaningful for `LANGUAGE`; null otherwise. */
  proficiency: shortText.nullable(),
  details: text.nullable(),
  evidence: evidenceSchema,
});

export type CredentialExtraction = z.infer<typeof credentialSchema>;

export const professionalLinkSchema = z.object({
  label: shortText,
  url,
});

/**
 * The full extraction. Every section is an array that may legitimately be
 * empty, and every scalar may be `null` — "not in the resume" is a valid,
 * expected outcome, not an error.
 */
/**
 * STRICT, not merely typed.
 *
 * Zod's default is to strip unknown keys, which would silently discard an
 * unexpected field a provider emitted. Here an unexpected field is an error,
 * because a response containing a key we do not recognise means the contract
 * has drifted — and silently dropping it would let a future, subtler version of
 * the same problem through. This also means a response carrying `plan`,
 * `userId` or `tools` cannot validate, which the test suite asserts.
 */
export const careerExtractionSchema = z
  .object({
    schemaVersion: z.number(),

  // ── A. Basic profile ──────────────────────────────────────────────────────
  fullName: shortText.nullable(),
  email: z.string().max(320).nullable(),
  phone: shortText.nullable(),
  city: shortText.nullable(),
  region: shortText.nullable(),
  country: shortText.nullable(),
  headline: z.string().max(400).nullable(),
  summary: text.nullable(),
  linkedinUrl: url.nullable(),
  portfolioUrl: url.nullable(),
  websiteUrl: url.nullable(),
  otherLinks: z.array(professionalLinkSchema).max(10),

  // ── B. Work experience ────────────────────────────────────────────────────
  workExperience: z.array(workExperienceSchema).max(25),

  // ── C. Education ──────────────────────────────────────────────────────────
  education: z.array(educationSchema).max(15),

  // ── D. Skills ─────────────────────────────────────────────────────────────
  skills: z.array(skillSchema).max(80),

  // ── E. Projects ───────────────────────────────────────────────────────────
  projects: z.array(projectSchema).max(20),

  // ── F. Additional qualifications ──────────────────────────────────────────
  credentials: z.array(credentialSchema).max(40),

  /**
   * Document-level problems worth telling the user about: an unreadable
   * section, two employers for one date range, a page that appears to be
   * missing. Rendered as warnings, never silently swallowed.
   */
  warnings: z.array(shortText).max(20),
  })
  .strict();

export type CareerExtraction = z.infer<typeof careerExtractionSchema>;

export const extractionResultSchema = z.object({
  extraction: careerExtractionSchema,
});

export type ExtractionResult = z.infer<typeof extractionResultSchema>;

/** Why a stored extraction could not be used. Persisted and surfaced verbatim. */
export type ExtractionErrorCode =
  | 'UNSUPPORTED_FORMAT'
  | 'CORRUPT_FILE'
  | 'NO_TEXT_FOUND'
  | 'IMAGE_ONLY_PDF'
  | 'TOO_LARGE'
  | 'PARSE_FAILED'
  | 'AI_NOT_CONFIGURED'
  | 'AI_RATE_LIMITED'
  | 'AI_TIMEOUT'
  | 'AI_REFUSED'
  | 'AI_EMPTY_RESPONSE'
  | 'AI_INVALID_RESPONSE'
  | 'AI_UNAVAILABLE';

export type ResumeExtractionStatus = 'PROCESSING' | 'COMPLETED' | 'FAILED';

/** Human copy for a stored extraction failure. Safe to show to the user. */
export const EXTRACTION_ERROR_MESSAGES: Record<ExtractionErrorCode, string> = {
  UNSUPPORTED_FORMAT: 'That file type is not supported. Upload a PDF, DOCX or TXT resume.',
  CORRUPT_FILE: 'We could not open that document. It may be damaged — try exporting it again.',
  NO_TEXT_FOUND: 'We could not find any readable text in that file.',
  IMAGE_ONLY_PDF:
    'That PDF looks like a scan or image, so there is no text to read. Upload a text-based PDF, or copy the text into a .txt file.',
  TOO_LARGE: 'That document is too large to analyze.',
  PARSE_FAILED: 'We hit a problem reading that document. Please try a different file.',
  AI_NOT_CONFIGURED:
    'Resume analysis is not available right now. Our team has been notified — please try again later.',
  AI_RATE_LIMITED: 'Our analysis service is busy. Please wait a moment and try again.',
  AI_TIMEOUT: 'Analysis took too long and stopped. Please try again.',
  AI_REFUSED: 'Our analysis provider could not process that document.',
  AI_EMPTY_RESPONSE: 'The analysis returned no usable results. Please try again.',
  AI_INVALID_RESPONSE: 'The analysis returned results we could not verify. Please try again.',
  AI_UNAVAILABLE: 'Our analysis service is temporarily unavailable. Please try again.',
};