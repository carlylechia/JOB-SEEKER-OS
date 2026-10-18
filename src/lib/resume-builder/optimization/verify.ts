/**
 * Verification: everything the model returned is checked before it is stored or
 * offered to the user.
 *
 * This module is the reason the anti-fabrication rule is enforceable rather
 * than aspirational. A prompt instruction ("never invent a metric") reduces how
 * often a model overclaims; it does not make overclaiming impossible. Here, four
 * independent server-side checks run over every proposed operation:
 *
 *   1. TARGET RESOLUTION. The operation must name a section, an entry and a
 *      field that exist in the real document, with the kind of change permitted
 *      against that target. An out-of-range index or a mismatched pair is
 *      refused, not clamped.
 *
 *   2. STALENESS. `originalText` must equal what the document actually says.
 *      If it does not, the proposal was generated against a version the user
 *      has since edited, and applying it would write one document's advice onto
 *      another. Refused.
 *
 *   3. EVIDENCE RE-CHECKING. Every excerpt is searched for verbatim in the
 *      corpus it claims to come from. A quote that cannot be found is removed;
 *      an operation left with no evidence for a claim it is making is refused.
 *
 *   4. NO NEW CLAIMS. The decisive one. Numeric and metric tokens in
 *      `proposedText` must already exist somewhere in the resume, the career
 *      profile or the posting. So must proper nouns the operation is asserting.
 *      A rewrite that introduces "improved revenue by 40%" when nothing in the
 *      source says 40% is rejected outright — which is exactly the
 *      "improved page performance" → "improved revenue by $1.2 million"
 *      transformation this product refuses to make.
 *
 * Rejected operations are RECORDED with a reason rather than dropped silently,
 * so the review UI can honestly say "we removed 2 suggestions because they
 * introduced figures your resume does not support".
 */

import { createHash } from 'node:crypto';
import type { ResumeContent } from '../schema';
import {
  OPTIMIZATION_MAX_EVIDENCE_CHARS,
  OPTIMIZATION_MAX_OPERATIONS,
  OPTIMIZATION_MIN_EVIDENCE_CHARS,
} from './limits';
import {
  FIELD_LABELS,
  OPERATION_LABELS,
  SECTION_LABELS,
  OPTIMIZATION_SCHEMA_VERSION,
  type Evidence,
  type ModelProposal,
  type OperationKind,
  type OptimizationResult,
  type ProposedOperation,
  type RejectionReason,
  type RejectedOperation,
  type ReviewOperation,
  type TargetField,
  type TargetSection,
} from './schema';

// ─── Source corpus ──────────────────────────────────────────────────────────

export type SourceCorpus = {
  /** Everything the user has written in this resume. */
  resumeText: string;
  /** The confirmed career profile's text. */
  profileText: string;
  /** The job posting. */
  jobText: string;
  /** Structured job facts (title, company, score). */
  jobMetaText: string;
};

export type VerifyInput = {
  proposal: ModelProposal;
  content: ResumeContent;
  corpus: SourceCorpus;
  provider: string;
  model: string;
  baseRevision: number;
  inputFingerprint: string;
  generatedAt: Date;
  hadJobDescription: boolean;
  hadConfirmedProfile: boolean;
  resumeTruncated: boolean;
  job: OptimizationResult['job'];
};

// ─── Text helpers ───────────────────────────────────────────────────────────

function normalise(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function lower(value: string): string {
  return value.toLowerCase();
}

/**
 * Common English words that appear capitalised at the start of a sentence and
 * would otherwise look like a "new proper noun". Without this list, every
 * rewrite would be flagged for the word "Cut" or "Led".
 */
const SENTENCE_STARTERS = new Set([
  'a', 'an', 'and', 'as', 'at', 'built', 'by', 'created', 'delivered', 'designed',
  'developed', 'drove', 'established', 'improved', 'increased', 'introduced',
  'led', 'maintained', 'managed', 'migrated', 'owned', 'reduced', 'rewrote',
  'shipped', 'spearheaded', 'supported', 'the', 'transformed', 'built', 'cut',
  'grew', 'helped', 'launched', 'mentored', 'scaled', 'secured', 'set', 'wrote',
  'i', 'my', 'we', 'our', 'their', 'his', 'her', 'its', 'this', 'that', 'these',
  'those', 'in', 'on', 'for', 'with', 'from', 'to', 'of', 'or', 'if', 'then',
  'when', 'while', 'during', 'over', 'under', 'after', 'before', 'between',
  'delivered', 'engaged', 'enabled', 'executed', 'facilitated', 'generated',
  'identified', 'implemented', 'improved', 'influenced', 'initiated', 'made',
  'monitored', 'negotiated', 'performed', 'prepared', 'presented', 'produced',
  'provided', 'raised', 'reviewed', 'revised', 'streamlined', 'strengthened',
  'supervised', 'trained', 'upgraded', 'used', 'worked', 'wrote', 'guided',
]);

/**
 * Numeric and metric tokens.
 *
 * Catches percentages, currency, multipliers, durations and bare quantities.
 * These are the tokens that turn "improved performance" into "improved
 * performance by 75%, increasing revenue by $1.2 million".
 */
const NUMERIC_PATTERN =
  /(?:\$|€|£|¥|usd|eur|gbp)?\s?\d[\d,.]*\s?(?:%|percent|percentage points?|bps?|x|×|k|m|bn|billion|million|thousand|ms|s|secs?|seconds?|min|mins?|minutes?|hrs?|hours?|days?|weeks?|months?|quarters?|years?|users?|engineers?|people|teams?|clients?|requests?|qps|rps)?\b/gi;

/**
 * Acronyms and all-caps product names: `AWS`, `SOC2`, `gRPC`, `SQL`.
 *
 * Casing is preserved on purpose — an all-caps token in a resume is nearly
 * always a named technology, standard or acronym, and introducing one that is
 * not in the source is the most common way a model smuggles in a credential
 * the user does not have.
 */
const ACRONYM_PATTERN = /\b[A-Z][A-Z0-9]{1,9}\b/g;

/** Capitalised words that are not sentence starters: `Kubernetes`, `Stripe`. */
const PROPER_NOUN_PATTERN = /\b[A-Z][a-z]{2,}\b/g;

// ─── The claim check ────────────────────────────────────────────────────────

export type ClaimViolation = {
  token: string;
  kind: 'METRIC' | 'ACRONYM' | 'PROPER_NOUN';
  detail: string;
};

/**
 * Numbers, acronyms and proper nouns the proposal introduces that appear
 * nowhere in the sources.
 *
 * Whitespace, case and separators are normalised before comparison so
 * "1,200", "1200" and "$1200" are recognised as the same figure, and a token is
 * only compared once per unique form.
 */
export function findNewClaims(proposed: string, corpus: SourceCorpus): ClaimViolation[] {
  const haystack = lower(
    [corpus.resumeText, corpus.profileText, corpus.jobText, corpus.jobMetaText].join('\n'),
  );
  // Strip separators so "1,200" in the source matches "1200" in the proposal and
  // vice versa.
  const haystackDigits = haystack.replace(/[,\s]/g, '');

  const violations: ClaimViolation[] = [];
  const seen = new Set<string>();

  for (const match of proposed.matchAll(NUMERIC_PATTERN)) {
    const token = match[0].trim();
    if (token.length === 0) continue;
    const digits = token.replace(/[^\d.]/g, '');
    if (digits.length === 0) continue;

    const inSource =
      haystack.includes(lower(token)) || haystackDigits.includes(digits.replace(/[.,]/g, ''));
    if (inSource) continue;

    const key = `M:${digits}`;
    if (seen.has(key)) continue;
    seen.add(key);
    violations.push({
      token,
      kind: 'METRIC',
      detail: 'This figure does not appear in your resume, your career profile or the job description.',
    });
  }

  for (const match of proposed.matchAll(ACRONYM_PATTERN)) {
    const token = match[0];
    if (haystack.includes(lower(token))) continue;
    const key = `A:${token}`;
    if (seen.has(key)) continue;
    seen.add(key);
    violations.push({
      token,
      kind: 'ACRONYM',
      detail: 'This technology or standard is not named anywhere in your resume or career profile.',
    });
  }

  for (const match of proposed.matchAll(PROPER_NOUN_PATTERN)) {
    const token = match[0];
    if (SENTENCE_STARTERS.has(lower(token))) continue;
    if (haystack.includes(lower(token))) continue;
    const key = `P:${lower(token)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    violations.push({
      token,
      kind: 'PROPER_NOUN',
      detail: 'This name is not mentioned in your resume, your career profile or the job description.',
    });
  }

  return violations;
}

// ─── Target resolution ──────────────────────────────────────────────────────

type ResolvedTarget = {
  section: TargetSection;
  entryIndex: number | null;
  field: TargetField | null;
  bulletIndex: number | null;
  /** The text the document currently holds at this target. */
  currentText: string;
  /** The list this operation mutates, or null for a scalar field. */
  list: string[] | null;
  label: string;
};

class TargetError extends Error {
  constructor(readonly reason: RejectionReason, detail: string) {
    super(detail);
    this.name = 'TargetError';
  }
}

/** Which fields each section may be asked to change, and whether they are lists. */
const SECTION_FIELDS: Record<TargetSection, Partial<Record<TargetField, 'list' | 'scalar'>>> = {
  BASICS: { headline: 'scalar' },
  SUMMARY: { summary: 'scalar' },
  EXPERIENCE: { responsibilities: 'list', achievements: 'list', technologies: 'list' },
  SKILLS: {},
  EDUCATION: {},
  PROJECTS: { description: 'scalar', results: 'list', technologies: 'list' },
  CREDENTIALS: {},
};

/** Which operation kinds are permitted against which sections. */
const PERMITTED: Record<OperationKind, TargetSection[]> = {
  REPLACE_SUMMARY: ['SUMMARY'],
  REWRITE_HEADLINE: ['BASICS'],
  REWRITE_BULLET: ['EXPERIENCE', 'PROJECTS'],
  REMOVE_BULLET: ['EXPERIENCE', 'PROJECTS'],
  REORDER_SKILLS: ['SKILLS'],
  REORDER_EXPERIENCE: ['EXPERIENCE'],
};

function resolveTarget(operation: ProposedOperation, content: ResumeContent): ResolvedTarget {
  const { kind, target } = operation;

  if (!PERMITTED[kind].includes(target.section)) {
    throw new TargetError(
      'PERMISSION_DENIED',
      `${OPERATION_LABELS[kind]} cannot be applied to ${SECTION_LABELS[target.section]}.`,
    );
  }

  const base = {
    section: target.section,
    entryIndex: target.entryIndex,
    field: target.field,
    bulletIndex: target.bulletIndex,
  };

  if (kind === 'REPLACE_SUMMARY') {
    return { ...base, currentText: normalise(content.summary), list: null, label: 'Professional Summary' };
  }
  if (kind === 'REWRITE_HEADLINE') {
    return {
      ...base,
      currentText: normalise(content.basics.headline),
      list: null,
      label: 'Headline',
    };
  }

  if (kind === 'REORDER_SKILLS') {
    const names = content.skills.map((skill) => skill.name).filter((name) => name.length > 0);
    return {
      ...base,
      currentText: names.join(', '),
      list: names,
      label: 'Skills',
    };
  }

  if (kind === 'REORDER_EXPERIENCE') {
    const titles = content.experiences.map(
      (entry) => normalise(entry.jobTitle ?? entry.company ?? ''),
    );
    return { ...base, currentText: titles.join(', '), list: titles, label: 'Work Experience' };
  }

  // REWRITE_BULLET / REMOVE_BULLET
  const field = target.field;
  if (!field) {
    throw new TargetError('INVALID_TARGET', 'This suggestion did not say which text it changes.');
  }
  const fieldKind = SECTION_FIELDS[target.section]?.[field];
  if (!fieldKind) {
    throw new TargetError(
      'PERMISSION_DENIED',
      `${SECTION_LABELS[target.section]} has no editable "${FIELD_LABELS[field]}" list.`,
    );
  }
  if (fieldKind !== 'list') {
    throw new TargetError(
      'INVALID_TARGET',
      `"${FIELD_LABELS[field]}" is not a list in ${SECTION_LABELS[target.section]}.`,
    );
  }

  const entryIndex = target.entryIndex;
  if (entryIndex === null) {
    throw new TargetError('INVALID_TARGET', 'This suggestion did not say which entry it changes.');
  }

  const list =
    target.section === 'EXPERIENCE'
      ? (content.experiences[entryIndex] as unknown as Record<string, unknown> | undefined)?.[
          field
        ]
      : (content.projects[entryIndex] as unknown as Record<string, unknown> | undefined)?.[field];

  if (!Array.isArray(list)) {
    throw new TargetError(
      'INVALID_TARGET',
      `There is no entry ${entryIndex} in ${SECTION_LABELS[target.section]}.`,
    );
  }
  const strings = list.filter((item): item is string => typeof item === 'string');

  const bulletIndex = target.bulletIndex;
  if (bulletIndex === null || bulletIndex < 0 || bulletIndex >= strings.length) {
    throw new TargetError(
      'INVALID_TARGET',
      `There is no ${FIELD_LABELS[field]} at position ${bulletIndex ?? 0} in that entry.`,
    );
  }

  return {
    ...base,
    currentText: normalise(strings[bulletIndex]),
    list: strings,
    label: `${SECTION_LABELS[target.section]} → ${FIELD_LABELS[field]} ${bulletIndex + 1}`,
  };
}

// ─── Evidence ───────────────────────────────────────────────────────────────

/**
 * Keep only excerpts that can actually be found.
 *
 * `RESUME_TEXT` and `CAREER_PROFILE` and `JOB_DESCRIPTION` are each re-checked
 * against their own corpus, not against the union: quoting the job posting as
 * though it were the candidate's experience is the specific failure this
 * prevents.
 */
function verifyEvidence(evidence: Evidence[], corpus: SourceCorpus): Evidence[] {
  const kept: Evidence[] = [];
  for (const item of evidence) {
    const excerpt = normalise(item.excerpt);
    if (excerpt.length < OPTIMIZATION_MIN_EVIDENCE_CHARS) continue;

    const source =
      item.source === 'RESUME_TEXT'
        ? corpus.resumeText
        : item.source === 'CAREER_PROFILE'
          ? corpus.profileText
          : item.source === 'JOB_DESCRIPTION'
            ? corpus.jobText
            : corpus.jobMetaText;

    const haystack = lower(normalise(source));
    // Compare on a whitespace-stripped, lowercased form so line wrapping in the
    // source does not cause a false negative.
    const needle = lower(excerpt).replace(/\s+/g, '');
    if (!haystack.replace(/\s+/g, '').includes(needle)) continue;

    kept.push({
      source: item.source,
      field: normalise(item.field).slice(0, 400),
      excerpt: excerpt.slice(0, OPTIMIZATION_MAX_EVIDENCE_CHARS),
    });
  }
  return kept;
}

// ─── The verification pass ──────────────────────────────────────────────────

export function verifyProposal(input: VerifyInput): OptimizationResult {
  const { proposal, content, corpus } = input;

  const operations: ReviewOperation[] = [];
  const rejected: RejectedOperation[] = [];

  for (const candidate of proposal.operations) {
    if (operations.length >= OPTIMIZATION_MAX_OPERATIONS) {
      rejected.push({
        kind: candidate.kind,
        section: candidate.target.section,
        reason: 'OVER_LIMIT',
        detail: 'This run already returned as many suggestions as we review at once.',
      });
      continue;
    }

    let resolved: ResolvedTarget;
    try {
      resolved = resolveTarget(candidate, content);
    } catch (error) {
      if (error instanceof TargetError) {
        rejected.push({
          kind: candidate.kind,
          section: candidate.target.section,
          reason: error.reason,
          detail: error.message,
        });
        continue;
      }
      throw error;
    }

    // Staleness. An operation generated against text that is no longer there is
    // refused outright rather than applied to whatever is there now.
    const claimedOriginal = normalise(candidate.originalText);
    if (claimedOriginal.length > 0 && claimedOriginal !== resolved.currentText) {
      rejected.push({
        kind: candidate.kind,
        section: candidate.target.section,
        reason: 'STALE',
        detail: 'This text in your resume changed after the suggestions were generated.',
      });
      continue;
    }

    const isRemoval = candidate.kind === 'REMOVE_BULLET';
    const isReorder = candidate.kind === 'REORDER_SKILLS' || candidate.kind === 'REORDER_EXPERIENCE';

    if (isRemoval && candidate.proposedText.trim().length > 0) {
      rejected.push({
        kind: candidate.kind,
        section: candidate.target.section,
        reason: 'INVALID_TARGET',
        detail: 'A removal must not carry replacement text.',
      });
      continue;
    }

    if (isReorder) {
      const proposedOrder = candidate.proposedText
        .split(',')
        .map((part) => normalise(part))
        .filter((part) => part.length > 0);
      const known = new Set((resolved.list ?? []).map((item) => normalise(item).toLowerCase()));
      const unknown = proposedOrder.filter((item) => !known.has(item.toLowerCase()));
      if (unknown.length > 0) {
        rejected.push({
          kind: candidate.kind,
          section: candidate.target.section,
          reason: 'FABRICATED_CLAIM',
          detail: 'The suggested order included items that are not in your resume.',
        });
        continue;
      }
      if (proposedOrder.length !== (resolved.list ?? []).length) {
        rejected.push({
          kind: candidate.kind,
          section: candidate.target.section,
          reason: 'INVALID_TARGET',
          detail: 'A reorder must include every item exactly once.',
        });
        continue;
      }
    } else if (!isRemoval && candidate.proposedText.trim().length === 0) {
      rejected.push({
        kind: candidate.kind,
        section: candidate.target.section,
        reason: 'INVALID_TARGET',
        detail: 'A rewrite must contain replacement text.',
      });
      continue;
    }

    // The decisive check. A removal cannot fabricate anything, and a reorder
    // only rearranges strings that are already in the document.
    const violations = isRemoval || isReorder ? [] : findNewClaims(candidate.proposedText, corpus);
    if (violations.length > 0) {
      rejected.push({
        kind: candidate.kind,
        section: candidate.target.section,
        reason: 'FABRICATED_CLAIM',
        detail: `Introduced ${violations
          .slice(0, 3)
          .map((violation) => `"${violation.token}"`)
          .join(', ')}, which your resume and career profile do not support.`,
      });
      continue;
    }

    const evidence = verifyEvidence(candidate.evidence, corpus);
    // A rewrite that claims to keep the original assertion must show its
    // working. No evidence at all means we cannot show the user why, so it is
    // not offered.
    if (!isRemoval && !isReorder && evidence.length === 0) {
      rejected.push({
        kind: candidate.kind,
        section: candidate.target.section,
        reason: 'UNSUPPORTED_EVIDENCE',
        detail: 'No supporting text could be found for this suggestion.',
      });
      continue;
    }

    const warnings: string[] = [...candidate.warnings.map(normalise).filter(Boolean)];
    if (violations.length === 0 && candidate.confidence === 'LOW') {
      warnings.push('This suggestion is a judgement call. Read it carefully.');
    }
    if (isRemoval) {
      warnings.push('Accepting this deletes the bullet. Nothing is recovered afterwards.');
    }

    operations.push({
      // Server-assigned. The model returns no identifier, and one it chose would
      // be a second thing to trust.
      id: createHash('sha256')
        .update(
          [
            candidate.kind,
            candidate.target.section,
            String(candidate.target.entryIndex ?? ''),
            String(candidate.target.field ?? ''),
            String(candidate.target.bulletIndex ?? ''),
            String(candidate.moveTo ?? ''),
            candidate.proposedText,
          ].join(' '),
        )
        .digest('hex')
        .slice(0, 24),
      kind: candidate.kind,
      section: candidate.target.section,
      sectionLabel: resolved.label,
      entryIndex: candidate.target.entryIndex,
      field: candidate.target.field,
      bulletIndex: candidate.target.bulletIndex,
      moveTo: candidate.moveTo,
      originalText: resolved.currentText,
      proposedText: isReorder ? candidate.proposedText : normalise(candidate.proposedText),
      reason: normalise(candidate.reason).slice(0, 600),
      targetRequirement: candidate.targetRequirement ? normalise(candidate.targetRequirement) : null,
      evidence,
      confidence: candidate.confidence,
      warnings: warnings.slice(0, 6),
    });
  }

  return {
    meta: {
      schemaVersion: OPTIMIZATION_SCHEMA_VERSION,
      promptVersion: proposal.schemaVersion,
      inputFingerprint: input.inputFingerprint,
      generatedAt: input.generatedAt.toISOString(),
      provider: input.provider,
      model: input.model,
      baseRevision: input.baseRevision,
      hadJobDescription: input.hadJobDescription,
      hadConfirmedProfile: input.hadConfirmedProfile,
      resumeTruncated: input.resumeTruncated,
      proposedCount: proposal.operations.length,
      acceptedCount: operations.length,
    },
    summary: normalise(proposal.summary).slice(0, 600),
    operations,
    rejected: rejected.slice(0, 20),
    informationGaps: proposal.informationGaps.slice(0, 8).map((gap) => ({
      question: normalise(gap.question).slice(0, 600),
      section: gap.section,
      why: normalise(gap.why).slice(0, 600),
    })),
    job: input.job,
  };
}

/** Serialise every piece of text in a document, for evidence and claim checks. */
export function resumeContentToText(content: ResumeContent): string {
  const parts: string[] = [];
  const push = (value: string | null | undefined) => {
    if (value && value.trim()) parts.push(value.trim());
  };

  for (const value of Object.values(content.basics)) push(value);
  push(content.summary);

  for (const entry of content.experiences) {
    push(entry.jobTitle);
    push(entry.company);
    push(entry.location);
    for (const item of entry.responsibilities) push(item);
    for (const item of entry.achievements) push(item);
    for (const item of entry.technologies) push(item);
  }
  for (const entry of content.education) {
    push(entry.institution);
    push(entry.qualification);
    push(entry.fieldOfStudy);
    push(entry.details);
  }
  for (const skill of content.skills) push(skill.name);
  for (const entry of content.projects) {
    push(entry.name);
    push(entry.description);
    push(entry.role);
    for (const item of entry.technologies) push(item);
    for (const item of entry.results) push(item);
  }
  for (const entry of content.credentials) {
    push(entry.name);
    push(entry.issuer);
    push(entry.proficiency);
    push(entry.details);
  }

  return parts.join('\n');
}