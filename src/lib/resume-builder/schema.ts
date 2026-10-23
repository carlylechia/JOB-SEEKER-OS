/**
 * Structured resume contract.
 *
 * Two ideas govern this file.
 *
 * 1. THE RESUME IS A DOCUMENT, NOT A BLOB OF PROSE. Every section is a typed,
 *    validated array of typed entries. A work role is not a paragraph; it is a
 *    title, a company, dates, and two bounded lists of bullets. That is what
 *    makes reordering, templating, job-specific optimisation and PDF export
 *    possible at all — none of them could be done honestly on a wall of text.
 *
 * 2. NOTHING HERE IS INFERRED. A field the user has not filled in is absent or
 *    empty, never guessed. `resumeFromCareerProfile()` copies confirmed values
 *    verbatim; it does not extrapolate a title from a company, a date from a
 *    start date, or a skill from a job description.
 *
 * Unlike the AI extraction contract in `src/lib/resume/schema.ts`, this schema
 * is NOT required to be "pure" — it is never handed to OpenAI's Structured
 * Outputs mode as the model's output shape, and it benefits from real
 * validation (date ranges, list caps, URL shapes). The AI contract that this
 * release adds lives in `optimization/schema.ts` and follows the pure rule.
 */

import { z } from 'zod';
import { TEMPLATE_KEYS, ACCENT_KEYS, DENSITY_VALUES, PAGE_SIZE_KEYS } from './templates';

// ─── Limits ─────────────────────────────────────────────────────────────────
//
// Bounded server-side. These are the only place the numbers live; nothing else
// in the codebase hardcodes a length.

export const RESUME_MAX_NAME_LENGTH = 120;
export const RESUME_MAX_EXPERIENCES = 25;
export const RESUME_MAX_EDUCATION = 15;
export const RESUME_MAX_SKILLS = 80;
export const RESUME_MAX_PROJECTS = 20;
export const RESUME_MAX_CREDENTIALS = 40;
export const RESUME_MAX_BULLETS = 20;
export const RESUME_MAX_SUMMARY_LENGTH = 2000;
export const RESUME_MAX_SHORT_TEXT = 240;
export const RESUME_MAX_BULLET_LENGTH = 1200;
export const RESUME_MAX_URL = 500;
export const RESUME_MAX_HIDDEN_SECTIONS = 12;

// ─── Primitives ─────────────────────────────────────────────────────────────

/**
 * A trimmed string, or null.
 *
 * `null` and `''` mean the same thing to a person ("they did not fill this in"),
 * so every helper below treats them identically. Normalising at the edge means
 * the rest of the application never has to.
 *
 * `.default(null)` rather than `.optional()` so a partial payload and a complete
 * payload produce the identical stored document — there is no "field absent"
 * state to handle downstream.
 */
const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((value) => {
      if (typeof value !== 'string') return null;
      const trimmed = value.trim();
      return trimmed.length === 0 ? null : trimmed;
    })
    .default(null);

const requiredText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max, `Must be ${max} characters or fewer`);

/**
 * A user-entered URL, reduced to http(s) or null.
 *
 * `mailto:` and `javascript:` are rejected outright. This matters because the
 * value ends up in a downloadable document, and a `javascript:` URL there is a
 * script injection vector aimed at whoever opens the file.
 */
export const safeUrlSchema = z
  .string()
  .max(RESUME_MAX_URL)
  .nullish()
  .transform((value, ctx) => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Enter a valid http or https address.',
      });
      return z.NEVER;
    }
    // `javascript:`, `data:` and friends would become a script vector in a
    // document the recipient opens. Refused outright, not sanitised.
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Only http and https addresses are allowed.',
      });
      return z.NEVER;
    }
    return parsed.toString();
  })
  .default(null);

/**
 * A month-precision date: `YYYY-MM`, optionally `YYYY-MM-DD`.
 *
 * Free-text is accepted here on purpose — people type "Jan 2021" — and
 * normalised below. What is NOT accepted is a bare year, because a resume that
 * claims a role lasted exactly "2021" is making a precision claim it cannot
 * support, and "2021" next to "2021" renders as an empty range.
 */
const rawDateSchema = z
  .string()
  .max(24)
  .nullish()
  .transform((value) => (typeof value === 'string' ? value.trim() || null : null))
  .default(null);

const MONTH_NAMES: Record<string, string> = {
  jan: '01', january: '01',
  feb: '02', february: '02',
  mar: '03', march: '03',
  apr: '04', april: '04',
  may: '05',
  jun: '06', june: '06',
  jul: '07', july: '07',
  aug: '08', august: '08',
  sep: '09', sept: '09', september: '09',
  oct: '10', october: '10',
  nov: '11', november: '11',
  dec: '12', december: '12',
};

/**
 * Normalise a date to `YYYY-MM`, or return null when it cannot be read.
 *
 * `null` is a first-class outcome. "We could not read that date" is shown to
 * the user as needing attention rather than being silently replaced with a
 * guess, because a guessed employment date is a fabricated employment date.
 */
export function normalizeResumeDate(input: string | null | undefined): string | null {
  if (!input) return null;
  const value = input.trim().toLowerCase();
  if (value.length === 0) return null;

  // Already `YYYY-MM` or `YYYY-MM-DD`.
  const iso = /^(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?$/.exec(value);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    if (month < 1 || month > 12) return null;
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
  }

  // `Jan 2021`, `January 2021`, `Jan/2021`, `2021 Jan`.
  const named = /^([a-z]{3,9})\.?\s*[\s/-]*,?\s*(\d{4})$/.exec(value);
  if (named) {
    const month = MONTH_NAMES[named[1]];
    return month ? `${named[2]}-${month}` : null;
  }
  const reversedNamed = /^(\d{4})\s*[\s/-]+([a-z]{3,9})\.?$/.exec(value);
  if (reversedNamed) {
    const month = MONTH_NAMES[reversedNamed[2]];
    return month ? `${reversedNamed[1]}-${month}` : null;
  }

  return null;
}

const resumeDateSchema = rawDateSchema.transform((value, ctx) => {
  const normalised = normalizeResumeDate(value);
  // An unreadable date is kept verbatim rather than dropped, so the editor can
  // show the user what they typed and ask them to fix it. Dropping it would
  // delete their data without telling them.
  if (value !== null && normalised === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Use a month and year, for example "2024-03" or "Mar 2024".',
    });
    return z.NEVER;
  }
  return normalised;
});

/** `YYYY-MM` sortable string, or `null`. Used for chronology checks. */
export function dateSortKey(date: string | null): number | null {
  if (!date) return null;
  const parsed = /^(\d{4})-(\d{2})$/.exec(date);
  if (!parsed) return null;
  return Number(parsed[1]) * 12 + Number(parsed[2]);
}

// ─── Sections ───────────────────────────────────────────────────────────────

export const basicsSchema = z
  .object({
    fullName: optionalText(RESUME_MAX_SHORT_TEXT),
    headline: optionalText(400),
    email: optionalText(320),
    phone: optionalText(RESUME_MAX_SHORT_TEXT),
    location: optionalText(RESUME_MAX_SHORT_TEXT),
    linkedinUrl: safeUrlSchema,
    portfolioUrl: safeUrlSchema,
    websiteUrl: safeUrlSchema,
  })
  .strict();

export type ResumeBasics = z.infer<typeof basicsSchema>;

export const summarySchema = z
  .string()
  .max(RESUME_MAX_SUMMARY_LENGTH)
  .nullish()
  .transform((value) => (typeof value === 'string' ? value.trim() || null : null))
  .default(null);

export const bulletSchema = z
  .string()
  .max(RESUME_MAX_BULLET_LENGTH)
  .transform((value) => value.trim())
  // An empty bullet is an editing artefact, not content. Dropping it here means
  // every renderer downstream can assume `bullets` contains no blanks, which is
  // what keeps "no empty lines in the PDF" true without special cases.
  .pipe(z.string().min(1))
  .nullable();

/** Normalise a bullet list: trim, drop blanks, de-duplicate, cap the count. */
function normaliseBullets(value: unknown): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  if (!Array.isArray(value)) return out;
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (trimmed.length === 0) continue;
    // Case-insensitive de-duplication: the same achievement pasted twice reads
    // as padding, which is exactly what this feature must not produce.
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= RESUME_MAX_BULLETS) break;
  }
  return out;
}

export const experienceSchema = z
  .object({
    id: requiredText(64),
    jobTitle: optionalText(RESUME_MAX_SHORT_TEXT),
    company: optionalText(RESUME_MAX_SHORT_TEXT),
    location: optionalText(RESUME_MAX_SHORT_TEXT),
    startDate: resumeDateSchema,
    endDate: resumeDateSchema,
    /** True while the user is in this role. Forces `endDate` to be ignored. */
    isCurrent: z.boolean().default(false),
    responsibilities: z.array(z.string().max(RESUME_MAX_BULLET_LENGTH)).max(RESUME_MAX_BULLETS).default([]),
    achievements: z.array(z.string().max(RESUME_MAX_BULLET_LENGTH)).max(RESUME_MAX_BULLETS).default([]),
    technologies: z.array(z.string().max(RESUME_MAX_SHORT_TEXT)).max(40).default([]),
    /**
     * Where this entry came from, for display only.
     *
     * `CAREER_PROFILE` means the user confirmed it in their profile, so it can
     * be presented as their own confirmed history. `USER` means they typed it
     * here. `AI` is not accepted — a resume entry the model invented is exactly
     * what this product refuses to ship, so there is no code path that creates
     * one.
     */
    origin: z.enum(['USER', 'CAREER_PROFILE']).default('USER'),
    evidenceSnippet: optionalText(400),
  })
  .strict()
  .superRefine((value, ctx) => {
    // A current role with an end date is contradictory. Rather than silently
    // preferring one, the end date is dropped and the fact is reported so the
    // editor can show it.
    if (value.isCurrent && value.endDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: 'A current role cannot have an end date.',
      });
    }
    if (!value.isCurrent && value.startDate && value.endDate) {
      const start = dateSortKey(value.startDate);
      const end = dateSortKey(value.endDate);
      if (start !== null && end !== null && end < start) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['endDate'],
          message: 'The end date is before the start date.',
        });
      }
    }
  })
  .transform((value) => ({
    ...value,
    responsibilities: normaliseBullets(value.responsibilities),
    achievements: normaliseBullets(value.achievements),
    technologies: normaliseBullets(value.technologies).map((t) => t.slice(0, RESUME_MAX_SHORT_TEXT)),
  }));

export type ResumeExperience = z.infer<typeof experienceSchema>;

export const educationSchema = z
  .object({
    id: requiredText(64),
    institution: optionalText(RESUME_MAX_SHORT_TEXT),
    qualification: optionalText(RESUME_MAX_SHORT_TEXT),
    fieldOfStudy: optionalText(RESUME_MAX_SHORT_TEXT),
    startDate: resumeDateSchema,
    endDate: resumeDateSchema,
    details: optionalText(RESUME_MAX_BULLET_LENGTH),
    origin: z.enum(['USER', 'CAREER_PROFILE']).default('USER'),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.startDate && value.endDate) {
      const start = dateSortKey(value.startDate);
      const end = dateSortKey(value.endDate);
      if (start !== null && end !== null && end < start) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['endDate'],
          message: 'The end date is before the start date.',
        });
      }
    }
  });

export type ResumeEducation = z.infer<typeof educationSchema>;

export const skillSchema = z
  .object({
    id: requiredText(64),
    name: requiredText(RESUME_MAX_SHORT_TEXT),
    /** Optional grouping the user maintains, e.g. "Languages", "Backend". */
    category: optionalText(RESUME_MAX_SHORT_TEXT),
    /**
     * Provenance of the skill.
     *
     * `STATED` / `SUPPORTED` / `INFERRED` are carried through verbatim from
     * `CareerSkill.origin` so an inferred skill is never silently presented as
     * a verified one. `USER` means the user typed it here directly.
     */
    origin: z.enum(['USER', 'STATED', 'SUPPORTED', 'INFERRED']).default('USER'),
  })
  .strict();

export type ResumeSkill = z.infer<typeof skillSchema>;

export const projectSchema = z
  .object({
    id: requiredText(64),
    name: optionalText(RESUME_MAX_SHORT_TEXT),
    description: optionalText(RESUME_MAX_BULLET_LENGTH),
    role: optionalText(RESUME_MAX_SHORT_TEXT),
    technologies: z.array(z.string().max(RESUME_MAX_SHORT_TEXT)).max(30).default([]),
    startDate: resumeDateSchema,
    endDate: resumeDateSchema,
    projectUrl: safeUrlSchema,
    results: z.array(z.string().max(RESUME_MAX_BULLET_LENGTH)).max(15).default([]),
    origin: z.enum(['USER', 'CAREER_PROFILE']).default('USER'),
  })
  .strict()
  .transform((value) => ({
    ...value,
    technologies: normaliseBullets(value.technologies).map((t) => t.slice(0, RESUME_MAX_SHORT_TEXT)),
    results: normaliseBullets(value.results),
  }));

export type ResumeProject = z.infer<typeof projectSchema>;

export const credentialKindSchema = z.enum([
  'CERTIFICATION',
  'LICENSE',
  'LANGUAGE',
  'AWARD',
  'PUBLICATION',
  'VOLUNTEER',
]);

export const credentialSchema = z
  .object({
    id: requiredText(64),
    kind: credentialKindSchema,
    name: requiredText(RESUME_MAX_SHORT_TEXT),
    issuer: optionalText(RESUME_MAX_SHORT_TEXT),
    issuedDate: resumeDateSchema,
    expiresDate: resumeDateSchema,
    proficiency: optionalText(RESUME_MAX_SHORT_TEXT),
    details: optionalText(RESUME_MAX_BULLET_LENGTH),
    origin: z.enum(['USER', 'CAREER_PROFILE']).default('USER'),
  })
  .strict();

export type ResumeCredential = z.infer<typeof credentialSchema>;

// ─── The document ───────────────────────────────────────────────────────────

/** An all-null basics block. Used as the default for a document with none. */
export function emptyResumeBasics(): ResumeBasics {
  return basicsSchema.parse({});
}

export const resumeContentSchema = z
  .object({
    basics: basicsSchema.default(emptyResumeBasics()),
    summary: summarySchema,
    experiences: z.array(experienceSchema).max(RESUME_MAX_EXPERIENCES).default([]),
    education: z.array(educationSchema).max(RESUME_MAX_EDUCATION).default([]),
    skills: z.array(skillSchema).max(RESUME_MAX_SKILLS).default([]),
    projects: z.array(projectSchema).max(RESUME_MAX_PROJECTS).default([]),
    credentials: z.array(credentialSchema).max(RESUME_MAX_CREDENTIALS).default([]),
  })
  .strict();

export type ResumeContent = z.infer<typeof resumeContentSchema>;

/** An empty document. The starting point for every blank resume. */
export function emptyResumeContent(): ResumeContent {
  return resumeContentSchema.parse({});
}

/**
 * Section keys, in the order they render.
 *
 * Order is part of the contract: it is what makes "logical content order" true
 * for the exported document, and it is the order the editor's navigation uses.
 * Experience comes before education because that is the convention in every
 * ATS and every recruiter's eye; skills sit high because they are what gets
 * keyword-matched.
 */
export const RESUME_SECTION_KEYS = [
  'summary',
  'experience',
  'skills',
  'education',
  'projects',
  'credentials',
] as const;

export type ResumeSectionKey = (typeof RESUME_SECTION_KEYS)[number];

export const SECTION_LABELS: Record<ResumeSectionKey, string> = {
  summary: 'Professional Summary',
  experience: 'Work Experience',
  skills: 'Skills',
  education: 'Education',
  projects: 'Projects',
  credentials: 'Certifications & Awards',
};

/**
 * Sections a user may hide without deleting.
 *
 * Hiding is presentation only: the content stays in the document, stays
 * exportable by turning the setting back on, and is still included in any AI
 * optimisation (a hidden bullet is still a true statement the user has made).
 */
export const HIDABLE_SECTION_KEYS = RESUME_SECTION_KEYS;

// ─── Request contracts ──────────────────────────────────────────────────────

export const templateKeySchema = z.enum(TEMPLATE_KEYS);
export const accentKeySchema = z.enum(ACCENT_KEYS);
export const pageSizeSchema = z.enum(PAGE_SIZE_KEYS);
export const densitySchema = z
  .number()
  .int()
  .refine((value) => (DENSITY_VALUES as readonly number[]).includes(value), {
    message: 'Unsupported density.',
  });

export const createResumeSchema = z
  .object({
    /** What to start from. `DUPLICATE` requires `sourceResumeId`. */
    from: z.enum(['BLANK', 'PROFILE', 'DUPLICATE']).default('BLANK'),
    name: z.string().trim().min(1).max(RESUME_MAX_NAME_LENGTH).optional(),
    /** Server-verified to belong to the caller. Never trusted as-is. */
    sourceResumeId: z.string().max(64).nullable().optional(),
    targetJobId: z.string().max(64).nullable().optional(),
    pageSize: pageSizeSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.from === 'DUPLICATE' && !value.sourceResumeId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sourceResumeId'],
        message: 'Choose a resume to duplicate.',
      });
    }
    if (value.from !== 'DUPLICATE' && value.sourceResumeId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sourceResumeId'],
        message: 'A source resume is only used when duplicating.',
      });
    }
  });

export type CreateResumeInput = z.infer<typeof createResumeSchema>;

/**
 * A partial update.
 *
 * Every field is optional, so a save that only renames a resume does not have
 * to resend the whole document — but a field that IS present fully replaces the
 * stored one. Merge semantics for nested sections would make "remove this
 * bullet" inexpressible.
 *
 * Note what is absent: `userId`, `origin`, `revision`, `sourceResumeId` and
 * `sourceProfileVersion` are server-owned. A payload carrying them fails
 * validation rather than being quietly ignored.
 */
export const updateResumeSchema = z
  .object({
    /** The revision this edit was built from. A mismatch is a 409. */
    expectedRevision: z.number().int().min(1),
    name: z.string().trim().min(1).max(RESUME_MAX_NAME_LENGTH).optional(),
    content: resumeContentSchema.optional(),
    templateKey: templateKeySchema.optional(),
    accentKey: accentKeySchema.optional(),
    density: densitySchema.optional(),
    hiddenSections: z
      .array(z.enum(HIDABLE_SECTION_KEYS))
      .max(RESUME_MAX_HIDDEN_SECTIONS)
      .optional(),
    targetJobId: z.string().max(64).nullable().optional(),
    pageSize: pageSizeSchema.optional(),
  })
  .strict();

export type UpdateResumeInput = z.infer<typeof updateResumeSchema>;

/**
 * The preview request.
 *
 * Unsaved draft values are allowed here on purpose: switching template or
 * accent must show its result immediately, without a save round trip and
 * without persisting anything the user did not ask to persist.
 */
export const previewRequestSchema = z
  .object({
    content: resumeContentSchema.optional(),
    templateKey: templateKeySchema.optional(),
    accentKey: accentKeySchema.optional(),
    density: densitySchema.optional(),
    hiddenSections: z.array(z.enum(HIDABLE_SECTION_KEYS)).max(RESUME_MAX_HIDDEN_SECTIONS).optional(),
    pageSize: pageSizeSchema.optional(),
  })
  .strict();

export type PreviewRequest = z.infer<typeof previewRequestSchema>;

/** A job the user may target, as offered by the editor's picker. */
export const targetableJobSchema = z.object({
  id: z.string(),
  title: z.string(),
  company: z.string(),
  status: z.string(),
  hasDescription: z.boolean(),
  updatedAt: z.string(),
});

export type TargetableJob = z.infer<typeof targetableJobSchema>;
