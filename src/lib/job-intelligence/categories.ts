/**
 * Overall category derivation.
 *
 * The brief asks for a human-readable verdict, and asks that it never
 * override a mandatory business constraint. Those two requirements together
 * mean the category cannot be a free-form model output — a model that says
 * "Strong match" must not be able to talk a user into applying to a job their
 * own scoring engine already zeroed for ineligibility.
 *
 * So the rule is: the model proposes, and this module disposes.
 *
 *  1. The deterministic `calculateFitTier()` result is the floor of the
 *     category. A tier-A job cannot come back as anything below
 *     `POTENTIAL_MATCH`; a tier-D job cannot come back as `STRONG_MATCH`.
 *
 *  2. A hard block — geography or time zone scored zero, or a confirmed
 *     title conflict — caps the category at `LOW_MATCH` no matter what the
 *     model proposed. This is the "category cannot override mandatory business
 *     constraints" rule, enforced in code rather than in a prompt.
 *
 *  3. When the inputs are too thin to say anything defensible, the answer is
 *     `INSUFFICIENT_INFORMATION`. False certainty is worse than admitted
 *     uncertainty.
 *
 * The relationship between the existing product vocabulary (A/B/C/D) and the
 * qualitative categories is defined here once, and is the only place it is
 * defined.
 */

import type { OverallCategory } from './schema';
import type { DimensionOutcome } from './schema';
import type { TitleRelationship } from './title-fit';
import type { ProfileCompleteness } from './profile-context';

/**
 * Category implied by each existing fit tier.
 *
 * `INSIDE_GOOD_ENOUGH` marks the weakest category still compatible with a tier:
 * a job the engine scored well is never described to the user as a low match,
 * because that would contradict a number they can see next to it.
 */
export const TIER_CATEGORY: Record<string, { category: OverallCategory; inside: OverallCategory }> = {
  A: { category: 'STRONG_MATCH', inside: 'POTENTIAL_MATCH' },
  B: { category: 'POTENTIAL_MATCH', inside: 'LOW_MATCH' },
  C: { category: 'STRETCH_OPPORTUNITY', inside: 'LOW_MATCH' },
  D: { category: 'LOW_MATCH', inside: 'LOW_MATCH' },
};

const CATEGORY_RANK: Record<OverallCategory, number> = {
  INSUFFICIENT_INFORMATION: -1,
  LOW_MATCH: 0,
  STRETCH_OPPORTUNITY: 1,
  POTENTIAL_MATCH: 2,
  STRONG_MATCH: 3,
};

export type CategoryInput = {
  /** The application's own tier from `calculateFitTier()`. */
  fitTier: string;
  /** Hard gates that zeroed the score, from the deterministic engine. */
  blockedBy: string[];
  titleRelationship: TitleRelationship;
  seniorityOutcome: string;
  /** How much we could actually compare. */
  profileCompleteness: ProfileCompleteness;
  /** Whether a real job description was available. */
  hadJobDescription: boolean;
  dimensions: Partial<Record<string, DimensionOutcome>>;
  /** The model's proposal. Advisory; never trusted on its own. */
  proposed: OverallCategory;
};

export type CategoryDecision = {
  category: OverallCategory;
  /** True when the model's proposal was changed, and why. */
  adjusted: boolean;
  /** User-facing explanation of how the category was reached. */
  rationale: string;
};

/** A dimension that is a hard business constraint on this job. */
const CONSTRAINT_DIMENSIONS = ['location', 'remoteWork', 'eligibility'] as const;

export function deriveOverallCategory(input: CategoryInput): CategoryDecision {
  const tier = TIER_CATEGORY[input.fitTier] ?? TIER_CATEGORY.D;

  // 1. A hard block from the deterministic engine wins over everything.
  //    The user is told plainly, and the AI's opinion is not consulted.
  if (input.blockedBy.length > 0) {
    return {
      category: 'LOW_MATCH',
      adjusted: true,
      rationale: `This job scores 0 because of ${input.blockedBy.join(' and ')}. That is a rule in our matching engine, and it is not something an analysis can override.`,
    };
  }

  // 2. A confirmed role conflict is not a scoring nuance. Someone targeting
  //    individual-contributor engineering roles is not looking for a
  //    management job, however good the numbers look.
  if (input.titleRelationship === 'CONFLICTING_ROLE') {
    return {
      category: 'LOW_MATCH',
      adjusted: true,
      rationale:
        'This is a different kind of role from the ones you are targeting, so we have marked it a low match regardless of the rest of the fit.',
    };
  }

  // 3. Hard constraints that came back MISMATCH cap the category. We do not
  //    say "strong match" about a job the user cannot work.
  const constraintMismatch = CONSTRAINT_DIMENSIONS.filter(
    (key) => input.dimensions[key] === 'MISMATCH',
  );
  if (constraintMismatch.length > 0) {
    return {
      category: 'LOW_MATCH',
      adjusted: true,
      rationale: `This role does not fit your ${constraintMismatch.join(' or ')} requirements, so it cannot be a strong match whatever else it offers.`,
    };
  }

  // 4. Not enough data to say anything defensible. Admit it.
  const tooThin =
    input.profileCompleteness === 'EMPTY' ||
    (input.profileCompleteness === 'MINIMAL' && !input.hadJobDescription) ||
    (input.titleRelationship === 'INSUFFICIENT_INFORMATION' && input.profileCompleteness !== 'COMPLETE');

  if (tooThin) {
    return {
      category: 'INSUFFICIENT_INFORMATION',
      adjusted: true,
      rationale:
        'We do not have enough of your profile or of this job to give you a reliable verdict. The details we do have are below, and they are worth reading — but treat this as incomplete rather than as an answer.',
    };
  }

  // 5. Otherwise: the tier sets the floor, and the model's proposal can raise
  //    it by at most one step. It can never exceed the tier's own category.
  let category: OverallCategory = tier.category;

  const proposedRank = CATEGORY_RANK[input.proposed] ?? -1;
  const baseRank = CATEGORY_RANK[tier.category];

  if (proposedRank > baseRank && proposedRank === baseRank + 1) {
    category = input.proposed;
  }

  // The ceiling for this tier: a strong-scoring job is never described as a
  // low match, because the user can see the number that says otherwise.
  const insideRank = CATEGORY_RANK[tier.inside];
  if (CATEGORY_RANK[category] < insideRank) {
    category = tier.inside;
  }

  return {
    category,
    adjusted: category !== input.proposed,
    rationale:
      category === input.proposed
        ? `This matches your profile scoring (tier ${input.fitTier}). The detail below explains where that comes from.`
        : `We have adjusted this from the model's read to keep it consistent with your scoring engine (tier ${input.fitTier}).`,
  };
}

/** User-facing label for each category. Plain words, no jargon. */
export const CATEGORY_LABELS: Record<OverallCategory, string> = {
  STRONG_MATCH: 'Strong match',
  POTENTIAL_MATCH: 'Potential match',
  STRETCH_OPPORTUNITY: 'Stretch opportunity',
  LOW_MATCH: 'Low match',
  INSUFFICIENT_INFORMATION: 'Not enough information yet',
};

/** One-line explanation shown under the badge, before the detail. */
export const CATEGORY_DESCRIPTIONS: Record<OverallCategory, string> = {
  STRONG_MATCH: 'Your experience and preferences line up well with what this role asks for.',
  POTENTIAL_MATCH: 'Most of this lines up, with a few gaps worth understanding before you apply.',
  STRETCH_OPPORTUNITY:
    'This is a step in a direction you have not taken before, or asks for more than your profile currently shows.',
  LOW_MATCH: 'There is a meaningful conflict between what you are looking for and what this role offers.',
  INSUFFICIENT_INFORMATION:
    'We are missing too much to give you a reliable answer. Fill in what is listed below and run this again.',
};