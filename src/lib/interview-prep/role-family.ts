/**
 * Occupational classification for a target role.
 *
 * The pack adapts its language and practical exercises to the kind of work
 * the role actually involves. This is deliberately a small, transparent
 * keyword classifier rather than a second AI call: it is deterministic,
 * testable, costs nothing, and can honestly be described as a heuristic.
 *
 * The model still receives the real title and posting. This classification is
 * a presentation hint, never a claim about the employer.
 */

export type OccupationalFamilyKey =
  | 'SOFTWARE_ENGINEERING'
  | 'DATA'
  | 'PRODUCT'
  | 'DESIGN'
  | 'MARKETING'
  | 'SALES'
  | 'CUSTOMER'
  | 'OPERATIONS'
  | 'FINANCE'
  | 'PEOPLE'
  | 'HEALTHCARE'
  | 'EDUCATION'
  | 'LEGAL'
  | 'GENERAL';

export type OccupationalFamily = {
  key: OccupationalFamilyKey;
  label: string;
  /** Short wording for exercises, e.g. "design exercise". */
  activityLabel: string;
};

const FAMILIES: Array<{
  key: OccupationalFamilyKey;
  label: string;
  activityLabel: string;
  patterns: RegExp[];
}> = [
  {
    key: 'SOFTWARE_ENGINEERING',
    label: 'Software engineering',
    activityLabel: 'technical exercise',
    patterns: [
      /\b(software|backend|frontend|full[- ]stack|web|mobile|android|ios|platform|infrastructure|devops|sre|site reliability|security|cloud|embedded|firmware|qa|test automation|machine learning|ml|ai)\s+(engineer|developer|architect|lead|manager)\b/i,
      /\b(engineer|developer|programmer|architect)\b/i,
      /\b(typescript|javascript|python|java|golang|rust|ruby|php|c\+\+|c#|react|node|kubernetes|aws|gcp|azure)\b/i,
    ],
  },
  {
    key: 'DATA',
    label: 'Data and analytics',
    activityLabel: 'data exercise',
    patterns: [
      /\b(data|analytics|business intelligence|bi|machine learning|ml|statistic|research)\s+(scientist|analyst|engineer|architect|lead|manager)\b/i,
      /\b(data science|data engineering|analytics|statistics|econometrics)\b/i,
    ],
  },
  {
    key: 'PRODUCT',
    label: 'Product management',
    activityLabel: 'product case',
    patterns: [
      /\b(product|program|project|technical product)\s+(manager|owner|lead|director)\b/i,
      /\b(product management|roadmap|product strategy)\b/i,
    ],
  },
  {
    key: 'DESIGN',
    label: 'Design',
    activityLabel: 'design exercise',
    patterns: [
      /\b(product|ux|ui|interaction|visual|graphic|service|brand)\s*(designer|design lead|design director)\b/i,
      /\b(design|user experience|user research|prototyping)\b/i,
    ],
  },
  {
    key: 'MARKETING',
    label: 'Marketing and communications',
    activityLabel: 'marketing exercise',
    patterns: [
      /\b(marketing|growth|brand|content|communications|seo|demand generation|social media)\b/i,
    ],
  },
  {
    key: 'SALES',
    label: 'Sales and business development',
    activityLabel: 'sales exercise',
    patterns: [
      /\b(sales|account executive|business development|partnerships|revenue|customer success)\b/i,
    ],
  },
  {
    key: 'CUSTOMER',
    label: 'Customer support and success',
    activityLabel: 'scenario exercise',
    patterns: [
      /\b(customer support|support specialist|customer success|client services|service desk|help desk)\b/i,
    ],
  },
  {
    key: 'OPERATIONS',
    label: 'Operations',
    activityLabel: 'operations exercise',
    patterns: [
      /\b(operations|ops|logistics|supply chain|procurement|manufacturing|warehouse|facilities)\b/i,
    ],
  },
  {
    key: 'FINANCE',
    label: 'Finance and accounting',
    activityLabel: 'finance exercise',
    patterns: [
      /\b(finance|financial|accounting|accountant|controller|treasury|audit|investment|banking)\b/i,
    ],
  },
  {
    key: 'PEOPLE',
    label: 'People and talent',
    activityLabel: 'people scenario',
    patterns: [
      /\b(human resources|people|talent|recruit|recruiter|hiring|learning and development|hr)\b/i,
    ],
  },
  {
    key: 'HEALTHCARE',
    label: 'Healthcare',
    activityLabel: 'clinical or healthcare scenario',
    patterns: [
      /\b(nurse|nursing|clinician|clinical|physician|medical|healthcare|pharmacy|pharmacist|therapist)\b/i,
    ],
  },
  {
    key: 'EDUCATION',
    label: 'Education',
    activityLabel: 'teaching exercise',
    patterns: [
      /\b(teacher|teaching|tutor|lecturer|professor|instructor|education|curriculum)\b/i,
    ],
  },
  {
    key: 'LEGAL',
    label: 'Legal and compliance',
    activityLabel: 'legal scenario',
    patterns: [
      /\b(legal|counsel|lawyer|attorney|compliance|regulatory|paralegal)\b/i,
    ],
  },
];

const GENERAL: OccupationalFamily = {
  key: 'GENERAL',
  label: 'General professional',
  activityLabel: 'practical exercise',
};

/**
 * Classify a role from its title and posting text.
 *
 * Title matches are weighted by being checked first; description keywords are
 * only consulted when the title is inconclusive. No match returns GENERAL,
 * which is an honest "we did not classify this" rather than a guess.
 */
export function classifyRole(params: { title: string; description?: string | null }): OccupationalFamily {
  const title = params.title.trim();
  const description = (params.description ?? '').trim();

  for (const family of FAMILIES) {
    if (family.patterns.some((pattern) => pattern.test(title))) {
      return { key: family.key, label: family.label, activityLabel: family.activityLabel };
    }
  }

  if (description) {
    for (const family of FAMILIES) {
      if (family.patterns.some((pattern) => pattern.test(description))) {
        return { key: family.key, label: family.label, activityLabel: family.activityLabel };
      }
    }
  }

  return GENERAL;
}
