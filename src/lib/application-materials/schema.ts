/**
 * The generation contract for application materials.
 *
 * The same three rules govern this file as govern
 * `src/lib/job-intelligence/schema.ts` and
 * `src/lib/resume-builder/optimization/schema.ts`:
 *
 *  1. The schema describes PROPOSED CONTENT, not a conversation. There is no
 *     field the model can fill "to be helpful", and no field that can change
 *     state, identify a record, or name another user.
 *
 *  2. The schema is PURE. No `.refine()`, no `.transform()`, no `.catch()`,
 *     no `.trim()` — OpenAI's strict Structured Outputs mode refuses those, and
 *     a contract that cannot be expressed as strict JSON Schema cannot be
 *     enforced by the provider. Every judgement call (bounding, excerpt
 *     re-checking, numeric scanning, fabrication removal) happens in `verify.ts`
 *     against server-side code.
 *
 *  3. What the model does NOT return is the point. It never writes the
 *     greeting, the sign-off or the salutation, so an invented recipient name is
 *     structurally impossible rather than merely discouraged.
 *
 * Bumping `MATERIAL_SCHEMA_VERSION` invalidates reuse: the fingerprint changes,
 * so an older result is never silently served under a newer contract.
 */

import { z } from 'zod';
import { EVIDENCE_SOURCES } from './materials';

export const MATERIAL_SCHEMA_VERSION = 1;

/** Schema name registered with the provider's structured-output format. */
export const MATERIAL_SCHEMA_NAME = 'application_material';

/**
 * Bumped when the PROMPT changes but the output shape does not, so a prompt
 * tweak invalidates a cached draft without pretending the contract changed.
 */
export const MATERIAL_PROMPT_VERSION = 2;

// ─── Claims and evidence ────────────────────────────────────────────────────

/**
 * One factual assertion the draft makes about the candidate or the role.
 *
 * `excerpt` is a SHORT verbatim quote. `verify.ts` looks every one of them up in
 * the real source text and drops any it cannot find, so a fabricated quote
 * cannot survive to the database. `status` is re-derived server-side; the
 * model's own opinion of whether it is supported is never trusted.
 */
export const claimSchema = z.object({
  /** The claim, stated plainly. */
  claim: z.string().max(240),
  source: z.enum(EVIDENCE_SOURCES),
  /** Real field path, e.g. "CareerExperience.responsibilities". */
  field: z.string().max(160),
  /** Verbatim quote from that source, or null when none can be given. */
  excerpt: z.string().max(240).nullable(),
});

export type Claim = z.infer<typeof claimSchema>;

// ─── The document ───────────────────────────────────────────────────────────

const sentence = z.string().max(900);
const noteLine = z.string().max(240);

/**
 * What the model returns.
 *
 * Note what is absent: no greeting, no salutation, no sign-off, no user id, no
 * job id, no plan, no tool name, no recipient name. Those are all server-derived
 * in `assemble.ts`, from values the application already holds and has verified.
 */
export const modelMaterialSchema = z
  .object({
    schemaVersion: z.number(),

    /**
     * Optional subject line. Null for materials with no subject. Must be built
     * from the real role, company or recipient name.
     */
    subject: z.string().max(200).nullable(),

    /** Why the candidate wants this, in their own terms. One paragraph. */
    opening: sentence,

    /** The body. Headings are optional; a short message may have none. */
    body: z
      .array(
        z.object({
          heading: z.string().max(120).nullable(),
          text: z.string().max(1_800),
        }),
      )
      .min(1)
      .max(5),

    /** The contribution paragraph. What the candidate would bring, and why. */
    closing: sentence,

    /**
     * Every personal fact asserted anywhere in the draft.
     *
     * This is the contract that makes verification possible. The server
     * re-quotes every excerpt against real source text and scans the prose
     * independently, so a claim the model forgot to list is still caught — but
     * a listed, quotable, correct claim is what keeps good writing from being
     * stripped out.
     */
    claims: z.array(claimSchema).max(12),

    /**
     * Things the user must confirm before sending: an ambiguous date, a role
     * title that needs checking, anything the model inferred rather than read.
     */
    reviewNotes: z.array(noteLine).max(8),

    /**
     * Information that would have improved the draft but is absent.
     *
     * This is the honest channel. It exists so the model can say "I could not
     * find the hiring manager's name" instead of inventing one, and so the UI
     * can show the user what would make the next draft better.
     */
    missingInformation: z.array(noteLine).max(8),

    /**
     * Claims the model wanted to make but could not support, described as the
     * question the candidate should answer for themselves.
     */
    unsupported: z.array(noteLine).max(6),
  })
  .strict();

export type ModelMaterial = z.infer<typeof modelMaterialSchema>;

// ─── What we store and render ───────────────────────────────────────────────

/**
 * Generation metadata. Server-owned.
 *
 * Everything here is computed by the application from what data actually
 * existed. The model contributes nothing.
 */
export const materialMetaSchema = z.object({
  schemaVersion: z.number(),
  promptVersion: z.number(),
  /** SHA-256 over the normalised inputs that produced this draft. */
  inputFingerprint: z.string().max(64),
  generatedAt: z.string().max(40),
  provider: z.string().max(40),
  model: z.string().max(80),
  tone: z.string().max(20),
  length: z.string().max(20),
  /** True when a job description was available to the generation. */
  hadJobDescription: z.boolean(),
  /** True when a confirmed career profile was available. */
  hadConfirmedCareerProfile: z.boolean(),
  /** True when a stored resume was used as context. */
  hadSelectedResume: z.boolean(),
  /** True when a stored template informed the draft. */
  hadTemplate: z.boolean(),
  /** True when earlier materials for this same application were used for continuity. */
  hadPriorMaterials: z.boolean(),
  /** How many earlier materials were included, bounded by the context limit. */
  priorMaterialCount: z.number().int().min(0).max(10),
  /** Real application facts available at generation time. */
  applicationContext: z.enum(['NONE', 'SUBMITTED', 'INTERVIEW_SCHEDULED', 'INTERVIEW_RECORDED']),
  /** True when input context was cut before generation. */
  thinInputs: z.boolean(),
});

export type MaterialMeta = z.infer<typeof materialMetaSchema>;

/**
 * A claim after verification.
 *
 * `status` is assigned by the server, never taken from the model. A claim the
 * server could not verify is kept and labelled, so the user sees what the
 * draft rests on rather than being shown a confident draft of unknown
 * provenance.
 */
export const verifiedClaimSchema = claimSchema.extend({
  status: z.enum(['SUPPORTED', 'UNVERIFIED']),
  /** Set when an excerpt was dropped because it could not be found. */
  note: z.string().max(240).nullable(),
});

export type VerifiedClaim = z.infer<typeof verifiedClaimSchema>;

/**
 * One paragraph of the assembled draft, with its verification outcome.
 *
 * The draft is stored as a flat list of paragraphs rather than a nested
 * structure because that is what the user edits. Verification results travel
 * alongside so the review panel can mark a paragraph without the UI having to
 * re-derive which sentence was removed.
 */
export const draftParagraphSchema = z.object({
  /** 'OPENING' | 'BODY' | 'CLOSING'. Server-assigned. */
  role: z.enum(['OPENING', 'BODY', 'CLOSING']),
  heading: z.string().max(120).nullable(),
  text: z.string().max(1_800),
  /**
   * True when at least one assertion in this paragraph was removed by
   * verification. The UI shows a short note so the user knows the text changed
   * and why.
   */
  trimmed: z.boolean(),
  /** What was removed, in user-facing words. Empty when nothing was. */
  trimmedNotes: z.array(z.string().max(240)).max(4),
});

export type DraftParagraph = z.infer<typeof draftParagraphSchema>;

/**
 * The stored, renderable result.
 *
 * `warnings` covers things that materially affect whether the user can trust
 * the draft at all — a missing job description, an unconfirmed profile, a
 * letter written from almost nothing. `missingInformation` is what would make
 * the next one better. They are different things and the UI shows them
 * differently.
 */
export const materialResultSchema = z.object({
  meta: materialMetaSchema,
  subject: z.string().max(200).nullable(),
  greeting: z.string().max(160),
  /** Signature name. Server-derived; empty string when unknown. */
  senderName: z.string().max(120),
  /** Sign-off. Server-derived. */
  signOff: z.string().max(80),
  paragraphs: z.array(draftParagraphSchema).max(8),
  /** The flattened text, assembled server-side. What is stored as `content`. */
  content: z.string().max(20_000),
  claims: z.array(verifiedClaimSchema).max(12),
  reviewNotes: z.array(z.string().max(240)).max(12),
  missingInformation: z.array(z.string().max(240)).max(12),
  unsupported: z.array(z.string().max(240)).max(8),
  warnings: z.array(z.string().max(240)).max(10),
});

export type MaterialResult = z.infer<typeof materialResultSchema>;

// ─── Failure states ─────────────────────────────────────────────────────────

export type MaterialErrorCode =
  | 'NO_CONTEXT'
  | 'NO_JOB_DATA'
  | 'NOT_APPLIED_YET'
  | 'NO_INTERVIEW_CONTEXT'
  | 'AI_NOT_CONFIGURED'
  | 'AI_RATE_LIMITED'
  | 'AI_TIMEOUT'
  | 'AI_REFUSED'
  | 'AI_EMPTY_RESPONSE'
  | 'AI_INVALID_RESPONSE'
  | 'AI_UNAVAILABLE';

/**
 * Human copy for a stored failure. Safe to show to the user.
 *
 * The first four are real states a user can fix, so they get actionable copy
 * and a 4xx, rather than being reported as a generic failure.
 */
export const MATERIAL_ERROR_MESSAGES: Record<MaterialErrorCode, string> = {
  NO_CONTEXT:
    'There is not enough on record to write this from yet. Add the job details, or tell us what to focus on, and try again.',
  NO_JOB_DATA:
    'This role does not have enough detail saved to personalise a draft. Add the job description and try again.',
  NOT_APPLIED_YET:
    'This message describes an application you have not submitted. Move the role to Applied in your pipeline first, if that is accurate.',
  NO_INTERVIEW_CONTEXT:
    'Add the interview to your pipeline, or write your own notes about what happened, and try again.',
  AI_NOT_CONFIGURED:
    'AI application materials are not available right now. Our team has been notified — please try again later.',
  AI_RATE_LIMITED: 'Our writing service is busy. Please wait a moment and try again.',
  AI_TIMEOUT: 'That took too long and stopped. Please try again.',
  AI_REFUSED: 'Our writing provider could not process this request.',
  AI_EMPTY_RESPONSE: 'The draft came back empty. Please try again.',
  AI_INVALID_RESPONSE: 'The draft came back in a form we could not verify. Please try again.',
  AI_UNAVAILABLE: 'Our writing service is temporarily unavailable. Please try again.',
};

/**
 * Errors that are the USER's state rather than ours: fix something and retry.
 * These map to 4xx so the client shows the copy rather than a retry spinner.
 */
export const USER_FIXABLE_ERROR_CODES: readonly MaterialErrorCode[] = [
  'NO_CONTEXT',
  'NO_JOB_DATA',
  'NOT_APPLIED_YET',
  'NO_INTERVIEW_CONTEXT',
];
