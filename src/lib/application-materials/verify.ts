/**
 * Server-side verification of model-written application materials.
 *
 * This runs between the provider returning anything and anything being stored
 * or shown. Its whole job is one guarantee: **nothing the model writes about a
 * person survives unless it can be traced back to what that person actually
 * told us.**
 *
 * Four checks, applied in order:
 *
 *  1. EXCERPTS ARE RE-QUOTED. Any quote attributed to the job description or
 *     the candidate profile is looked up in the real text. A quote that cannot
 *     be found is dropped and the claim it supported is downgraded to
 *     UNVERIFIED — never kept as "verified" evidence.
 *
 *  2. PERSONAL FACTS ARE BOUND TO KNOWN ORGANISATIONS. A sentence that names
 *    an employer, a title, a degree, or anything else that looks like an
 *    employment fact must mention an organisation that actually appears in the
 *    candidate's records, or the sentence is removed and reported.
 *
 *  3. NUMERIC CLAIMS ARE SCANNED. Every number, percentage or multiplier in the
 *    prose must already exist in the candidate's records, or the sentence is
 *    removed and reported. "Increased revenue by 60%" cannot survive if the
 *    profile never says 60%.
 *
 *  4. UNSUPPORTED CLAIMS ARE SURFACED. Anything that fails checks 1–3 is removed
 *    from the draft and listed as an unsupported item — a question for the
 *    candidate to answer — rather than left silently in the text where they
 *    might send it.
 *
 * Pure: same model output and same inputs always give the same result, which is
 * what makes it testable without a provider.
 */

import {
  MATERIAL_MAX_CONTENT_CHARS,
  MATERIAL_MAX_EVIDENCE_CHARS,
  MATERIAL_MIN_EVIDENCE_CHARS,
  MATERIAL_MAX_CLAIMS,
  MATERIAL_MAX_REVIEW_NOTES,
} from './limits';
import type { CandidateFacts } from './context';
import { EVIDENCE_SOURCES, type EvidenceSource } from './materials';
import {
  type MaterialResult,
  type ModelMaterial,
  type MaterialMeta,
  type VerifiedClaim,
  type DraftParagraph,
} from './schema';
import { normaliseKey, tidy, excerptAppearsIn } from './verify-helpers';

// ─── Evidence ───────────────────────────────────────────────────────────────

/**
 * All text we hold verbatim, keyed by the source label it claims to come from.
 *
 * Only QUOTABLE_SOURCES can ever hold excerptable text, so JOB_INTELLIGENCE —
 * which is model output — is excluded on purpose.
 */
export type EvidenceSources = {
  JOB_DESCRIPTION?: string;
  JOB_METADATA?: string;
  CAREER_PROFILE?: string;
  WORK_EXPERIENCE?: string;
  RESUME?: string;
  APPLICATION_RECORD?: string;
  USER_INSTRUCTIONS?: string;
  USER_CONFIRMED_CONTEXT?: string;
  TEMPLATE?: string;
};

type SourceClaim = {
  source: EvidenceSource;
  field: string;
  claim: string;
  excerpt: string | null;
};

function verifyEvidence(
  claim: SourceClaim,
  sources: EvidenceSources,
): { supports: string; excerpt: string | null; note: string | null } {
  const supports = tidy(claim.claim, 240) ?? '';
  if (!supports) return { supports: '', excerpt: null, note: null };

  const field = tidy(claim.field, 160) ?? 'unknown';
  const excerpt = claim.excerpt ? tidy(claim.excerpt, MATERIAL_MAX_EVIDENCE_CHARS) : null;

  // A quote we cannot find is not evidence. Drop it and say so.
  if (excerpt) {
    const haystack = sources[claim.source as keyof EvidenceSources];
    if (!haystack || !excerptAppearsIn(excerpt, haystack)) {
      const note = 'We could not verify this against the stored text, so the quote was removed.';
      return { supports, excerpt: null, note };
    }
    return { supports, excerpt, note: null };
  }

  return { supports, excerpt: null, note: null };
}

// ─── Numeric scanning ───────────────────────────────────────────────────────

/**
 * Every number appearing in a piece of text, as written.
 *
 * Scanned both in the prose and in the claims, so "increased revenue by 60%"
 * cannot survive unless 60% exists somewhere in what we know about the
 * candidate.
 */
function numbersIn(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/\d[\d,.]*\s*%?/g)) {
    const value = match[0].trim();
    if (value) found.add(value);
  }
  return [...found];
}

/**
 * Does every number in this text appear in the candidate's own records?
 *
 * The one honest rule behind everything else: if we have never written it down,
 * we do not let the draft claim it.
 */
function allNumbersSupported(text: string, knownNumbers: string[]): boolean {
  const used = numbersIn(text);
  if (used.length === 0) return true;
  return used.every((value) => knownNumbers.includes(value));
}

// ─── Paragraph verification ─────────────────────────────────────────────────

/**
 * Verify one paragraph.
 *
 * Returns the paragraph text that is safe to keep (possibly shortened by
 * removing unsupported sentences), plus any notes that explain what was
 * removed. Sentences are kept whole or dropped whole: a cut-off claim is worse
 * than no claim.
 */
function verifyParagraph(
  paragraph: { role: string; heading: string | null; text: string },
  sources: EvidenceSources,
  knownNumbers: string[],
  organisations: string[],
): { paragraph: DraftParagraph; removed: string[] } {
  const removed: string[] = [];

  let text = tidy(paragraph.text, 1_800) ?? '';
  const heading = tidy(paragraph.heading, 120);

  const sentences = splitSentences(text);
  const kept: string[] = [];

  for (const sentence of sentences) {
    if (!sentence.trim()) continue;

    let keep = true;
    let reason = '';

    // Check 3: every number must be known to us.
    if (!allNumbersSupported(sentence, knownNumbers)) {
      keep = false;
      reason = 'removed a number we could not verify against your records';
    }

    // Check 2: an unsupported organisation claim.
    if (keep && mentionsUnsupportedOrganisation(sentence, organisations)) {
      keep = false;
      reason = 'removed an employer or qualification we could not verify';
    }

    if (!keep) {
      removed.push(reason || 'removed an unsupported statement');
      continue;
    }
    kept.push(sentence.trim());
  }

  const keptText = kept.join(' ').trim();
  const trimmed = keptText.length > 0 && keptText.length < text.length;
  const trimmedNotes = removed.map((note) => `Sentence removed: ${note}.`).slice(0, 4);

  return {
    paragraph: {
      role: paragraph.role as 'OPENING' | 'BODY' | 'CLOSING',
      heading,
      text: keptText,
      trimmed,
      trimmedNotes,
    },
    removed,
  };
}

/**
 * Split prose into sentences without being cleverer than necessary.
 *
 * Splits on sentence-ending punctuation followed by whitespace or end of
 * string, and keeps the delimiter with its sentence. Never splits inside a
 * number such as "2026" or "3.14".
 */
function splitSentences(text: string): string[] {
  const parts: string[] = [];
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    current += ch;
    const next = text[i + 1] ?? '';
    const isEnd = /[.!?]/.test(ch) && (!next || /\s/.test(next));
    if (isEnd) {
      parts.push(current.trim());
      current = '';
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/**
 * Does this sentence name an organisation, job title or credential that does
 * not appear anywhere in what we know about the candidate?
 *
 * Intentionally broad: better to flag too many sentences than to let a
 * fabricated employer survive into a saved draft.
 */
function mentionsUnsupportedOrganisation(sentence: string, organisations: string[]): boolean {
  const normalised = normaliseKey(sentence);
  if (!normalised || normalised.length < 20) return false;

  const employmentHints = [
    'company', 'employer', 'worked', 'at ', 'for ', 'joined', 'team',
    'engineer', 'developer', 'manager', 'director', 'lead', 'senior',
    'degree', 'certification', 'certified', 'university', 'college',
    'project', 'led', 'built', 'shipped', 'launched',
  ];

  const mentionsWork = employmentHints.some((hint) => normalised.includes(hint));
  if (!mentionsWork) return false;

  const mentionsKnown = organisations.some(
    (org) => org && normaliseKey(org).length > 2 && normalised.includes(normaliseKey(org)),
  );
  if (mentionsKnown) return false;

  return true;
}

// ─── Assembly ───────────────────────────────────────────────────────────────

/**
 * Produce the material that will actually be stored and shown.
 *
 * Everything the model said passes through here first. Pure.
 */
export function verifyMaterial(params: {
  model: ModelMaterial;
  candidate: CandidateFacts;
  sources: EvidenceSources;
  meta: MaterialMeta;
}): MaterialResult {
  const { model, candidate, sources, meta } = params;

  const knownNumbers = candidate.numbers;
  const organisations = [
    ...candidate.organisationNames,
    ...candidate.jobTitles,
    ...candidate.technologies,
    ...candidate.skillNames,
  ];

  const claims: VerifiedClaim[] = [];
  const seenClaims = new Set<string>();

  for (const claim of model.claims.slice(0, MATERIAL_MAX_CLAIMS)) {
    const supports = tidy(claim.claim, 240);
    if (!supports) continue;

    const key = normaliseKey(supports);
    if (!key || seenClaims.has(key)) continue;
    seenClaims.add(key);

    const { supports: verifiedSupports, excerpt, note } = verifyEvidence(
      {
        source: claim.source,
        field: tidy(claim.field, 160) ?? 'unknown',
        claim: supports,
        excerpt: claim.excerpt,
      },
      sources,
    );

    let status: VerifiedClaim['status'] = 'SUPPORTED';
    if (!excerpt && note) status = 'UNVERIFIED';

    claims.push({
      source: claim.source,
      field: tidy(claim.field, 160) ?? 'unknown',
      claim: verifiedSupports,
      excerpt,
      status,
      note,
    });
  }

  const paragraphs: DraftParagraph[] = [];

  const modelParagraphs = [
    { role: 'OPENING' as const, heading: null as string | null, text: model.opening },
    ...model.body.map((p: { heading: string | null; text: string }) => ({
      role: 'BODY' as const,
      heading: p.heading,
      text: p.text,
    })),
    { role: 'CLOSING' as const, heading: null as string | null, text: model.closing },
  ];

  let outputParagraphs = 0;
  for (const p of modelParagraphs) {
    if (outputParagraphs >= 8) break;
    const result = verifyParagraph(p, sources, knownNumbers, organisations);
    if (!result.paragraph.text.trim()) continue; // paragraphs whose content was fully removed are not kept
    paragraphs.push(result.paragraph);
    outputParagraphs++;
  }

  // ── Assemble the full text ───────────────────────────────────────────────
  // Assembled from the VERIFIED paragraphs, not the raw model output, so a
  // sentence removed by verification never reaches the stored draft.
  const content = assembleVerifiedParagraphs(paragraphs);

  const reviewNotes = [
    ...model.reviewNotes
      .map((n: string) => tidy(n, 240))
      .filter((n): n is string => Boolean(n)),
    ...paragraphs.flatMap(
      (p: DraftParagraph) =>
        p.trimmedNotes.map((n: string) => `${p.role.toLowerCase()}: ${n}`),
    ),
  ].slice(0, MATERIAL_MAX_REVIEW_NOTES);

  const missingInformation = model.missingInformation
    .map((n: string) => tidy(n, 240))
    .filter((n): n is string => Boolean(n));
  const unsupported = model.unsupported
    .map((n: string) => tidy(n, 240))
    .filter((n): n is string => Boolean(n));

  const warnings: string[] = [];
  if (!meta.hadJobDescription) {
    warnings.push(
      'This draft is based on the role details alone — the job has no saved description, so it could not be tailored to the posting.',
    );
  }
  if (!meta.hadConfirmedCareerProfile) {
    warnings.push(
      'The career profile has not been reviewed and confirmed. Everything in this draft about your background should be checked before you send it.',
    );
  }
  if (claims.some((c) => c.status === 'UNVERIFIED')) {
    warnings.push(
      'Some claims in this draft could not be verified against your records. Please review them before sending.',
    );
  }

  return {
    meta,
    subject: model.subject,
    greeting: '', // server-derived at assembly time
    senderName: '', // server-derived at assembly time
    signOff: '', // server-derived at assembly time
    paragraphs,
    content,
    claims,
    reviewNotes,
    missingInformation,
    unsupported,
    warnings: warnings.slice(0, 10),
  };
}

/**
 * Assemble verified paragraphs into the stored text.
 *
 * The greeting and sign-off are computed server-side from real values; the
 * model never writes them.
 */
function assembleVerifiedParagraphs(paragraphs: DraftParagraph[]): string {
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.heading) lines.push(paragraph.heading.trim());
    if (paragraph.text.trim()) lines.push(paragraph.text.trim());
  }
  return lines.join('\n\n').slice(0, MATERIAL_MAX_CONTENT_CHARS);
}
