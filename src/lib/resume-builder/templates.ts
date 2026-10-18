/**
 * Template registry.
 *
 * A template is PRESENTATION ONLY. All three render the identical validated
 * `ResumeContent` through the identical layout engine; they differ in type
 * scale, rule weight, hierarchy and accent placement, never in what they mean
 * or how they are stored. There is deliberately no per-template data model — the
 * brief for this feature was three good templates, not thirty weak ones, and a
 * template that needs its own content schema is a template that will drift.
 *
 * Everything here is data, so the editor can render a template picker without a
 * second source of truth, and the PDF renderer can stay a pure function of
 * (content, templateKey, accentKey, density).
 */

/** Stable identifiers. Stored on the document; renaming a display label is safe. */
export const TEMPLATE_KEYS = ['classic-ats', 'modern-professional', 'technical-minimal'] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export function isTemplateKey(value: unknown): value is TemplateKey {
  return typeof value === 'string' && (TEMPLATE_KEYS as readonly string[]).includes(value);
}

/**
 * Approved accent palette.
 *
 * Keys, not hex values, are what gets stored. A user cannot submit an arbitrary
 * colour: there is no code path from a request body to a colour, so a crafted
 * contrast ratio cannot reach the page background or the PDF.
 *
 * Every `textOnAccent` was chosen for at least 4.5:1 against its own accent.
 * `accent` is a fill colour; it is never used for body text on white, which is
 * why gold — the brand colour — is paired with a darkened `goldDeep` whenever
 * it has to read as text.
 */
export const ACCENT_KEYS = ['gold', 'charcoal', 'silver', 'plum', 'teal'] as const;
export type AccentKey = (typeof ACCENT_KEYS)[number];

export function isAccentKey(value: unknown): value is AccentKey {
  return typeof value === 'string' && (ACCENT_KEYS as readonly string[]).includes(value);
}

export type AccentTokens = {
  /** Fill colour: rules, the name bar, section markers. */
  accent: string;
  /** Readable version of the accent, for text on a light page. */
  accentDeep: string;
  /** Label colour for text drawn on top of `accent`. */
  textOnAccent: string;
};

export const ACCENT_PALETTE: Record<AccentKey, AccentTokens> = {
  // The teChia brand. `goldDeep` is what headings use; raw #D4AF37 on white is
  // roughly 2.1:1 and fails WCAG for text, so it is only ever a fill.
  gold: { accent: '#D4AF37', accentDeep: '#7A5E14', textOnAccent: '#17191E' },
  charcoal: { accent: '#17191E', accentDeep: '#17191E', textOnAccent: '#FAFAF7' },
  silver: { accent: '#C9CED6', accentDeep: '#4A505A', textOnAccent: '#17191E' },
  plum: { accent: '#7A3E63', accentDeep: '#5F2C49', textOnAccent: '#FFFFFF' },
  teal: { accent: '#1F6F6B', accentDeep: '#155450', textOnAccent: '#FFFFFF' },
};

export function getAccent(key: AccentKey): AccentTokens {
  // Falls back rather than throwing: a document written before an accent was
  // removed must still render, and the fallback is a known-good palette entry.
  return ACCENT_PALETTE[key] ?? ACCENT_PALETTE.gold;
}

/** Type density. Bounded to these three values, server-side. */
export const DENSITY_VALUES = [0, 1, 2] as const;
export type Density = (typeof DENSITY_VALUES)[number];

export type DensityTokens = {
  /** Multiplier applied to the base font size. */
  scale: number;
  /** Extra leading between bullets, in points. */
  lineGap: number;
  /** Vertical space before a section heading, in points. */
  sectionGap: number;
};

export const DENSITY_SCALE: Record<Density, DensityTokens> = {
  0: { scale: 0.94, lineGap: 0, sectionGap: 8 },
  1: { scale: 1, lineGap: 1.5, sectionGap: 12 },
  2: { scale: 1.06, lineGap: 3, sectionGap: 16 },
};

export function getDensity(density: number): DensityTokens {
  const key = (DENSITY_VALUES as readonly number[]).includes(density)
    ? (density as Density)
    : 1;
  return DENSITY_SCALE[key];
}

export const DENSITY_LABELS: Record<Density, string> = {
  0: 'Compact',
  1: 'Comfortable',
  2: 'Relaxed',
};

/**
 * How a template shapes the document.
 *
 * The fields below are the complete vocabulary of template difference. There is
 * no template hook, no per-template renderer registration and no way for a
 * template to introduce markup: `renderTemplate` in `layout.ts` switches on
 * `style` and nothing else.
 */
export type TemplateStyle =
  | 'CLASSIC_ATS'
  | 'MODERN_PROFESSIONAL'
  | 'TECHNICAL_MINIMAL';

export type TemplateDefinition = {
  key: TemplateKey;
  label: string;
  /** One line, truthful, for the picker. */
  description: string;
  style: TemplateStyle;
  /**
   * Whether this template follows ATS-friendly formatting principles.
   *
   * `null` rather than `true`/`false` where the question does not apply is
   * avoided on purpose: this is a claim about design, and the copy is written so
   * it describes the design rather than promising an outcome. See
   * `ATS_STATEMENT` below.
   */
  atsPrinciples: boolean;
  /**
   * Single accent bar beside the name, rather than a filled block behind it.
   * A filled block behind a name is legible but pushes the contact line into
   * low-contrast territory on a printed page, so only one template uses it.
   */
  nameBlockFill: boolean;
  /** Hairline rules under section headings. */
  sectionRules: boolean;
  /** Date ranges right-aligned on the same line as the role title. */
  inlineMeta: boolean;
  /** Skills rendered as a comma list rather than one per line. */
  compactSkills: boolean;
  /** Base body size in points, before the density multiplier. */
  baseFontSize: number;
  baseHeadingSize: number;
};

export const TEMPLATES: Record<TemplateKey, TemplateDefinition> = {
  'classic-ats': {
    key: 'classic-ats',
    label: 'Classic ATS',
    description: 'Single column, standard headings, no decoration. Built for parser-friendly reading order.',
    style: 'CLASSIC_ATS',
    atsPrinciples: true,
    nameBlockFill: false,
    sectionRules: true,
    inlineMeta: true,
    compactSkills: true,
    baseFontSize: 10,
    baseHeadingSize: 11,
  },
  'modern-professional': {
    key: 'modern-professional',
    label: 'Modern Professional',
    description: 'Contemporary type scale with a restrained accent rule and a filled name bar.',
    style: 'MODERN_PROFESSIONAL',
    atsPrinciples: true,
    nameBlockFill: true,
    sectionRules: true,
    inlineMeta: true,
    compactSkills: false,
    baseFontSize: 10.5,
    baseHeadingSize: 13,
  },
  'technical-minimal': {
    key: 'technical-minimal',
    label: 'Technical / Minimal',
    description: 'Dense, even rhythm and short headings. Suits engineering roles with long histories.',
    style: 'TECHNICAL_MINIMAL',
    atsPrinciples: true,
    nameBlockFill: false,
    sectionRules: false,
    inlineMeta: true,
    compactSkills: true,
    baseFontSize: 9.5,
    baseHeadingSize: 10.5,
  },
};

export function getTemplate(key: string): TemplateDefinition {
  return TEMPLATES[isTemplateKey(key) ? key : 'classic-ats'];
}

export const TEMPLATE_LIST: TemplateDefinition[] = TEMPLATE_KEYS.map((key) => TEMPLATES[key]);

/**
 * The exact wording used wherever ATS is mentioned.
 *
 * Deliberately a description of design, not a promise. "ATS-friendly" as a
 * badge implies a guaranteed parse rate that nobody — including the vendor of
 * the parsing software — can honestly deliver. What this template actually
 * does is follow the formatting principles those parsers read best, and saying
 * exactly that is both accurate and more useful to the user.
 */
export const ATS_STATEMENT =
  'Designed with ATS-friendly formatting principles: a single column, standard section headings, consistent typography and a plain reading order.';

/** Templates offered alongside the default, with their honest trade-offs. */
export const TEMPLATE_GUIDANCE: Record<TemplateKey, string> = {
  'classic-ats': 'The safest default when you do not know what will read your file.',
  'modern-professional': 'A little more visual identity. Still one column, still plain headings.',
  'technical-minimal': 'Tighter spacing for long technical histories. Readable, just denser.',
};