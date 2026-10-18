/**
 * Title relationship classification.
 *
 * `titleMatchesAny()` in `src/lib/preferences.ts` is the product's
 * deterministic title rule and it is NOT modified by this release. It is a
 * substring test in both directions, which is the right rule for "does this
 * title match one of mine" and too coarse for "how close is it".
 *
 * This module supplies the second question. It is advisory: it explains
 * relatedness to the user, and it can only ever agree with or downgrade the
 * deterministic result, never upgrade past it. A job the scoring engine calls a
 * title match can still be described as a weak one; a job it calls a miss can
 * never be described as a direct target match.
 *
 * The leadership guard exists because of a concrete false positive in the
 * substring rule: a user whose only target is "Software Engineer" is currently
 * matched against "Software Engineering Manager", because one normalised
 * string contains the other. A similarly named managerial role is not the same
 * job.
 */

/**
 * Tokens that indicate a people-management role.
 *
 * Deliberately conservative. "Lead" is excluded on its own because
 * "Tech Lead" is frequently an individual-contributor role, and "Lead
 * Engineer" is more often a senior IC title than a management one; treating
 * those as managerial would produce the opposite false positive.
 */
const LEADERSHIP_TOKENS = [
  'manager',
  'management',
  'head of',
  'director',
  'supervisor',
  'team lead role',
] as const;

/** Tokens that indicate an explicitly non-managerial senior IC role. */
const INDIVIDUAL_CONTRIBUTOR_TOKENS = [
  'lead',
  'principal',
  'staff',
  'architect',
  'specialist',
  'engineer',
  'developer',
  'designer',
  'analyst',
  'scientist',
  'consultant',
] as const;

export type TitleRelationship =
  | 'DIRECT_TARGET_MATCH'
  | 'RELATED_ROLE'
  | 'ADJACENT_OPPORTUNITY'
  | 'WEAK_MATCH'
  | 'CONFLICTING_ROLE'
  | 'INSUFFICIENT_INFORMATION';

export type TitleClassification = {
  relationship: TitleRelationship;
  /** Which of the user's targets this was compared against, if any. */
  matchedTarget: string | null;
  /** Why it landed here, in plain words. Rendered next to the badge. */
  reason: string;
};

/** Canonical comparison key. Same shape as `preferences.normalizeTitle`. */
export function normalizeTitleTokens(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function hasLeadershipToken(value: string): boolean {
  return LEADERSHIP_TOKENS.some((token) => value.includes(token));
}

function hasIndividualContributorToken(value: string): boolean {
  return INDIVIDUAL_CONTRIBUTOR_TOKENS.some((token) => value.includes(token));
}

/**
 * All the titles this user is looking for, in one list.
 *
 * Undefined when the user has set none. That is a meaningful distinction: a
 * user who has not chosen targets is not a poor match, they are an
 * unexpressed preference, and the analysis says so rather than guessing.
 */
export function collectTargetTitles(preferences: {
  targetRoles: string[];
  preferredTitles: string[];
}): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...preferences.targetRoles, ...preferences.preferredTitles]) {
    const value = normalizeTitleTokens(raw ?? '');
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(raw.trim());
  }
  return out;
}

/**
 * Does this job title contain a leadership signal the user's targets do not?
 *
 * This is the guard that stops "Software Engineering Manager" reading as a
 * direct match for "Software Engineer". It only fires when the user has given
 * us something to compare against — with no targets there is nothing to
 * contradict.
 */
export function isManagerialMismatch(jobTitle: string, targets: string[]): boolean {
  if (targets.length === 0) return false;

  const normalizedJob = normalizeTitleTokens(jobTitle);
  if (!hasLeadershipToken(normalizedJob)) return false;

  // If ANY target is itself managerial, the user is open to management and
  // there is nothing to reconcile.
  const anyManagerialTarget = targets.some((target) => hasLeadershipToken(normalizeTitleTokens(target)));
  if (anyManagerialTarget) return false;

  // The job is managerial but reads like an IC role underneath
  // ("Engineering Manager, Backend") — still a management role, and the user's
  // targets are IC roles. Keep the conflict.
  return !hasIndividualContributorToken(normalizedJob) || hasLeadershipToken(normalizedJob);
}

/**
 * Exact, token-level equality after normalisation.
 *
 * Stricter than the substring test on purpose: "Software Engineer" and
 * "Software Engineer II" are the same job, "Software Engineer" and
 * "Engineering Manager" are not.
 */
export function titlesAreEquivalent(jobTitle: string, target: string): boolean {
  return normalizeTitleTokens(jobTitle) === normalizeTitleTokens(target);
}

/**
 * Shared-word relationship, ignoring filler tokens.
 *
 * Used to separate "related role" from "adjacent opportunity" without claiming
 * a semantic similarity the data does not support.
 */
function sharedTokenRatio(jobTitle: string, target: string): number {
  const filler = new Set(['of', 'the', 'and', 'for', 'a', 'an', 'to', 'in', 'at', 'ii', 'iii']);
  const jobTokens = new Set(
    normalizeTitleTokens(jobTitle).split(' ').filter((token) => token && !filler.has(token)),
  );
  const targetTokens = new Set(
    normalizeTitleTokens(target).split(' ').filter((token) => token && !filler.has(token)),
  );
  if (jobTokens.size === 0 || targetTokens.size === 0) return 0;

  let shared = 0;
  for (const token of jobTokens) {
    if (targetTokens.has(token)) shared += 1;
  }
  return shared / Math.max(jobTokens.size, targetTokens.size);
}

/**
 * Classify how a job's title relates to the user's targets.
 *
 * The relationship this returns is capped by the deterministic result:
 *
 * - If `titleMatchesAny` said no, the ceiling is `RELATED_ROLE`. The model may
 *   not upgrade a job past that, and `verify.ts` enforces it.
 * - If `titleMatchesAny` said yes, the ceiling is `DIRECT_TARGET_MATCH`.
 *
 * That asymmetry is the whole point. The AI explains; the scoring engine
 * decides.
 */
export function classifyTitleRelationship(params: {
  jobTitle: string;
  targets: string[];
  /** The existing `titleMatchesAny` result. Advisory output cannot exceed it. */
  deterministicTitleMatch: boolean;
}): TitleClassification {
  const { jobTitle, targets, deterministicTitleMatch } = params;
  const normalizedJob = normalizeTitleTokens(jobTitle);

  if (!normalizedJob) {
    return {
      relationship: 'INSUFFICIENT_INFORMATION',
      matchedTarget: null,
      reason: 'This job has no title we could read.',
    };
  }

  if (targets.length === 0) {
    return {
      relationship: 'INSUFFICIENT_INFORMATION',
      matchedTarget: null,
      reason:
        'You have not set target job titles yet, so we cannot compare this role against what you are looking for.',
    };
  }

  // A managerial job against purely individual-contributor targets is a
  // conflict regardless of how similar the wording is.
  if (isManagerialMismatch(jobTitle, targets)) {
    const managerialTarget = targets.find((target) => hasLeadershipToken(normalizeTitleTokens(target)));
    return {
      relationship: managerialTarget ? 'RELATED_ROLE' : 'CONFLICTING_ROLE',
      matchedTarget: managerialTarget ?? null,
      reason: managerialTarget
        ? `"${jobTitle}" is a management role and your target "${managerialTarget}" is not, so this is related rather than a direct match.`
        : `"${jobTitle}" is a management role, and the roles you are targeting are individual-contributor roles.`,
    };
  }

  const equivalent = targets.find((target) => titlesAreEquivalent(jobTitle, target));
  if (equivalent) {
    return {
      relationship: 'DIRECT_TARGET_MATCH',
      matchedTarget: equivalent,
      reason: `The title matches your target "${equivalent}" exactly.`,
    };
  }

  const best = targets
    .map((target) => ({ target, ratio: sharedTokenRatio(jobTitle, target) }))
    .sort((a, b) => b.ratio - a.ratio)[0];

  if (!best || best.ratio === 0) {
    return {
      relationship: 'WEAK_MATCH',
      matchedTarget: null,
      reason: `"${jobTitle}" does not share meaningful wording with any of the roles you are targeting.`,
    };
  }

  const containment = best.ratio === 1;

  if (containment && deterministicTitleMatch) {
    return {
      relationship: 'DIRECT_TARGET_MATCH',
      matchedTarget: best.target,
      reason: `"${jobTitle}" matches your target "${best.target}" under the scoring rules.`,
    };
  }

  if (best.ratio >= 0.5) {
    return {
      relationship: containment ? 'RELATED_ROLE' : 'ADJACENT_OPPORTUNITY',
      matchedTarget: best.target,
      reason: `"${jobTitle}" is closely related to your target "${best.target}", but it is not the same role.`,
    };
  }

  return {
    relationship: 'WEAK_MATCH',
    matchedTarget: null,
    reason: `"${jobTitle}" only loosely relates to "${best.target}" from your target roles.`,
  };
}

/**
 * The strongest relationship an advisory answer is allowed to claim.
 *
 * Applied in `verify.ts` to whatever the model returns. A job the deterministic
 * engine scored as a title miss can never come back described as a direct
 * target match, however persuasive the model's explanation.
 */
export function maxRelationshipFor(deterministicTitleMatch: boolean): TitleRelationship {
  return deterministicTitleMatch ? 'DIRECT_TARGET_MATCH' : 'RELATED_ROLE';
}

const RELATIONSHIP_RANK: Record<TitleRelationship, number> = {
  DIRECT_TARGET_MATCH: 5,
  RELATED_ROLE: 4,
  ADJACENT_OPPORTUNITY: 3,
  INSUFFICIENT_INFORMATION: 2,
  WEAK_MATCH: 1,
  CONFLICTING_ROLE: 0,
};

/**
 * Clamp a relationship so it cannot exceed the deterministic ceiling.
 *
 * Pure and exported so the rule is unit-testable without a database or a
 * provider.
 */
export function clampRelationship(
  relationship: TitleRelationship,
  deterministicTitleMatch: boolean,
): TitleRelationship {
  const ceiling = maxRelationshipFor(deterministicTitleMatch);
  return RELATIONSHIP_RANK[relationship] <= RELATIONSHIP_RANK[ceiling] ? relationship : ceiling;
}