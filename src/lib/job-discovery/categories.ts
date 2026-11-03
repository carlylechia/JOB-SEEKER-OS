/**
 * Canonical job taxonomy shared by catalog ingestion, manual capture and the
 * public jobs page.
 *
 * Provider feeds use a different vocabulary for the same work ("Software
 * Development", "Engineering", "Backend Developer"). Filtering on raw provider
 * categories would therefore produce a dozen near-duplicate filters, so every
 * listing is mapped to one of these buckets before it is stored or displayed.
 *
 * The mapping is deliberately deterministic. A title is a strong signal, but it
 * is only one signal: provider categories and tags are considered too, and the
 * result is always one of the buckets below rather than free text.
 */

export const JOB_CATEGORIES = [
  'ENGINEERING',
  'DATA',
  'DESIGN',
  'PRODUCT',
  'MARKETING',
  'SALES',
  'CUSTOMER_SUCCESS',
  'FINANCE',
  'OPERATIONS',
  'PEOPLE',
  'LEGAL',
  'HEALTHCARE',
  'EDUCATION',
  'OTHER',
] as const;

export type JobCategory = (typeof JOB_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<JobCategory, string> = {
  ENGINEERING: 'Engineering',
  DATA: 'Data & AI',
  DESIGN: 'Design',
  PRODUCT: 'Product',
  MARKETING: 'Marketing',
  SALES: 'Sales',
  CUSTOMER_SUCCESS: 'Customer success',
  FINANCE: 'Finance',
  OPERATIONS: 'Operations',
  PEOPLE: 'People & HR',
  LEGAL: 'Legal',
  HEALTHCARE: 'Healthcare',
  EDUCATION: 'Education',
  OTHER: 'Other',
};

export const CATEGORY_OPTIONS = JOB_CATEGORIES.map((value) => ({
  value,
  label: CATEGORY_LABELS[value],
}));

const CATEGORY_PATTERNS: Array<{ category: JobCategory; pattern: RegExp }> = [
  {
    category: 'DATA',
    pattern:
      /\b(data scien|data analyst|data engineer|analytics engineer|machine learning|ml engineer|ai engineer|artificial intelligence|business intelligence|bi analyst|data architect|llm|nlp)\b/i,
  },
  {
    category: 'DESIGN',
    pattern:
      /\b(designer|design|ux|ui|user experience|user interface|interaction design|visual design|graphic|creative director|brand design|product design)\b/i,
  },
  {
    category: 'PRODUCT',
    pattern:
      /\b(product manager|product owner|product lead|product management|technical product|product strategist|head of product|vp product|chief product)\b/i,
  },
  {
    category: 'MARKETING',
    pattern:
      /\b(marketing|growth|seo|sem|content|copywriter|social media|communications|brand manager|demand generation|performance marketing|public relations|pr manager)\b/i,
  },
  {
    category: 'SALES',
    pattern:
      /\b(sales|account executive|account manager|business development|revenue|partnerships|sales engineer|sdr|bdr|customer acquisition)\b/i,
  },
  {
    category: 'CUSTOMER_SUCCESS',
    pattern:
      /\b(customer success|customer support|support engineer|technical support|help desk|customer experience|customer service|community manager|onboarding specialist)\b/i,
  },
  {
    category: 'FINANCE',
    pattern:
      /\b(finance|financial|accounting|accountant|controller|payroll|tax|treasury|bookkeeper|audit|investment|fp&a)\b/i,
  },
  {
    category: 'OPERATIONS',
    pattern:
      /\b(operations|project manager|program manager|supply chain|logistics|procurement|business operations|chief of staff|office manager|administrative)\b/i,
  },
  {
    category: 'PEOPLE',
    pattern:
      /\b(recruiter|recruiting|talent|human resources|people operations|people partner|hr manager|hr generalist|learning and development)\b/i,
  },
  {
    category: 'LEGAL',
    pattern:
      /\b(legal|counsel|attorney|lawyer|paralegal|compliance|contract manager|privacy)\b/i,
  },
  {
    category: 'HEALTHCARE',
    pattern:
      /\b(nurse|nursing|clinical|medical|physician|therapist|healthcare|pharmacist|dentist|veterinar)\b/i,
  },
  {
    category: 'EDUCATION',
    pattern:
      /\b(teacher|teaching|instructor|tutor|professor|lecturer|education|curriculum|school)\b/i,
  },
  // Engineering is the catch-all for technical roles with no stronger signal,
  // so it is evaluated after the other buckets. Without this, a "Product
  // Designer" at a software company would be misfiled as Engineering.
  {
    category: 'ENGINEERING',
    pattern:
      /\b(software|engineer|developer|programmer|frontend|front end|backend|back end|full[ -]?stack|devops|sre|site reliability|platform|infrastructure|cloud|mobile|ios|android|qa|quality assurance|test automation|security engineer|architect|technical lead|tech lead|web developer|wordpress|salesforce|solutions engineer)\b/i,
  },
];

function normalizeText(values: Array<string | null | undefined>) {
  return values.filter(Boolean).join(' ').toLowerCase();
}

/** Map arbitrary provider text to a canonical category. */
export function normalizeJobCategory(
  ...values: Array<string | string[] | null | undefined>
): JobCategory {
  const flattened = values.flatMap((value) =>
    Array.isArray(value) ? value : [value],
  );
  const text = normalizeText(flattened as Array<string | null | undefined>);
  if (!text.trim()) return 'OTHER';

  for (const { category, pattern } of CATEGORY_PATTERNS) {
    if (pattern.test(text)) return category;
  }
  return 'OTHER';
}

export function isJobCategory(value: string | null | undefined): value is JobCategory {
  return Boolean(value && (JOB_CATEGORIES as readonly string[]).includes(value.toUpperCase()));
}

export function normalizeCategoryValue(value: string | null | undefined): JobCategory {
  const upper = value?.trim().toUpperCase();
  return isJobCategory(upper) ? upper : normalizeJobCategory(value);
}

// ─── Seniority ─────────────────────────────────────────────────────────────

export const SENIORITY_LEVELS = ['ENTRY', 'MID', 'SENIOR', 'LEAD', 'EXECUTIVE', 'UNKNOWN'] as const;
export type SeniorityLevel = (typeof SENIORITY_LEVELS)[number];

export const SENIORITY_LABELS: Record<SeniorityLevel, string> = {
  ENTRY: 'Entry level',
  MID: 'Mid level',
  SENIOR: 'Senior',
  LEAD: 'Lead / Staff',
  EXECUTIVE: 'Executive',
  UNKNOWN: 'Not specified',
};

export const SENIORITY_OPTIONS = SENIORITY_LEVELS.map((value) => ({
  value,
  label: SENIORITY_LABELS[value],
}));

/**
 * Normalize provider seniority labels and infer from the title only when the
 * provider did not supply a usable value. "Not specified" is a real answer and
 * is preferred over guessing from a weak signal.
 */
export function normalizeSeniority(
  value: string | null | undefined,
  title?: string | null,
): SeniorityLevel {
  const text = `${value ?? ''} ${title ?? ''}`.toLowerCase();

  if (/\b(chief|cto|ceo|coo|cfo|cpo|vp|vice president|head of|director|executive)\b/.test(text)) {
    return 'EXECUTIVE';
  }
  if (/\b(principal|staff|lead|team lead|tech lead|architect|manager)\b/.test(text)) {
    return 'LEAD';
  }
  if (/\b(senior|sr\.?|experienced|iii)\b/.test(text)) return 'SENIOR';
  if (/\b(junior|jr\.?|entry|graduate|intern|trainee|associate|i\b)\b/.test(text)) {
    return 'ENTRY';
  }
  if (/\b(mid|intermediate|ii)\b/.test(text)) return 'MID';
  return 'UNKNOWN';
}

export function isSeniorityLevel(value: string | null | undefined): value is SeniorityLevel {
  return Boolean(value && (SENIORITY_LEVELS as readonly string[]).includes(value.toUpperCase()));
}

export function normalizeSeniorityValue(value: string | null | undefined, title?: string | null): SeniorityLevel {
  const upper = value?.trim().toUpperCase();
  return isSeniorityLevel(upper) ? upper : normalizeSeniority(value, title);
}
