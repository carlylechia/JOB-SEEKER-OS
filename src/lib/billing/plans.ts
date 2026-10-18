/**
 * Centralised plan + feature + limit configuration.
 *
 * This module is the single source of truth for plan metadata, feature
 * entitlements and usage limits. Nothing in the UI or API layer should
 * hardcode a plan name, a price, or a limit — read it from here (or from the
 * `Plan` table, which is seeded from these definitions).
 *
 * Prices are stored as integer MINOR UNITS (e.g. cents) to avoid
 * floating-point arithmetic errors. `null` means pricing has not been decided,
 * and the UI must render "Contact us" rather than inventing an amount.
 */

export const PLAN_CODES = ['FREE', 'PRO', 'PREMIUM'] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

/** Ordered low → high. Used to reason about upgrades vs downgrades. */
export const PLAN_RANK: Record<PlanCode, number> = {
  FREE: 0,
  PRO: 1,
  PREMIUM: 2,
};

export function isPlanCode(value: unknown): value is PlanCode {
  return typeof value === 'string' && (PLAN_CODES as readonly string[]).includes(value);
}

export function isPaidPlan(code: PlanCode): boolean {
  return code !== 'FREE';
}

/**
 * Sentinel for "no limit". `null` rather than `Infinity`, because `Infinity`
 * serialises to `null` over JSON and would silently become an ambiguous value
 * in an API response.
 */
export const UNLIMITED = null;

export type PlanLimitValue = number | null;

/**
 * Provisional business configuration.
 *
 * NOTE: these limits are intentionally generous and marked provisional. They
 * gate NEW creation, never delete existing user data. Adjust here as the
 * business finalises pricing — do not scatter numbers through components.
 */
export const PLAN_LIMITS: Record<
  PlanCode,
  { jobs: PlanLimitValue; resumes: PlanLimitValue; aiCredits: PlanLimitValue }
> = {
  // Provisional — Free is a genuine tier, not a lockout.
  FREE: { jobs: 25, resumes: 1, aiCredits: 25 },
  // Provisional — paid tiers are unlimited until pricing is set.
  PRO: { jobs: UNLIMITED, resumes: 5, aiCredits: UNLIMITED },
  PREMIUM: { jobs: UNLIMITED, resumes: 10, aiCredits: UNLIMITED },
};

/** Human-readable limit: "Unlimited" or a number. */
export function formatLimit(limit: PlanLimitValue): string {
  return limit === null ? 'Unlimited' : String(limit);
}

/**
 * Stable capability identifiers. These describe WHAT a user can do, never
 * WHICH plan they pay for — so a plan rename never breaks business logic.
 */
export const FEATURE_KEYS = [
  'JOB_TRACKING',
  'PUBLIC_JOB_IMPORT',
  'ADVANCED_JOB_MATCHING',
  'RESUME_BUILDER',
  'RESUME_UPLOAD',
  'RESUME_OPTIMIZATION',
  'AI_JOB_ANALYSIS',
  'AI_COVER_LETTER',
  'AI_INTERVIEW_PREP',
  'AI_RESUME_PARSER',
  'CAREER_PROFILE_INTELLIGENCE',
  'PRIORITY_QUEUE',
  'ADVANCED_PREPARATION',
  'LINKEDIN_ENRICHMENT',
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export function isFeatureKey(value: unknown): value is FeatureKey {
  return typeof value === 'string' && (FEATURE_KEYS as readonly string[]).includes(value);
}

/**
 * Shared, metered allowances.
 *
 * A POOL is one budget a customer spends across SEVERAL features. `AI` is the
 * only one today, and it is what `PLAN_LIMITS[*].aiCredits` actually means: one
 * monthly allowance for AI-assisted work, not a separate allowance per feature.
 *
 * This is what `PLAN_MARKETING.PRO.highlights` already promises — "AI-assisted
 * resume and cover letter help" reads as a bundle — and it is what stops a new
 * feature from silently multiplying every customer's entitlement. Summing per
 * `featureKey`, as the accounting layer used to, meant a Free user with an
 * allowance of 25 could run 25 resume analyses AND 25 job analyses AND 25
 * resume optimisations in the same month: three times what they were sold, a
 * figure that grew again with every metered feature that shipped.
 *
 * `FEATURE_ENTITLEMENTS[feature].usagePool` declares which pool a feature spends
 * from, so the decision is forced where a feature is added — the cheapest place
 * to make it — rather than discovered once a customer has been overcharged.
 */
export const USAGE_POOLS = ['AI'] as const;
export type UsagePool = (typeof USAGE_POOLS)[number];

export function isUsagePool(value: unknown): value is UsagePool {
  return typeof value === 'string' && (USAGE_POOLS as readonly string[]).includes(value);
}

/**
 * Metadata for a feature key, or undefined when the key is unknown.
 * Lets callers fail safely on a typo or an unmapped capability instead of
 * crashing on an undefined lookup.
 */
export function getFeatureMeta(feature: string) {
  return isFeatureKey(feature) ? FEATURE_ENTITLEMENTS[feature] : undefined;
}

/**
 * Which plans grant each feature. Admins bypass this table entirely via the
 * entitlement resolver, not via entries here.
 *
 * `released: false` marks a capability that is defined but not yet shipped, so
 * the UI must not imply it works today.
 */
export const FEATURE_ENTITLEMENTS: Record<
  FeatureKey,
  {
    plans: readonly PlanCode[];
    label: string;
    released: boolean;
    description: string;
    /**
     * Which shared allowance this feature spends from, or `null` when it is not
     * metered at all.
     *
     * Required rather than optional, so a new capability cannot be added without
     * deciding whether it draws on a budget. Optional would let it default to
     * unmetered by omission, which is the opposite of a safe default here.
     */
    usagePool: UsagePool | null;
  }
> = {
  JOB_TRACKING: {
    plans: ['FREE', 'PRO', 'PREMIUM'],
    label: 'Job tracking workspace',
    released: true,
    description: 'Capture leads, score fit, and track your pipeline.',
    // Part of the workspace itself, not a metered capability.
    usagePool: null,
  },
  PUBLIC_JOB_IMPORT: {
    plans: ['FREE', 'PRO', 'PREMIUM'],
    label: 'Public job import',
    released: true,
    description: 'Save public jobs straight into your private workspace.',
    // Part of the workspace itself, not a metered capability.
    usagePool: null,
  },
  ADVANCED_JOB_MATCHING: {
    plans: ['PRO', 'PREMIUM'],
    label: 'Advanced job matching',
    released: true,
    description: 'Personalised fit scoring against your profile and preferences.',
    // Part of the workspace itself, not a metered capability.
    usagePool: null,
  },
  RESUME_UPLOAD: {
    plans: ['FREE', 'PRO', 'PREMIUM'],
    label: 'Resume upload',
    released: true,
    description: 'Upload and parse your resume for tailored applications.',
    // Part of the workspace itself, not a metered capability.
    usagePool: null,
  },
  /**
   * Creating, editing, templating and exporting a structured resume.
   *
   * Plans were set at the monetization launch; this release ships the feature
   * behind them. It is deliberately NOT metered: building a document costs the
   * user nothing, and `PLAN_LIMITS.resumes` bounds how many they may keep.
   */
  RESUME_BUILDER: {
    plans: ['PRO', 'PREMIUM'],
    label: 'Resume builder',
    released: true,
    description: 'Build, tailor and export a structured resume for each role you apply to.',
    // Part of the workspace itself, not a metered capability.
    usagePool: null,
  },
  /**
   * The paid operation behind job-specific optimisation: proposing
   * evidence-backed edits to ONE resume for ONE job.
   *
   * Kept separate from RESUME_BUILDER because building and editing must keep
   * working exactly as they do; only the model call is metered, and it draws on
   * the same shared `aiCredits` budget as every other AI feature. One AI
   * allowance, not several competing ones.
   */
  RESUME_OPTIMIZATION: {
    plans: ['PRO', 'PREMIUM'],
    label: 'Resume optimisation',
    released: true,
    description:
      'Get specific, evidence-backed suggestions for one resume and one job — you decide what to keep.',
    // Draws on the one shared `aiCredits` allowance, not its own.
    usagePool: 'AI',
  },
  /**
   * The paid operation behind AI Job Intelligence: explaining how a specific
   * job matches one specific user's profile.
   *
   * Defined since the monetization launch and shipped by this release. The
   * analysis is metered through the shared `aiCredits` budget alongside resume
   * parsing — one AI allowance, not several competing ones.
   */
  AI_JOB_ANALYSIS: {
    plans: ['PRO', 'PREMIUM'],
    label: 'AI job analysis',
    released: true,
    description:
      'Understand why a role fits you — strengths, gaps, and what to confirm before you apply.',
    // Draws on the one shared `aiCredits` allowance, not its own.
    usagePool: 'AI',
  },
  AI_COVER_LETTER: {
    plans: ['PRO', 'PREMIUM'],
    label: 'AI cover letters',
    released: false,
    description: 'Draft tailored cover letters for each application.',
    // Draws on the one shared `aiCredits` allowance, not its own.
    usagePool: 'AI',
  },
  AI_INTERVIEW_PREP: {
    plans: ['PRO', 'PREMIUM'],
    label: 'AI interview preparation',
    released: false,
    description: 'Generate structured interview preparation packs.',
    // Draws on the one shared `aiCredits` allowance, not its own.
    usagePool: 'AI',
  },
  /**
   * The paid operation behind Resume Intelligence: analysing a stored resume
   * with the AI provider.
   *
   * Deliberately separate from RESUME_UPLOAD, which stays on Free. Gating the
   * parse — not the upload — keeps a Free user able to keep and manage their
   * document while making the expensive part a paid capability.
   */
  AI_RESUME_PARSER: {
    plans: ['PRO', 'PREMIUM'],
    label: 'AI resume analysis',
    released: true,
    description: 'Turn a resume into a structured, editable career profile.',
    // Draws on the one shared `aiCredits` allowance, not its own.
    usagePool: 'AI',
  },
  /**
   * The structured career data itself, and the foundation later releases build
   * on: job-match explanations, tailored resumes, cover letters and interview
   * prep all read from the same reviewed profile.
   */
  CAREER_PROFILE_INTELLIGENCE: {
    plans: ['PRO', 'PREMIUM'],
    label: 'Career profile intelligence',
    released: true,
    description:
      'A verified career profile built from your resume and reused across every AI feature.',
    // Part of the workspace itself, not a metered capability.
    usagePool: null,
  },
  PRIORITY_QUEUE: {
    plans: ['PRO', 'PREMIUM'],
    label: 'Priority processing',
    released: false,
    description: 'Faster turnaround on AI-assisted work.',
    // Part of the workspace itself, not a metered capability.
    usagePool: null,
  },
  ADVANCED_PREPARATION: {
    plans: ['PREMIUM'],
    label: 'Advanced preparation',
    released: false,
    description: 'Deeper preparation tooling and career coaching.',
    // Part of the workspace itself, not a metered capability.
    usagePool: null,
  },
  LINKEDIN_ENRICHMENT: {
    plans: ['PRO', 'PREMIUM'],
    label: 'LinkedIn enrichment',
    released: false,
    description: 'Enrich leads with additional profile context.',
    // Part of the workspace itself, not a metered capability.
    usagePool: null,
  },
};

/** Short, customer-facing plan descriptions. No invented pricing or urgency. */
export const PLAN_MARKETING: Record<PlanCode, { tagline: string; highlights: string[] }> = {
  FREE: {
    tagline: 'The core job search workspace.',
    highlights: [
      'Capture and organise job leads',
      'Personalised fit scoring',
      'Pipeline and recruiter CRM',
      'Daily action queue and streaks',
    ],
  },
  PRO: {
    tagline: 'Deeper AI assistance for a focused search.',
    highlights: [
      'Everything in Free',
      'AI-assisted resume and cover letter help',
      'Structured interview preparation',
      'Priority processing',
    ],
  },
  PREMIUM: {
    tagline: 'The complete teChia Jobs toolkit.',
    highlights: [
      'Everything in Pro',
      'Advanced preparation tooling',
      'Career coaching sessions',
      'Highest priority support',
    ],
  },
};

/** Formats integer minor units for display. Returns null when unpriced. */
export function formatPlanPrice(
  monthlyPriceMinor: number | null,
  currency: string,
): { label: string; isPriced: boolean } {
  if (monthlyPriceMinor === null) return { label: 'Contact us', isPriced: false };
  const major = monthlyPriceMinor / 100;
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: major % 1 === 0 ? 0 : 2,
  }).format(major);
  return { label: `${formatted} / month`, isPriced: true };
}

/** Customer-facing plan label, e.g. "Pro" or "Pro Trial". */
export function getPlanLabel(code: PlanCode, isTrialing: boolean): string {
  const name = code.charAt(0) + code.slice(1).toLowerCase();
  return isTrialing ? `${name} Trial` : name;
}