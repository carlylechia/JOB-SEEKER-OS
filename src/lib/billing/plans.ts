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
 * Provisional business configuration.
 *
 * NOTE: these limits are intentionally generous and marked provisional. They
 * gate NEW creation, never delete existing user data. Adjust here as the
 * business finalises pricing — do not scatter numbers through components.
 */
export const PLAN_LIMITS: Record<
  PlanCode,
  { jobs: number; resumes: number; aiCredits: number | null }
> = {
  // Provisional — Free is a genuine tier, not a lockout.
  FREE: { jobs: 25, resumes: 1, aiCredits: 25 },
  // Provisional — Paid tiers are currently unlimited until pricing is set.
  PRO: { jobs: Number.POSITIVE_INFINITY, resumes: 5, aiCredits: null },
  PREMIUM: { jobs: Number.POSITIVE_INFINITY, resumes: 10, aiCredits: null },
};

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
  'PRIORITY_QUEUE',
  'ADVANCED_PREPARATION',
  'LINKEDIN_ENRICHMENT',
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export function isFeatureKey(value: unknown): value is FeatureKey {
  return typeof value === 'string' && (FEATURE_KEYS as readonly string[]).includes(value);
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
  { plans: readonly PlanCode[]; label: string; released: boolean; description: string }
> = {
  JOB_TRACKING: {
    plans: ['FREE', 'PRO', 'PREMIUM'],
    label: 'Job tracking workspace',
    released: true,
    description: 'Capture leads, score fit, and track your pipeline.',
  },
  PUBLIC_JOB_IMPORT: {
    plans: ['FREE', 'PRO', 'PREMIUM'],
    label: 'Public job import',
    released: true,
    description: 'Save public jobs straight into your private workspace.',
  },
  ADVANCED_JOB_MATCHING: {
    plans: ['PRO', 'PREMIUM'],
    label: 'Advanced job matching',
    released: true,
    description: 'Personalised fit scoring against your profile and preferences.',
  },
  RESUME_UPLOAD: {
    plans: ['FREE', 'PRO', 'PREMIUM'],
    label: 'Resume upload',
    released: true,
    description: 'Upload and parse your resume for tailored applications.',
  },
  RESUME_BUILDER: {
    plans: ['PRO', 'PREMIUM'],
    label: 'Resume builder',
    released: false,
    description: 'Build and tailor resumes to a specific role.',
  },
  RESUME_OPTIMIZATION: {
    plans: ['PRO', 'PREMIUM'],
    label: 'Resume optimisation',
    released: false,
    description: 'Improve your resume for a specific job description.',
  },
  AI_JOB_ANALYSIS: {
    plans: ['PRO', 'PREMIUM'],
    label: 'AI job analysis',
    released: false,
    description: 'Break down a role and surface what matters most.',
  },
  AI_COVER_LETTER: {
    plans: ['PRO', 'PREMIUM'],
    label: 'AI cover letters',
    released: false,
    description: 'Draft tailored cover letters for each application.',
  },
  AI_INTERVIEW_PREP: {
    plans: ['PRO', 'PREMIUM'],
    label: 'AI interview preparation',
    released: false,
    description: 'Generate structured interview preparation packs.',
  },
  PRIORITY_QUEUE: {
    plans: ['PRO', 'PREMIUM'],
    label: 'Priority processing',
    released: false,
    description: 'Faster turnaround on AI-assisted work.',
  },
  ADVANCED_PREPARATION: {
    plans: ['PREMIUM'],
    label: 'Advanced preparation',
    released: false,
    description: 'Deeper preparation tooling and career coaching.',
  },
  LINKEDIN_ENRICHMENT: {
    plans: ['PRO', 'PREMIUM'],
    label: 'LinkedIn enrichment',
    released: false,
    description: 'Enrich leads with additional profile context.',
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