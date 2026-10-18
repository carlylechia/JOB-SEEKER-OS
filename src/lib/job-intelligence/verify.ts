/**
 * Server-side verification of a model's job analysis.
 *
 * This runs between the provider returning and anything being written to the
 * database. It is the reason a stored analysis can be shown to a user as
 * "supported by your profile" and "taken from this posting".
 *
 * The model is not a witness. Every claim it makes is re-checked against the
 * two sources of truth we hold:
 *
 *  1. EVIDENCE IS RE-QUOTED. Any excerpt attributed to the job posting is
 *     looked up in the actual posting text. A quote that cannot be found is
 *     dropped and the claim it supported is downgraded. This is the single
 *     most important check in the file: it is what stops a model inventing a
 *     requirement and quoting itself as evidence.
 *
 *  2. CAPABILITY CLAIMS ARE RE-CHECKED. If the model says the candidate has a
 *     skill, that skill has to exist in the candidate's actual profile. If it
 *     is not there, the claim becomes "we could not find evidence of this",
 *     never "you do not have this".
 *
 *  3. DETERMINISTIC FACTS ARE RE-APPLIED. Work arrangement, location,
 *     eligibility, time zone, compensation and the overall category are all
 *     recomputed here and the model's version is discarded where it differs.
 *
 *  4. EVERYTHING IS BOUNDED. Lengths, array sizes and enum shapes are
 *     re-applied to provider output, because a schema hint is not a validation
 *     pass.
 *
 * Pure: the same input and the same job text always give the same output, which
 * is what makes it testable without a provider.
 */

import { clampRelationship, type TitleRelationship } from './title-fit';
import { deriveOverallCategory } from './categories';
import {
  JOB_INTELLIGENCE_MAX_EVIDENCE_CHARS,
  JOB_INTELLIGENCE_MIN_EVIDENCE_CHARS,
  JOB_INTELLIGENCE_MAX_REQUIREMENTS,
} from './limits';
import type { DeterministicInputs } from './deterministic';
import {
  ANALYSIS_PROMPT_VERSION,
  ANALYSIS_SCHEMA_VERSION,
  type AnalysisMeta,
  type DimensionAnalysis,
  type DimensionMap,
  type DimensionOutcome,
  type Evidence,
  type JobIntelligenceResult,
  type ModelAnalysis,
  type OverallCategory,
  type RecommendationAction,
  type RequirementAnalysis,
  type SeniorityOutcome,
  type WorkArrangement,
} from './schema';

/** Canonical comparison key. Same shape the resume feature uses. */
export function normaliseKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, ' ')
    .trim();
}

/**
 * Does this quote actually appear in the source text?
 *
 * Compares on a punctuation-free, whitespace-collapsed form so line wrapping
 * and bullet glyphs do not cause false negatives. Very short quotes are not
 * accepted: a three-character match proves nothing.
 */
export function excerptAppearsIn(excerpt: string, sourceText: string): boolean {
  const needle = normaliseKey(excerpt);
  if (needle.length < JOB_INTELLIGENCE_MIN_EVIDENCE_CHARS) return false;
  return normaliseKey(sourceText).includes(needle);
}

function tidy(value: string | null | undefined, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/**
 * Phrases that assert absence of a capability as fact.
 *
 * The brief is explicit: "we couldn't find evidence of this skill in your
 * current profile" is correct, "you do not have this skill" is not. A model
 * that gets this wrong is corrected here rather than argued with in the UI,
 * because the wording is the difference between a useful tool and one that
 * makes unsupported claims about a person's ability.
 */
const ABSENCE_CLAIM_PATTERNS: RegExp[] = [
  /\byou (?:do not|don't|doesn't|cannot|can't|could not|couldn't) (?:have|know|possess|show|have experience with|be experienced in)\b/i,
  /\byour (?:profile|resume|cv|record) (?:does not|doesn't|lacks|has no) (?:include|mention|show|contain|list|evidence of)\b/i,
  /\bthe candidate (?:does not|doesn't|cannot|can't) (?:have|know|possess|show)\b/i,
  /\bno evidence (?:that )?(?:you|the candidate) (?:have|has|knows|possesses|is experienced)\b/i,
];

/** Phrases that make a promise this product cannot keep. */
const PROMISE_PATTERNS: RegExp[] = [
  /\bguarantee[ds]?\b/i,
  /\b(?:will|would|can|could) (?:get|receive|secure|land)\b[^.]{0,24}?\b(?:interview|offer|job|role)\b/i,
  /\byou (?:will|'ll|are going to|are likely to) (?:get|receive|land|be offered)\b/i,
  /\b(?:we|they|the (?:employer|company|role)) (?:will|can|would) sponsor\b/i,
  /\bsponsorship (?:is )?(?:available|provided|included|offered)\b/i,
  /\bwill sponsor\b/i,
  /\bcertain(?:ly)? to (?:get|succeed|land|receive)\b/i,
  /\b100% (?:match|chance|likely)\b/i,
  /\b(?:is|are) (?:a )?(?:sure|guaranteed) (?:match|fit)\b/i,
];

/**
 * Phrases that issue a legal or immigration determination.
 *
 * Deliberately broad. This product never says whether a person may legally
 * work somewhere; a near-miss that slips through is a claim we cannot stand
 * behind, and a false positive here only makes the wording more cautious.
 */
const LEGAL_DETERMINATION_PATTERNS: RegExp[] = [
  /\byou(?:'re| are)?\s+(?:legally\s+)?(?:eligible|ineligible|not eligible)\b/i,
  /\byou can legally work\b/i,
  /\byou (?:cannot|can't|could not|couldn't) legally work\b/i,
  /\b(?:this|the) (?:role|job|position) is (?:eligible|ineligible) (?:to|work) (?:work|in|for)\b/i,
  /\bis (?:eligible|ineligible) (?:to )?work (?:in|at|from)\b/i,
  /\bwork authori[sz]ation (?:is|'s) (?:confirmed|verified|granted|not required)\b/i,
  /\b(?:you|the candidate) (?:may|can) (?:legally )?work (?:in|at|for)\b/i,
  /\blegally (?:able|entitled) to work\b/i,
];

/**
 * Does this text contain a claim we are not willing to store?
 *
 * A match means the text is neutralised — replaced with a statement we can
 * actually stand behind — not deleted. Removing an explanation entirely would
 * leave the user with a gap and no idea why.
 */
export function containsUnsupportableClaim(text: string): boolean {
  return (
    ABSENCE_CLAIM_PATTERNS.some((pattern) => pattern.test(text)) ||
    PROMISE_PATTERNS.some((pattern) => pattern.test(text)) ||
    LEGAL_DETERMINATION_PATTERNS.some((pattern) => pattern.test(text))
  );
}

/**
 * The replacement used when a claim cannot stand.
 *
 * The wording is chosen so it remains useful: the user is told what we checked
 * and what to do next, rather than being handed a refusal.
 */
export function neutralisedCopy(kind: 'capability' | 'promise' | 'legal' | 'excerpt'): string {
  switch (kind) {
    case 'capability':
      return "We could not find evidence of this in your current profile. That is not the same as you not having it — if you do, adding it will change this result.";
    case 'promise':
      return 'We cannot predict how an application will turn out. This is guidance on fit, not a forecast.';
    case 'legal':
      return 'Confirm this with the employer. We do not make legal or work-authorisation determinations.';
    default:
      return 'We could not verify this against the job posting, so we have not included it.';
  }
}

/**
 * Fix one piece of evidence.
 *
 * `JOB_DESCRIPTION` excerpts must be findable in the posting. Everything else
 * is metadata the application already holds, so it is kept but bounded — the
 * model is not re-deriving it, it is describing something we supplied.
 */
function verifyEvidence(
  evidence: Evidence,
  sources: { jobText: string; profileText: string },
): Evidence | null {
  const supports = tidy(evidence.supports, 280);
  if (!supports) return null;

  const field = tidy(evidence.field, 160) ?? 'unknown';

  // An excerpt we cannot find is not evidence. It is dropped entirely so the
  // UI never shows a quote that does not exist in the source.
  if (evidence.excerpt) {
    const excerpt = tidy(evidence.excerpt, JOB_INTELLIGENCE_MAX_EVIDENCE_CHARS);
    if (!excerpt) return { source: evidence.source, field, excerpt: null, supports };

    const haystack = evidence.source === 'JOB_DESCRIPTION' ? sources.jobText : sources.profileText;
    if (!excerptAppearsIn(excerpt, haystack)) {
      // Not verifiable. Keep the claim, drop the quote, and say why.
      const reason = neutralisedCopy('excerpt');
      return { source: evidence.source, field, excerpt: null, supports: `${supports} (${reason})` };
    }
    return { source: evidence.source, field, excerpt, supports };
  }

  return { source: evidence.source, field, excerpt: null, supports };
}

function verifyEvidenceList(
  evidence: Evidence[],
  sources: { jobText: string; profileText: string },
  max = 6,
): Evidence[] {
  const out: Evidence[] = [];
  for (const item of evidence) {
    const verified = verifyEvidence(item, sources);
    if (!verified) continue;
    if (containsUnsupportableClaim(verified.supports)) {
      out.push({
        ...verified,
        supports: neutralisedClaimFor(verified.supports),
      });
      continue;
    }
    out.push(verified);
  }
  return out.slice(0, max);
}

/**
 * Rewrite an unsupportable claim into one we can stand behind, preserving as
 * much of the original meaning as is honest.
 */
function neutralisedClaimFor(text: string): string {
  const legal = LEGAL_DETERMINATION_PATTERNS.some((pattern) => pattern.test(text));
  if (legal) return neutralisedCopy('legal');

  const promise = PROMISE_PATTERNS.some((pattern) => pattern.test(text));
  if (promise) return neutralisedCopy('promise');

  return neutralisedCopy('capability');
}

function tidyText(value: string, max: number, fallback: string): string {
  return tidy(value, max) ?? fallback;
}

/**
 * Does the candidate's profile actually contain this skill?
 *
 * Matched on normalised tokens plus a containment fallback, because
 * "PostgreSQL" and "Postgres" are the same skill and "React" and "React
 * Native" are not. When nothing matches we report absence of EVIDENCE, which
 * is a statement about the profile rather than about the person.
 */
export function profileSupportsSkill(profile: ProfileEvidence, requirement: string): boolean {
  const needle = normaliseKey(requirement);
  if (!needle) return false;

  for (const skill of profile.skillNames) {
    if (!skill) continue;
    if (skill === needle) return true;
    if (skill.includes(needle) || needle.includes(skill)) {
      // Guard against a two-character "skill" matching everything.
      if (skill.length >= 4 && needle.length >= 4) return true;
    }
  }

  return profile.experienceTitles.some((title) => title.includes(needle) || needle.includes(title));
}

/** The subset of profile data verification needs. */
export type ProfileEvidence = {
  skillNames: string[];
  experienceTitles: string[];
};

/**
 * Is this requirement a skill or qualification rather than a soft duty?
 *
 * Used only to decide whether a capability claim needs a profile check. Being
 * wrong in the cautious direction is fine: an extra check costs nothing,
 * a missed check lets an unsupported claim through.
 */
const CAPABILITY_HINTS = [
  'experience',
  'experience with',
  'knowledge of',
  'proficiency',
  'familiar with',
  'skilled',
  'ability',
  'certification',
  'certified',
  'degree',
  'licence',
  'license',
];

export function looksLikeCapabilityRequirement(requirement: string): boolean {
  const value = requirement.toLowerCase();
  return CAPABILITY_HINTS.some((hint) => value.includes(hint));
}

// ─── Dimension re-application ───────────────────────────────────────────────

/**
 * The deterministic outcome for each dimension, which the model may not
 * contradict.
 *
 * `titleFit` and `seniorityFit` are NOT in this table. Title fit is advisory by
 * design — it explains the deterministic `titleMatch` boolean rather than
 * replacing it — and seniority genuinely requires reading responsibilities,
 * leadership scope and stated experience, which is judgement the model is
 * better placed to make than a keyword rule. Both are bounded rather than
 * replaced: the title relationship is clamped to the deterministic ceiling, and
 * seniority is checked against the user's stated target level.
 */
export function deterministicDimensionOutcome(
  key: keyof DimensionMap,
  inputs: DeterministicInputs,
): DimensionOutcome | null {
  switch (key) {
    case 'remoteWork':
      return inputs.remoteCompatibility.outcome;
    case 'location':
      return inputs.locationCompatibility.outcome;
    case 'timeZone':
      return inputs.timeZoneCompatibility.outcome;
    case 'eligibility':
      return inputs.eligibilityCompatibility.outcome;
    case 'compensation':
      // The compensation vocabulary is finer-grained than the dimension one.
      // A salary the employer did not state is NOT_APPLICABLE — there is no
      // requirement to fail — not MISMATCH, which would mark every undisclosed
      // salary as a problem.
      switch (inputs.compensation.outcome) {
        case 'NOT_STATED_BY_EMPLOYER':
          return 'NOT_APPLICABLE';
        case 'NOT_COMPARABLE':
          return 'UNKNOWN';
        case 'WITHIN_PREFERENCE':
          return 'MATCH';
        case 'BELOW_PREFERENCE':
          return 'MISMATCH';
        case 'ABOVE_PREFERENCE':
          return 'MATCH';
        case 'PARTIALLY_OVERLAPPING':
          return 'PARTIAL_MATCH';
        default:
          return 'UNKNOWN';
      }
    default:
      return null;
  }
}

/** Copy to use when the model's explanation of a fixed dimension is discarded. */
const DETERMINISTIC_EXPLANATION: Record<
  'remoteWork' | 'location' | 'timeZone' | 'eligibility' | 'compensation',
  (inputs: DeterministicInputs) => string
> = {
  remoteWork: (inputs) => inputs.remoteCompatibility.explanation,
  location: (inputs) => inputs.locationCompatibility.explanation,
  timeZone: (inputs) => inputs.timeZoneCompatibility.explanation,
  eligibility: (inputs) => inputs.eligibilityCompatibility.explanation,
  compensation: (inputs) => inputs.compensation.explanation,
};

const DIMENSION_EVIDENCE: Partial<
  Record<keyof DimensionMap, (inputs: DeterministicInputs) => Evidence[]>
> = {
  remoteWork: (inputs) =>
    inputs.workArrangement.evidenceText
      ? [
          {
            source: inputs.jobText ? 'JOB_DESCRIPTION' : 'JOB_METADATA',
            field: 'JobLead.remoteType',
            excerpt: inputs.workArrangement.evidenceText,
            supports: 'The work arrangement this role states.',
          },
        ]
      : [],
  location: (inputs) =>
    inputs.job.location
      ? [
          {
            source: 'JOB_METADATA',
            field: 'JobLead.location',
            excerpt: inputs.job.location,
            supports: 'The location this role states.',
          },
        ]
      : [],
  eligibility: (inputs) =>
    inputs.job.eligibilityRegion
      ? [
          {
            source: 'JOB_METADATA',
            field: 'JobLead.eligibilityRegion',
            excerpt: inputs.job.eligibilityRegion,
            supports: 'The eligibility restriction this role states.',
          },
        ]
      : [],
  timeZone: (inputs) =>
    inputs.job.timezoneRequirement
      ? [
          {
            source: 'JOB_METADATA',
            field: 'JobLead.timezoneRequirement',
            excerpt: inputs.job.timezoneRequirement,
            supports: 'The time-zone requirement this role states.',
          },
        ]
      : [],
  compensation: (inputs) =>
    inputs.job.salaryMin != null || inputs.job.salaryMax != null
      ? [
          {
            source: 'JOB_METADATA',
            field: 'JobLead.salaryMin',
            excerpt:
              inputs.job.salaryMin != null
                ? `From ${inputs.job.salaryMin} ${inputs.job.currency}`
                : `Up to ${inputs.job.salaryMax} ${inputs.job.currency}`,
            supports: 'The compensation this role states.',
          },
        ]
      : [],
};

/**
 * Verify one dimension.
 *
 * Where the application already knows the answer, the model's outcome and
 * explanation are discarded and ours are used. Where it does not — skills,
 * experience, education, title, seniority — the model's reasoning stands, after
 * its evidence has been checked.
 */
export function verifyDimension(params: {
  key: keyof DimensionMap;
  dimension: DimensionAnalysis;
  inputs: DeterministicInputs;
  sources: { jobText: string; profileText: string };
}): DimensionAnalysis {
  const { key, dimension, inputs, sources } = params;

  const deterministicOutcome = deterministicDimensionOutcome(key, inputs);
  const evidence = verifyEvidenceList(dimension.evidence, sources);

  if (deterministicOutcome !== null) {
    const fixed = key as keyof typeof DETERMINISTIC_EXPLANATION;
    const explanation = DETERMINISTIC_EXPLANATION[fixed]?.(inputs) ?? dimension.explanation;
    const builder = DIMENSION_EVIDENCE[fixed];
    return {
      outcome: deterministicOutcome,
      explanation: tidyText(explanation, 600, 'We could not describe this dimension.'),
      // Our evidence is generated from real fields, so it replaces the model's
      // rather than being merged with it.
      evidence: builder ? builder(inputs) : evidence,
      uncertainty:
        deterministicOutcome === 'UNKNOWN'
          ? tidy(dimension.uncertainty, 300) ?? 'This employer did not state enough to compare it against your preferences.'
          : null,
    };
  }

  return {
    outcome: dimension.outcome,
    explanation: containsUnsupportableClaim(dimension.explanation)
      ? neutralisedClaimFor(dimension.explanation)
      : tidyText(dimension.explanation, 600, 'We could not describe this dimension.'),
    evidence,
    uncertainty: tidy(dimension.uncertainty, 300),
  };
}

// ─── Requirement verification ───────────────────────────────────────────────

/**
 * Verify one requirement against the job text and the candidate's profile.
 *
 * The rule that matters here: a capability claim requires profile evidence. A
 * model that asserts the candidate meets a skill requirement when the profile
 * has no trace of it is corrected to "no evidence found" — never to a mismatch,
 * because "not in the profile" is not "cannot do".
 */
export function verifyRequirement(params: {
  requirement: RequirementAnalysis;
  inputs: DeterministicInputs;
  sources: { jobText: string; profileText: string };
}): RequirementAnalysis | null {
  const { requirement, inputs, sources } = params;

  const text = tidy(requirement.requirement, 280);
  if (!text) return null;

  let outcome: DimensionOutcome = requirement.outcome;
  let explanation = tidy(requirement.explanation, 600) ?? '';
  let uncertainty = tidy(requirement.uncertainty, 300);

  const evidence = verifyEvidenceList(requirement.evidence, sources, 5);
  const isCapability = looksLikeCapabilityRequirement(text);
  const supported = isCapability ? profileSupportsSkill(inputs.profile, text) : false;

  if (isCapability) {
    if (outcome === 'MATCH' && !supported) {
      // The model claims the candidate meets this. The profile does not show it.
      outcome = 'UNKNOWN';
      explanation = neutralisedCopy('capability');
      uncertainty = 'Add this to your career profile if you do have it — that would change this result.';
    } else if (outcome === 'MISMATCH') {
      // A capability cannot be judged missing from a profile that does not
      // mention it. This is the single most important correction in the file.
      outcome = 'UNKNOWN';
      explanation = neutralisedCopy('capability');
      uncertainty = tidy(requirement.uncertainty, 300);
    }
  }

  if (containsUnsupportableClaim(explanation)) {
    explanation = neutralisedClaimFor(explanation);
  }

  return {
    requirement: text,
    importance: requirement.importance,
    outcome,
    explanation: explanation || 'We could not describe this requirement.',
    evidence,
    uncertainty,
  };
}

// ─── Seniority bounding ────────────────────────────────────────────────────

/**
 * Keep a seniority conclusion consistent with the user's stated target.
 *
 * The model reads responsibilities and leadership scope, which is real
 * judgement. But it must not tell a user targeting senior IC roles that a
 * junior position is a good match, or vice versa. When the model's answer
 * contradicts a stated target we keep theirs but mark the uncertainty, so the
 * user sees the tension rather than having it smoothed over.
 */
export function boundSeniorityOutcome(params: {
  outcome: SeniorityOutcome;
  targetLevel: string;
}): SeniorityOutcome {
  const { outcome, targetLevel } = params;
  if (targetLevel === 'FLEXIBLE') return outcome;

  const seniorOutcomes: SeniorityOutcome[] = ['STRETCH_ROLE', 'ABOVE_TARGET'];
  const juniorOutcomes: SeniorityOutcome[] = ['BELOW_TARGET'];

  if (targetLevel === 'SENIOR' && seniorOutcomes.includes(outcome)) return 'POTENTIALLY_APPROPRIATE';
  if (targetLevel === 'ENTRY' && juniorOutcomes.includes(outcome)) return 'POTENTIALLY_APPROPRIATE';
  return outcome;
}

// ─── Recommendations ───────────────────────────────────────────────────────

/**
 * Recommendations must be grounded in something real.
 *
 * An ungrounded "tailor your resume to this role" is filler. Each action is
 * checked against what the analysis actually found: a confirmation prompt is
 * only kept when there is an unresolved restriction, a salary prompt only when
 * a salary is genuinely missing, and a profile-update prompt only when
 * something is genuinely missing from the profile.
 */
export function verifyRecommendations(params: {
  recommendations: ModelAnalysis['recommendations'];
  inputs: DeterministicInputs;
  category: OverallCategory;
}): ModelAnalysis['recommendations'] {
  const { recommendations, inputs, category } = params;

  const grounded = new Set<RecommendationAction>();

  if (
    inputs.locationCompatibility.requiresConfirmation ||
    inputs.eligibilityCompatibility.requiresConfirmation ||
    inputs.remoteCompatibility.outcome === 'PARTIAL_MATCH'
  ) {
    grounded.add('VERIFY_REMOTE_ELIGIBILITY');
    grounded.add('CONFIRM_WITH_EMPLOYER');
  }

  if (
    inputs.compensation.outcome === 'NOT_STATED_BY_EMPLOYER' ||
    inputs.compensation.currencyMismatch
  ) {
    grounded.add('CLARIFY_SALARY_RANGE');
    grounded.add('CONFIRM_WITH_EMPLOYER');
  }

  if (!inputs.hadJobDescription) grounded.add('ADD_JOB_DESCRIPTION');

  if (inputs.profile.missingInputs.length > 0) grounded.add('UPDATE_CAREER_PROFILE');

  if (
    inputs.titleRelationship.relationship === 'ADJACENT_OPPORTUNITY' ||
    inputs.titleRelationship.relationship === 'WEAK_MATCH' ||
    inputs.titleRelationship.relationship === 'INSUFFICIENT_INFORMATION'
  ) {
    grounded.add('CONSIDER_ADJACENT_ROLE');
    grounded.add('REVIEW_TARGET_TITLES');
  }

  if (inputs.profile.skillNames.length === 0 && inputs.profile.experienceTitles.length === 0) {
    grounded.add('EMPHASISE_EXISTING_EVIDENCE');
  }

  if (category === 'INSUFFICIENT_INFORMATION') grounded.add('UPDATE_CAREER_PROFILE');

  const out = recommendations
    .filter((recommendation) => grounded.has(recommendation.action))
    .map((recommendation) => ({
      action: recommendation.action,
      detail: containsUnsupportableClaim(recommendation.detail)
        ? neutralisedClaimFor(recommendation.detail)
        : tidyText(recommendation.detail, 600, 'Confirm this with the employer.'),
      rationale: tidyText(recommendation.rationale, 280, 'Based on what the analysis found.'),
    }));

  // An empty list is a valid answer. Manufacturing tasks to fill it would be
  // worse than saying nothing.
  return out.slice(0, 6);
}

// ─── Assembly ───────────────────────────────────────────────────────────────

/**
 * Produce the analysis that will actually be stored and shown.
 *
 * Everything the model said passes through here first. Pure: the same model
 * output and the same inputs always give the same result.
 */
export function verifyJobAnalysis(params: {
  model: ModelAnalysis;
  inputs: DeterministicInputs;
  sources: { jobText: string; profileText: string };
  provider: string;
  modelName: string;
  generatedAt: Date;
}): JobIntelligenceResult {
  const { model, inputs, sources, provider, modelName, generatedAt } = params;

  // ── Dimensions ─────────────────────────────────────────────────────────
  const dimensions = {} as DimensionMap;
  for (const key of Object.keys(model.dimensions) as Array<keyof DimensionMap>) {
    dimensions[key] = verifyDimension({
      key,
      dimension: model.dimensions[key],
      inputs,
      sources,
    });
  }

  // ── Title relationship, clamped to the deterministic ceiling ──────────
  const titleRelationship = clampRelationship(
    model.titleRelationship as TitleRelationship,
    inputs.titleMatch,
  ) as TitleRelationship;

  // The titleFit dimension must not claim a stronger relationship than the
  // overall one does.
  if (
    (titleRelationship === 'DIRECT_TARGET_MATCH' || titleRelationship === 'RELATED_ROLE') &&
    dimensions.jobTitleFit.outcome === 'MISMATCH'
  ) {
    dimensions.jobTitleFit = {
      ...dimensions.jobTitleFit,
      outcome: 'PARTIAL_MATCH',
    };
  }

  // ── Seniority, bounded by the stated target ───────────────────────────
  const seniorityOutcome = boundSeniorityOutcome({
    outcome: model.seniorityOutcome,
    targetLevel: inputs.preferences.targetLevel,
  });

  // ── Deterministic enums win ───────────────────────────────────────────
  const workArrangement: WorkArrangement = inputs.workArrangement.arrangement;

  // ── Requirements ──────────────────────────────────────────────────────
  const requirements: RequirementAnalysis[] = [];
  const seenRequirements = new Set<string>();
  for (const requirement of model.requirements.slice(0, JOB_INTELLIGENCE_MAX_REQUIREMENTS)) {
    const verified = verifyRequirement({ requirement, inputs, sources });
    if (!verified) continue;
    const key = normaliseKey(verified.requirement);
    if (!key || seenRequirements.has(key)) continue;
    seenRequirements.add(key);
    requirements.push(verified);
  }

  // ── Overall category, re-derived ──────────────────────────────────────
  const dimensionOutcomes: Partial<Record<keyof DimensionMap, DimensionOutcome>> = {};
  for (const key of Object.keys(dimensions) as Array<keyof DimensionMap>) {
    dimensionOutcomes[key] = dimensions[key].outcome;
  }

  const decision = deriveOverallCategory({
    fitTier: inputs.fitTier,
    blockedBy: inputs.blockedBy,
    titleRelationship,
    seniorityOutcome,
    profileCompleteness: inputs.profile.completeness,
    hadJobDescription: inputs.hadJobDescription,
    dimensions: dimensionOutcomes,
    proposed: model.overallCategory,
  });

  // ── Recommendations ───────────────────────────────────────────────────
  const recommendations = verifyRecommendations({
    recommendations: model.recommendations,
    inputs,
    category: decision.category,
  });

  // ── Limitations: the model's, plus what we know is missing ────────────
  const limitations = [
    ...model.limitations.map((item) => tidy(item, 280)).filter((item): item is string => Boolean(item)),
    ...inputs.profile.missingInputs.map(
      (missing) => `We are missing ${missing}, which limits how confidently we could compare this role.`,
    ),
  ];

  const dedupedLimitations = [...new Set(limitations.map((item) => normaliseKey(item)))]
    .map((key) => limitations.find((item) => normaliseKey(item) === key)!)
    .slice(0, 12);

  if (!inputs.hadJobDescription) {
    dedupedLimitations.unshift(
      'This job has no description saved, so the analysis is based on the role details alone. Add the description and run it again for a fuller picture.',
    );
  }

  const meta: AnalysisMeta = {
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    promptVersion: ANALYSIS_PROMPT_VERSION,
    inputFingerprint: inputs.inputFingerprint,
    generatedAt: generatedAt.toISOString(),
    dataCompleteness: inputs.dataCompleteness,
    provider,
    model: modelName,
    hadJobDescription: inputs.hadJobDescription,
    hadConfirmedCareerProfile: inputs.profile.confirmed,
  };

  return {
    meta,
    overallCategory: decision.category,
    categoryRationale: tidyText(decision.rationale, 600, 'Based on your scoring engine and the evidence we found.'),
    deterministic: {
      fitScore: inputs.fitScore,
      fitTier: inputs.fitTier,
      titleMatch: inputs.titleMatch,
      blockedBy: inputs.blockedBy,
    },
    summary: containsUnsupportableClaim(model.summary)
      ? neutralisedClaimFor(model.summary)
      : tidyText(model.summary, 600, 'We could not summarise this role.'),
    titleRelationship,
    seniorityOutcome,
    workArrangement,
    compensationOutcome: inputs.compensation.outcome,
    dimensions,
    requirements,
    recommendations,
    limitations: dedupedLimitations.slice(0, 12),
  };
}

/**
 * Dimensions that are fixed by the application and may not be argued with.
 *
 * Exported so the prompt, the tests and the UI all agree on which ones.
 */
export const FIXED_DIMENSIONS: ReadonlyArray<keyof DimensionMap> = [
  'remoteWork',
  'location',
  'timeZone',
  'eligibility',
  'compensation',
] as const;

/** Dimensions where the model's judgement is the answer. */
export const MODEL_JUDGEMENT_DIMENSIONS: ReadonlyArray<keyof DimensionMap> = [
  'jobTitleFit',
  'seniorityFit',
  'requiredSkills',
  'preferredSkills',
  'relevantExperience',
  'education',
] as const;
