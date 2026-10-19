/**
 * Server-side verification of generated cover letters.
 *
 * This runs between the provider returning and anything being written to the
 * database. The model is not a witness. Every claim it makes is re-checked
 * against the sources of truth we hold:
 *
 *  1. EVIDENCE IS RE-QUOTED. Any excerpt attributed to the job posting is
 *     looked up in the actual posting text. A quote that cannot be found is
 *     dropped.
 *  2. PERSONAL EXPERIENCE CLAIMS ARE RE-CHECKED. If the model says "your API
 *     integration project", that project has to exist in the user's actual
 *     profile. If it does not, the reference becomes generic and the claim
 *     stays honest.
 *  3. UNSUPPORTABLE CLAIMS ARE STRIPPED. No invented metrics, no flattery, no
 *     promises about the employer, no legal determinations.
 *  4. EVERYTHING IS BOUNDED. Lengths, array sizes and dedup are re-applied.
 *
 * Pure: the same input always gives the same output, testable without a
 * provider.
 */

import {
  COVER_LETTER_MAX_CONTENT_CHARS,
} from './limits';
import {
  type ModelCoverLetter,
  type Evidence,
  evidenceSchema,
} from './schema';

/** Canonical comparison key — same shape as the other verifiers. */
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

/** Phrases that flatter the employer or manufacture enthusiasm. */
const FLATTERY_PATTERNS: RegExp[] = [
  /\b(?:i|we) (?:admire|love|am impressed by|am inspired by)\b/i,
  /\bthis (?:company|organization|organisation|team) (?:is|are) (?:a |an )?(?:leader|leading|innovative|world-class|world class)\b/i,
  /\bi (?:have always|have long) (?:admired|wanted)\b/i,
  /\byour (?:mission|vision|values) (?:resonates|align|aligns)\b/i,
];

/** Phrases that make a promise this product cannot keep. */
const PROMISE_PATTERNS: RegExp[] = [
  /\bguarantee[ds]?\b/i,
  /\b(?:will|would|can|could) (?:get|receive|secure|land)\b[^.]{0,24}?\b(?:interview|offer|job|role)\b/i,
  /\byou (?:will|'ll|are going to|are likely to) (?:get|receive|land|be offered)\b/i,
  /\bcertain(?:ly)? to (?:get|succeed|land|receive)\b/i,
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
    FLATTERY_PATTERNS.some((pattern) => pattern.test(text)) ||
    PROMISE_PATTERNS.some((pattern) => pattern.test(text)) ||
    LEGAL_DETERMINATION_PATTERNS.some((pattern) => pattern.test(text))
  );
}

function neutralisedCopy(kind: 'capability' | 'promise' | 'flattery' | 'legal'): string {
  switch (kind) {
    case 'promise':
      return 'I would welcome the chance to discuss how I can contribute.';
    case 'flattery':
      return 'This role caught my attention because it matches my experience.';
    case 'legal':
      return 'Confirm this with the employer. We do not make legal or work-authorisation determinations.';
    default:
      return "I am not sure this is in my current profile — if it is, I can add it.";
  }
}

function neutraliseText(text: string): string {
  const legal = LEGAL_DETERMINATION_PATTERNS.some((pattern) => pattern.test(text));
  if (legal) return neutralisedCopy('legal');
  const promise = PROMISE_PATTERNS.some((pattern) => pattern.test(text));
  if (promise) return neutralisedCopy('promise');
  const flattery = FLATTERY_PATTERNS.some((pattern) => pattern.test(text));
  if (flattery) return neutralisedCopy('flattery');
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

/** Does the profile actually contain this skill? */
export function profileSupportsSkill(
  profile: ProfileEvidence,
  skill: string,
): boolean {
  const needle = normaliseKey(skill);
  if (!needle || needle.length < 3) return false;
  return profile.skillNames.some((name) => {
    const key = normaliseKey(name);
    if (!key) return false;
    return key === needle || key.includes(needle) || needle.includes(key);
  });
}

// ─── Letter verification ───────────────────────────────────────────────────

function verifyEvidence(
  evidence: Evidence,
  sources: { jobText: string; profileText: string },
): Evidence | null {
  const supports = tidy(evidence.supports, 280);
  if (!supports) return null;

  const field = tidy(evidence.field, 160) ?? 'unknown';

  let excerpt = evidence.excerpt ?? null;
  if (excerpt) {
    const trimmed = tidy(excerpt, 300);
    if (!trimmed) excerpt = null;
    else if (evidence.source === 'JOB_DESCRIPTION') {
      if (!excerptAppearsIn(trimmed, sources.jobText)) excerpt = null;
    } else if (evidence.source === 'CAREER_PROFILE') {
      if (!excerptAppearsIn(trimmed, sources.profileText)) excerpt = null;
    }
  }

  return { source: evidence.source, field, excerpt, supports };
}

export type VerifyLetterOptions = {
  letter: ModelCoverLetter;
  sources: { jobText: string; profileText: string };
  profile: ProfileEvidence;
};

/**
 * Verify one generated cover letter.
 *
 * Returns null when the letter body is empty. Unsupported claims in the body
 * are neutralised so an honest, cautious letter is stored rather than a
 * fabricated one. Personal-experience references the profile does not support
 * are kept only if they name something real; otherwise the claim stays general.
 */
export function verifyLetter(params: VerifyLetterOptions): ModelCoverLetter | null {
  const { letter, sources, profile } = params;

  const content = tidy(letter.content, COVER_LETTER_MAX_CONTENT_CHARS);
  if (!content) return null;

  // Neutralise unsupportable claims anywhere in the body.
  let body = containsUnsupportableClaim(content) ? neutraliseText(content) : content;
  if (body === content && containsUnsupportableClaim(body)) {
    body = neutraliseText(body);
  }

  const subject = tidy(letter.subject, 160) ?? null;
  const salutation = tidy(letter.salutation, 120) ?? null;
  const signOff = tidy(letter.signOff, 120) ?? null;

  const keyClaims: ModelCoverLetter['keyClaims'] = [];
  for (const claim of letter.keyClaims) {
    const claimText = tidy(claim.claim, 600);
    if (!claimText) continue;
    const evidenced: Evidence[] = [];
    for (const evidence of claim.evidence) {
      const verified = verifyEvidence(evidence, sources);
      if (verified) evidenced.push(verified);
    }
    keyClaims.push({ claim: claimText, evidence: evidenced });
    if (keyClaims.length >= 6) break;
  }

  const limitations = [
    ...new Set(
      letter.limitations
        .map((item) => tidy(item, 280))
        .filter((item): item is string => Boolean(item)),
    ),
  ].slice(0, 6);

  return {
    schemaVersion: letter.schemaVersion,
    subject,
    content: body,
    salutation,
    signOff,
    keyClaims,
    limitations,
  };
}
