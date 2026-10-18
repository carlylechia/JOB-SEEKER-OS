/**
 * Deterministic dimension computation.
 *
 * Everything in this file is arithmetic and keyword rules over data we already
 * hold. No AI, no provider, no network. It runs before the model is called and
 * again after it returns, and its answers win.
 *
 * The reason is simple: these are the facts the model is least entitled to
 * get wrong. Whether a job is remote, whether two currencies can be compared,
 * whether a stated eligibility region covers a user's stated region — these are
 * checkable. So we check them and hand the model the answer as a fact to
 * explain rather than a question to solve.
 *
 * Each function returns an outcome AND the reasoning that produced it, so the
 * prompt can include the reasoning and the model cannot disagree with it
 * without contradicting itself in front of us.
 */

import type { DimensionOutcome } from './schema';
import type { WorkArrangement } from './schema';

// ─── Work arrangement ──────────────────────────────────────────────────────

/**
 * Classify the work arrangement from what the posting and metadata state.
 *
 * Deliberately literal. The presence of the word "remote" does not mean a job
 * is open to anyone: a posting that says "Remote (US only)" is remote, and it
 * is also region-restricted, and those are two different facts handled by two
 * different functions here. Inferring worldwide availability from the word
 * "remote" is exactly the mistake this brief forbids.
 */
export function classifyWorkArrangement(params: {
  remoteType: string | null | undefined;
  description: string | null | undefined;
}): { arrangement: WorkArrangement; evidenceText: string | null } {
  const remoteType = (params.remoteType ?? '').trim();
  const description = (params.description ?? '').trim();

  // The structured field is user-entered and more reliable than prose when set.
  if (remoteType) {
    const value = remoteType.toLowerCase();
    if (value.includes('hybrid')) return { arrangement: 'HYBRID', evidenceText: remoteType };
    if (value.includes('on-site') || value.includes('onsite')) {
      return { arrangement: 'ON_SITE', evidenceText: remoteType };
    }
    if (value.includes('multiple') || value.includes('flexible') || value.includes('optional')) {
      return { arrangement: 'MULTIPLE_OPTIONS', evidenceText: remoteType };
    }
    if (value.includes('remote')) return { arrangement: 'REMOTE', evidenceText: remoteType };
  }

  if (description) {
    const hasRemote = /\bremote\b/i.test(description);
    const hasHybrid = /\bhybrid\b/i.test(description);
    const hasOnSite = /\bon-?site\b|\bin-?office\b/i.test(description);

    if (hasHybrid) return { arrangement: 'HYBRID', evidenceText: 'hybrid' };
    if (hasOnSite && hasRemote) return { arrangement: 'MULTIPLE_OPTIONS', evidenceText: 'hybrid/remote' };
    if (hasOnSite) return { arrangement: 'ON_SITE', evidenceText: 'on-site' };
    if (hasRemote) return { arrangement: 'REMOTE', evidenceText: 'remote' };
  }

  return { arrangement: 'NOT_STATED', evidenceText: null };
}

/**
 * Does the arrangement fit what the user asked for?
 *
 * `remoteOnly` is the user's own setting and means what it says: they only
 * want remote work. We do not soften it because a job is otherwise great.
 */
export function assessRemoteCompatibility(params: {
  arrangement: WorkArrangement;
  remoteOnly: boolean;
}): { outcome: DimensionOutcome; explanation: string } {
  const { arrangement, remoteOnly } = params;

  if (arrangement === 'NOT_STATED') {
    return {
      outcome: 'UNKNOWN',
      explanation:
        'This job does not say how you would be working, so we cannot tell whether it fits what you are looking for. Ask the employer before assuming it is remote.',
    };
  }

  if (!remoteOnly) {
    return {
      outcome: 'MATCH',
      explanation: `This role is listed as ${arrangement.replace('_', ' ').toLowerCase()}, and you have not restricted yourself to remote-only work.`,
    };
  }

  switch (arrangement) {
    case 'REMOTE':
      return {
        outcome: 'MATCH',
        explanation: 'This role is listed as remote, which matches your remote-only preference.',
      };
    case 'HYBRID':
      return {
        outcome: 'PARTIAL_MATCH',
        explanation:
          'This role is hybrid, which means regular on-site days. That does not meet your remote-only preference, so it is worth confirming the expected office days before you invest time in it.',
      };
    case 'MULTIPLE_OPTIONS':
      return {
        outcome: 'PARTIAL_MATCH',
        explanation:
          'This role offers more than one arrangement, which may include remote. You would need to confirm with the employer which arrangements are actually open to you.',
      };
    case 'ON_SITE':
      return {
        outcome: 'MISMATCH',
        explanation:
          'This role is on-site, which does not match your remote-only preference. We have kept it here so you can decide, rather than hiding it.',
      };
    default:
      return { outcome: 'UNKNOWN', explanation: 'We could not determine the work arrangement for this role.' };
  }
}

// ─── Location ──────────────────────────────────────────────────────────────

const REGION_KEYWORDS: Record<string, string[]> = {
  US: ['us', 'usa', 'united states', 'united states of america', 'north america', 'us-based', 'us only'],
  EU: ['eu', 'europe', 'european union', 'emea', 'uk', 'united kingdom', 'emea region'],
  AFRICA: ['africa', 'african', 'nigeria', 'kenya', 'ghana', 'south africa', 'north africa', 'west africa', 'east africa'],
  WORLDWIDE: ['worldwide', 'global', 'anywhere', 'international', 'any country'],
  FLEXIBLE: ['flexible', 'multiple locations'],
};

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Which regions does a piece of text mention?
 *
 * Only explicit statements count. A city name is not a region statement, and
 * the absence of a region is never read as "anywhere".
 */
export function detectRegions(text: string | null | undefined): string[] {
  const normalized = normalizeKey(text ?? '');
  if (!normalized) return [];

  const found = new Set<string>();
  for (const [region, keywords] of Object.entries(REGION_KEYWORDS)) {
    if (keywords.some((keyword) => normalized.includes(keyword))) found.add(region);
  }
  return [...found];
}

/**
 * Location compatibility.
 *
 * The failure mode this guards against is real: a user's language or profile
 * location is not evidence of work authorisation, and a job being "remote" is
 * not evidence that it is open worldwide. So when we cannot see both sides, the
 * answer is UNKNOWN and the copy says to confirm with the employer.
 */
export function assessLocationCompatibility(params: {
  jobLocation: string | null | undefined;
  jobEligibilityRegion: string | null | undefined;
  jobRegions: string[];
  preferredRegions: string[];
  userLocation: string | null | undefined;
}): { outcome: DimensionOutcome; explanation: string; requiresConfirmation: boolean } {
  const {
    jobLocation,
    jobEligibilityRegion,
    jobRegions,
    preferredRegions,
    userLocation,
  } = params;

  const statedJobLocation = (jobLocation ?? '').trim();
  const statedEligibility = (jobEligibilityRegion ?? '').trim();
  const allJobRegions = detectRegions(
    [statedJobLocation, statedEligibility, ...jobRegions].filter(Boolean).join(' '),
  );
  const allUserRegions = detectRegions(preferredRegions.join(' '));

  // The employer states no location at all. Not a mismatch — an absence.
  if (!statedJobLocation && !statedEligibility && allJobRegions.length === 0) {
    return {
      outcome: 'UNKNOWN',
      explanation:
        'This job does not state a location, so we cannot compare it against your preferred regions. Ask the employer where the role is based.',
      requiresConfirmation: true,
    };
  }

  // The user has stated no preference at all.
  if (preferredRegions.length === 0 && !userLocation) {
    return {
      outcome: 'UNKNOWN',
      explanation:
        'You have not set preferred regions, so we cannot tell whether this location works for you. You can set that in your job-search preferences.',
      requiresConfirmation: true,
    };
  }

  const isWorldwide = allJobRegions.includes('WORLDWIDE');
  const overlaps =
    isWorldwide ||
    allUserRegions.some((region) => region === 'WORLDWIDE' || allJobRegions.includes(region));

  if (overlaps) {
    return {
      outcome: 'MATCH',
      explanation: isWorldwide
        ? 'This role is open worldwide, which overlaps the regions you prefer.'
        : `This role is open in ${allJobRegions.join(', ').toLowerCase()}, which overlaps the regions you prefer.`,
      requiresConfirmation: false,
    };
  }

  if (allJobRegions.length === 0 || allUserRegions.length === 0) {
    return {
      outcome: 'UNKNOWN',
      explanation: `This role is based in ${statedJobLocation || statedEligibility || 'a location we could not classify'}, and we could not map that to the regions you prefer. Confirm the details with the employer.`,
      requiresConfirmation: true,
    };
  }

  return {
    outcome: 'MISMATCH',
    explanation: `This role is restricted to ${allJobRegions.join(', ').toLowerCase()}, which does not overlap the regions you prefer (${allUserRegions.join(', ').toLowerCase()}). If your regions are set wrong, update them — otherwise confirm the restriction with the employer.`,
    requiresConfirmation: true,
  };
}

// ─── Time zone ────────────────────────────────────────────────────────────

/**
 * Time-zone compatibility.
 *
 * Stated only when the employer states something. A job with no time-zone
 * requirement is treated as UNKNOWN rather than compatible — "no requirement"
 * and "fits you" are different statements, and only one of them is in the data.
 */
export function assessTimeZoneCompatibility(params: {
  jobTimezoneRequirement: string | null | undefined;
  timezoneMatches: string[];
  timezoneToleranceHours: number;
}): { outcome: DimensionOutcome; explanation: string } {
  const stated = (params.jobTimezoneRequirement ?? '').trim();
  const matches = params.timezoneMatches;

  if (!stated) {
    return {
      outcome: 'UNKNOWN',
      explanation:
        'This job does not state any time-zone requirement, so we cannot tell whether the hours work for you. Confirm expected working hours with the employer.',
    };
  }

  if (matches.length === 0) {
    return {
      outcome: 'UNKNOWN',
      explanation:
        'You have not set any preferred time zones, so we cannot compare this role against them.',
    };
  }

  const normalizedStated = normalizeKey(stated);
  const direct = matches.find((match) => {
    const normalizedMatch = normalizeKey(match);
    return normalizedMatch && normalizedStated.includes(normalizedMatch);
  });

  if (direct) {
    return {
      outcome: 'MATCH',
      explanation: `This role asks for ${direct.toLowerCase()}, which is one of the time zones you prefer.`,
    };
  }

  return {
    outcome: 'PARTIAL_MATCH',
    explanation: `This role asks for ${stated.toLowerCase()}, which is not one of the time zones you listed. Your saved tolerance is ${params.timezoneToleranceHours} hours of overlap, so this may still work — check the exact hours before applying.`,
  };
}

// ─── Eligibility ───────────────────────────────────────────────────────────

/**
 * Regional or work-authorisation eligibility.
 *
 * This function deliberately issues no legal conclusion. It compares two
 * strings the user can read for themselves and, when they do not line up, says
 * to confirm with the employer. It never says a user can or cannot legally work
 * anywhere, never infers authorisation from language or from profile location,
 * and never claims a job will sponsor anything.
 */
export function assessEligibilityCompatibility(params: {
  eligibilityRegion: string | null | undefined;
  jobRegions: string[];
  workRegions: string[];
  preferredRegions: string[];
}): { outcome: DimensionOutcome; explanation: string; requiresConfirmation: boolean } {
  const stated = (params.eligibilityRegion ?? '').trim();
  const jobRegions = params.jobRegions;
  const userRegions = [...params.workRegions, ...params.preferredRegions];

  // No stated restriction at all. NOT_APPLICABLE rather than UNKNOWN: there is
  // no eligibility question to answer, which is a different state from "we
  // could not answer it".
  if (!stated && jobRegions.length === 0) {
    return {
      outcome: 'NOT_APPLICABLE',
      explanation:
        'This job does not state any eligibility or work-authorisation restriction, so there is nothing for us to check. Confirm the terms with the employer.',
      requiresConfirmation: false,
    };
  }

  if (userRegions.length === 0) {
    return {
      outcome: 'UNKNOWN',
      explanation:
        'This job states an eligibility restriction, but you have not told us which regions you can work in. Add that to your preferences, or confirm it with the employer.',
      requiresConfirmation: true,
    };
  }

  const normalizedStated = normalizeKey(stated);
  const normalizedWork = userRegions.map(normalizeKey);

  // "Worldwide" / "anywhere" / "global" is an explicit statement that the
  // restriction, whatever else it says, does not exclude the user's region. It
  // is a PARTIAL match rather than a MATCH because the posting's wording still
  // has to be confirmed against the candidate's individual situation — we do
  // not turn a keyword into a work-authorisation conclusion.
  const worldwide =
    jobRegions.includes('WORLDWIDE') ||
    /\b(worldwide|global|anywhere|international|any country|no location restriction)\b/i.test(stated);

  const explicitlyPermitsOne =
    worldwide ||
    normalizedWork.some((region) => region && normalizedStated.includes(region)) ||
    jobRegions.some((region) => normalizedWork.includes(normalizeKey(region)));

  if (explicitlyPermitsOne) {
    return {
      outcome: 'PARTIAL_MATCH',
      explanation: `This job states an eligibility region (${stated}) that appears to overlap the regions you listed. We cannot verify your individual eligibility — confirm the exact requirement with the employer.`,
      requiresConfirmation: true,
    };
  }

  return {
    outcome: 'UNKNOWN',
    explanation: `This job states an eligibility region (${stated}). We cannot tell from the information here whether that applies to you, and we do not make legal determinations — confirm this with the employer before you invest time in the application.`,
    requiresConfirmation: true,
  };
}

// ─── Compensation ──────────────────────────────────────────────────────────

export type CompensationAssessment = {
  outcome:
    | 'WITHIN_PREFERENCE'
    | 'BELOW_PREFERENCE'
    | 'ABOVE_PREFERENCE'
    | 'PARTIALLY_OVERLAPPING'
    | 'NOT_STATED_BY_EMPLOYER'
    | 'NOT_COMPARABLE';
  explanation: string;
  /** True when the currencies differ and no reliable conversion was available. */
  currencyMismatch: boolean;
  requiresConfirmation: boolean;
};

/**
 * Compensation compatibility.
 *
 * Three rules this function exists to enforce:
 *
 *  1. A missing salary is NOT zero. An undisclosed salary is
 *     `NOT_STATED_BY_EMPLOYER`, which is a different state from "below your
 *     minimum", and conflating them would mark well-paying secretive employers
 *     as poor matches.
 *  2. Different currencies are never compared as if identical, and no exchange
 *     rate is ever invented. Two currencies we cannot convert is
 *     `NOT_COMPARABLE`.
 *  3. All arithmetic here is integer comparison on whole units. There is no
 *     float rounding to explain and nothing to re-derive.
 */
export function assessCompensation(params: {
  salaryMin: number | null | undefined;
  salaryMax: number | null | undefined;
  currency: string | null | undefined;
  preferenceMin: number;
  preferenceTarget: number;
  preferenceCurrency: string;
}): CompensationAssessment {
  const { salaryMin, salaryMax, currency, preferenceMin, preferenceTarget, preferenceCurrency } = params;

  const hasSalary = typeof salaryMin === 'number' || typeof salaryMax === 'number';

  if (!hasSalary) {
    return {
      outcome: 'NOT_STATED_BY_EMPLOYER',
      explanation:
        'This job does not state a salary, so we cannot compare it against your preferences. That is not the same as it paying badly — you would need to ask the employer or a recruiter.',
      currencyMismatch: false,
      requiresConfirmation: true,
    };
  }

  const jobCurrency = (currency ?? 'USD').toUpperCase();
  const prefCurrency = (preferenceCurrency ?? 'USD').toUpperCase();

  // No reliable conversion source exists in this application. Rather than
  // invent a rate, we decline to compare and say so.
  if (jobCurrency !== prefCurrency) {
    return {
      outcome: 'NOT_COMPARABLE',
      explanation: `This job is stated in ${jobCurrency} and your salary preferences are in ${prefCurrency}. We do not convert between currencies, so we cannot tell you precisely how these compare. Check the conversion rate yourself before deciding.`,
      currencyMismatch: true,
      requiresConfirmation: true,
    };
  }

  // The user has no stated preference. Not a mismatch — an absent question.
  if (preferenceMin <= 0 && preferenceTarget <= 0) {
    return {
      outcome: 'NOT_COMPARABLE',
      explanation:
        'You have not set a salary preference, so we have nothing to compare this range against. You can set one in your job-search preferences.',
      currencyMismatch: false,
      requiresConfirmation: false,
    };
  }

  const floor = preferenceMin > 0 ? preferenceMin : preferenceTarget;
  const ceiling = preferenceTarget > 0 ? preferenceTarget : preferenceMin;
  const rangeLow = typeof salaryMin === 'number' ? salaryMin : salaryMax!;
  const rangeHigh = typeof salaryMax === 'number' ? salaryMax : salaryMin!;

  const partialRange = typeof salaryMin !== 'number' || typeof salaryMax !== 'number';
  const rangeText = partialRange
    ? `${formatAmount(rangeLow, jobCurrency)} (the employer gave only one end of the range)`
    : `${formatAmount(rangeLow, jobCurrency)} to ${formatAmount(rangeHigh, jobCurrency)}`;

  if (rangeHigh < floor) {
    return {
      outcome: 'BELOW_PREFERENCE',
      explanation: `This role pays ${rangeText}, which is below your minimum of ${formatAmount(floor, jobCurrency)}.`,
      currencyMismatch: false,
      requiresConfirmation: false,
    };
  }

  if (rangeLow >= ceiling) {
    return {
      outcome: 'ABOVE_PREFERENCE',
      explanation: `This role pays ${rangeText}, which meets or exceeds your target of ${formatAmount(ceiling, jobCurrency)}.`,
      currencyMismatch: false,
      requiresConfirmation: false,
    };
  }

  if (rangeLow >= floor && rangeHigh >= floor) {
    return {
      outcome: 'PARTIALLY_OVERLAPPING',
      explanation: `This role pays ${rangeText}. The lower end sits below your target of ${formatAmount(ceiling, jobCurrency)}, so the outcome depends on where in the range they offer you.`,
      currencyMismatch: false,
      requiresConfirmation: false,
    };
  }

  return {
    outcome: 'PARTIALLY_OVERLAPPING',
    explanation: `This role pays ${rangeText}. Only the upper part of that range reaches your minimum of ${formatAmount(floor, jobCurrency)}, so it depends on where in the band you are offered.`,
    currencyMismatch: false,
    requiresConfirmation: false,
  };
}

/** Display formatting only. Never parsed back — the stored value is the integer. */
export function formatAmount(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    // An unrecognised currency code must not crash the analysis.
    return `${value.toLocaleString('en-US')} ${currency}`;
  }
}
