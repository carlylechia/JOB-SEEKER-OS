/**
 * The resume layout engine.
 *
 * This is the single place that decides what a resume LOOKS like and how it
 * breaks across pages. It is a pure function of
 *
 *     (validated content, template, accent, density, hidden sections)
 *
 * and it emits an absolutely-positioned block list in PDF points.
 *
 * ── Why one engine and two renderers ───────────────────────────────────────
 * A preview that is a re-implementation of the export will drift from it. So
 * there is exactly one geometry, and two renderers of it:
 *
 *   - `renderPdfLayout()`  (server, pdf-lib)     → the downloadable file
 *   - `<ResumeLayoutPreview>` (client, HTML/CSS) → what the user sees
 *
 * Because both consume the same blocks at the same coordinates, "the preview
 * shows what will be exported" is true by construction rather than by
 * discipline. Neither this module nor pdf-lib is ever imported by the client
 * editor bundle — text measurement is injected, so the engine itself is
 * dependency-free and unit-testable.
 *
 * ── Coordinate system ──────────────────────────────────────────────────────
 * TOP-LEFT origin, y increasing DOWNWARD, units = PDF points (1/72 inch).
 * PDF's native origin is bottom-left, so `renderPdfLayout()` performs the single
 * `pageHeight - y` flip. Doing the conversion in exactly one place is what
 * stops the classic "everything is mirrored" bug, and it means the preview can
 * use plain CSS `top:` with no transform gymnastics.
 *
 * ── Page breaks ────────────────────────────────────────────────────────────
 * Text splits at line boundaries only, so a bullet is never cut mid-sentence.
 * Headings are kept with at least the first two lines of what follows
 * (widow/orphan control), because a section title stranded at the foot of a page
 * is the single most common way a generated resume looks unfinished.
 */

import {
  RESUME_SECTION_KEYS,
  type ResumeContent,
  type ResumeCredential,
  type ResumeEducation,
  type ResumeExperience,
  type ResumeProject,
  type ResumeSkill,
} from './schema';
import {
  getAccent,
  getDensity,
  getTemplate,
  type AccentKey,
  type Density,
  type PageMargins,
  type PageSizeKey,
  type TemplateKey,
  DEFAULT_PAGE_SIZE,
  PAGE_SIZES,
  isPageSizeKey,
} from './templates';

// ─── Geometry ───────────────────────────────────────────────────────────────

/** Backwards-compatible A4 constants for document types using the default size. */
export const PAGE_WIDTH = PAGE_SIZES.A4.width;
export const PAGE_HEIGHT = PAGE_SIZES.A4.height;

export const DEFAULT_MARGINS: PageMargins = PAGE_SIZES[DEFAULT_PAGE_SIZE].margins;

/** Below this the content column is too narrow to be worth printing. */
const MIN_CONTENT_WIDTH = 180;

export type FontStyle = 'regular' | 'semibold';

/**
 * Text measurement, injected.
 *
 * Keeping this an argument is what lets the engine stay free of pdf-lib and
 * fontkit: the server passes a font-backed measurer, tests pass a cheap
 * approximation, and neither pulls a rendering library into the browser.
 */
export type LayoutMetrics = {
  /** Advance width of `text` in points, at the given style and size. */
  measure(text: string, style: FontStyle, size: number): number;
  /**
   * Distance from a line's top edge down to its BASELINE, in points.
   *
   * The engine positions lines by their top edge; PDF's `drawText` positions by
   * the baseline and CSS positions by the top of a line box. Carrying one
   * number that both renderers subtract is what keeps them describing the same
   * physical point. Getting this wrong by one ascent is what produces a preview
   * whose headings sit a few pixels above the exported ones.
   */
  ascent(size: number): number;
  /**
   * Characters the font stack cannot draw.
   *
   * Content is never silently dropped, so anything unrepresentable is reported
   * back and the caller can tell the user. Empty for a full-coverage stack.
   */
  unsupportedCharacters(text: string): string[];
};

// ─── Output ─────────────────────────────────────────────────────────────────

export type LayoutTextRun = {
  kind: 'TEXT';
  x: number;
  y: number;
  width: number;
  text: string;
  style: FontStyle;
  size: number;
  color: string;
};

export type LayoutRule = {
  kind: 'RULE';
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
};

export type LayoutFill = {
  kind: 'FILL';
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
};

export type LayoutBlock = LayoutTextRun | LayoutRule | LayoutFill;

export type LayoutPage = {
  index: number;
  width: number;
  height: number;
  margins: PageMargins;
  blocks: LayoutBlock[];
};

export type LayoutWarning = {
  /** Stable machine code; the copy lives in `layoutWarningMessages`. */
  code: 'UNSUPPORTED_CHARACTERS' | 'EMPTY_DOCUMENT' | 'TRUNCATED_CONTENT';
  message: string;
  /** The offending characters, deduped and capped. */
  characters?: string[];
};

export type LayoutDocument = {
  templateKey: TemplateKey;
  pageSize: PageSizeKey;
  accentKey: AccentKey;
  density: Density;
  /** Base body size in points, after the density multiplier. */
  fontSize: number;
  /**
   * Baseline offset per point of font size, for the font the layout was measured
   * with. Both renderers subtract `ascentRatio * size` from a block's `y` to
   * place the baseline; see `LayoutMetrics.ascent`.
   */
  ascentRatio: number;
  margins: PageMargins;
  pages: LayoutPage[];
  warnings: LayoutWarning[];
};

export const layoutWarningMessages = {
  UNSUPPORTED_CHARACTERS:
    'Some characters in your resume have no glyph in the export font and were replaced.',
  EMPTY_DOCUMENT:
    'This resume has no content yet, so the preview and the export are blank.',
  TRUNCATED_CONTENT:
    'Some entries were left out because the document reached its section limits.',
} satisfies Record<LayoutWarning['code'], string>;

// ─── Input ──────────────────────────────────────────────────────────────────

export type LayoutOptions = {
  content: ResumeContent;
  templateKey: TemplateKey;
  accentKey: AccentKey;
  density: Density;
  pageSize?: PageSizeKey;
  margins?: PageMargins;
  hiddenSections?: readonly string[];
};

// ─── Internal flow primitives ───────────────────────────────────────────────

type Cursor = { y: number };

/** A flowable that can be split across pages at line boundaries. */
type Flowable = {
  /** Total height when unsplit. */
  height: number;
  /** Emit into `page`, starting at `y`. Returns nothing; advances the cursor. */
  draw(page: LayoutPage, y: number, x: number, width: number): void;
  /**
   * Emit only the part that fits in `available`, starting at `y`.
   * Returns the height consumed and the remainder, or null when nothing fits.
   */
  drawPartial?(
    page: LayoutPage,
    y: number,
    x: number,
    width: number,
    available: number,
  ): { consumed: number; rest: Flowable | null } | null;
};

const RULE_HEIGHT = 0.75;
const BULLET_INDENT = 13;
const BULLET_GAP = 4;

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** `2024-03` → `Mar 2024`. Anything unreadable is returned unchanged. */
export function formatResumeDate(date: string | null): string | null {
  if (!date) return null;
  const match = /^(\d{4})-(\d{2})$/.exec(date);
  if (!match) return date;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return date;
  return `${MONTH_LABELS[month - 1]} ${match[1]}`;
}

function formatDateRange(start: string | null, end: string | null, isCurrent: boolean): string | null {
  const from = formatResumeDate(start);
  const to = isCurrent ? 'Present' : formatResumeDate(end);
  if (!from && !to) return null;
  if (from && !to) return from;
  if (!from && to) return to;
  return `${from} – ${to}`;
}

function joinParts(parts: Array<string | null | undefined>, separator = ' · '): string | null {
  const kept = parts.filter((part): part is string => Boolean(part && part.trim()));
  return kept.length > 0 ? kept.join(separator) : null;
}

/** Collapse runs of whitespace, including the newlines a textarea produces. */
function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

// ─── Word wrapping ──────────────────────────────────────────────────────────

/**
 * Wrap `text` to `width`, returning one measured line per visual row.
 *
 * Breaks on whitespace where possible. A single token longer than the line —
 * a long URL, a German-compound job title, a company name with no spaces — is
 * broken at a character boundary rather than allowed to overflow or be clipped.
 * Losing a line of someone's employer name to a silent clip would be worse than
 * an ugly break.
 */
export function wrapText(
  text: string,
  width: number,
  metrics: LayoutMetrics,
  style: FontStyle,
  size: number,
): string[] {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let current = '';

  const pushCurrent = () => {
    if (current.length > 0) {
      lines.push(current);
      current = '';
    }
  };

  const hardBreak = (token: string) => {
    // A token that cannot fit on a line of its own is split by character.
    let chunk = '';
    for (const char of token) {
      const candidate = chunk + char;
      if (chunk.length > 0 && metrics.measure(candidate, style, size) > width) {
        lines.push(chunk);
        chunk = char;
      } else {
        chunk = candidate;
      }
    }
    current = chunk;
  };

  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (metrics.measure(candidate, style, size) <= width || current.length === 0) {
      // `current.length === 0` guarantees progress even when a single word is
      // wider than the column, so this loop always terminates.
      if (metrics.measure(candidate, style, size) > width && current.length === 0) {
        pushCurrent();
        hardBreak(word);
      } else {
        current = candidate;
      }
    } else {
      pushCurrent();
      hardBreak(word);
    }
  }
  pushCurrent();

  return lines;
}

// ─── Flow helpers ───────────────────────────────────────────────────────────

class Flow {
  readonly pages: LayoutPage[] = [];
  private current: LayoutPage;
  private cursor: number;

  constructor(
    private readonly margins = DEFAULT_MARGINS,
    private readonly pageWidth = PAGE_WIDTH,
    private readonly pageHeight = PAGE_HEIGHT,
  ) {
    this.current = this.newPage();
    this.cursor = margins.top;
  }

  private newPage(): LayoutPage {
    return {
      index: this.pages.length,
      width: this.pageWidth,
      height: this.pageHeight,
      margins: this.margins,
      blocks: [],
    };
  }

  get y(): number {
    return this.cursor;
  }

  get contentWidth(): number {
    return this.pageWidth - this.margins.left - this.margins.right;
  }

  get bottom(): number {
    return this.pageHeight - this.margins.bottom;
  }

  get isFirstPage(): boolean {
    return this.pages.length === 0;
  }

  get remaining(): number {
    return this.bottom - this.cursor;
  }

  breakPage(): void {
    this.pages.push(this.current);
    this.current = this.newPage();
    this.cursor = this.margins.top;
  }

  /** Push the current page even if it is empty, so a blank resume is 1 page. */
  finish(): LayoutPage[] {
    this.pages.push(this.current);
    return this.pages;
  }

  /**
   * Place a flowable, splitting it across pages when it does not fit.
   *
   * `keepWithNext` is the minimum height that must stay on the same page as
   * this flowable. Passing a heading's own height plus the first two lines of
   * the block beneath it is what prevents a stranded section title.
   */
  place(flowable: Flowable, keepWithNext = 0): void {
    if (this.remaining < flowable.height + keepWithNext && !this.isFirstPage) {
      this.breakPage();
    }
    this.drawSplit(flowable);
  }

  private drawSplit(flowable: Flowable): void {
    let remainingFlowable: Flowable | null = flowable;

    while (remainingFlowable) {
      const space = this.remaining;
      if (space < 1) {
        this.breakPage();
        continue;
      }

      if (remainingFlowable.height <= space) {
        remainingFlowable.draw(this.current, this.cursor, this.margins.left, this.contentWidth);
        this.cursor += remainingFlowable.height;
        return;
      }

      const partial: {
        consumed: number;
        rest: Flowable | null;
      } | null = remainingFlowable.drawPartial?.(
        this.current,
        this.cursor,
        this.margins.left,
        this.contentWidth,
        space,
      ) ?? null;

      if (partial && partial.consumed > 0) {
        this.cursor += partial.consumed;
        if (partial.rest) {
          this.breakPage();
          remainingFlowable = partial.rest;
          continue;
        }
        return;
      }

      // Nothing could be placed here. Move to a fresh page and try once more;
      // if it still fails the flowable is dropped rather than looping forever.
      if (this.isFirstPage) {
        remainingFlowable.draw(this.current, this.cursor, this.margins.left, this.contentWidth);
        this.cursor += remainingFlowable.height;
        return;
      }
      this.breakPage();
    }
  }
}

// ─── Flowable builders ──────────────────────────────────────────────────────

type TextFlowableOptions = {
  text: string;
  style: FontStyle;
  size: number;
  color: string;
  lineHeight: number;
  metrics: LayoutMetrics;
  /** Extra indent for continuation lines (bullet hanging indent). */
  indent?: number;
  /** Bullet glyph drawn in the indent gutter. */
  bullet?: string;
  bulletColor?: string;
  align?: 'left' | 'right';
};

function textFlowable(options: TextFlowableOptions): Flowable {
  const { text, style, size, color, lineHeight, metrics, indent = 0, align = 'left' } = options;
  const bullet = options.bullet ?? null;

  // Width available to the text: the full column minus the hanging indent.
  const hangWidth = (width: number) => Math.max(MIN_CONTENT_WIDTH, width - indent);
  const linesFor = (width: number) => wrapText(text, hangWidth(width), metrics, style, size);

  return {
    height: linesFor(PAGE_WIDTH - DEFAULT_MARGINS.left - DEFAULT_MARGINS.right).length * lineHeight,

    draw(page, y, x, width) {
      const lines = linesFor(width);
      lines.forEach((line, index) => {
        const lineWidth = metrics.measure(line, style, size);
        const lineX = align === 'right' ? x + width - lineWidth : x + indent;
        const baseline = y + index * lineHeight;

        if (bullet && index === 0) {
          page.blocks.push({
            kind: 'TEXT',
            x,
            y: baseline,
            width: indent - BULLET_GAP,
            text: bullet,
            style: 'regular',
            size,
            color: options.bulletColor ?? color,
          });
        }
        page.blocks.push({
          kind: 'TEXT',
          x: lineX,
          y: baseline,
          width: lineWidth,
          text: line,
          style,
          size,
          color,
        });
      });
    },

    drawPartial(page, y, x, width, available) {
      const lines = linesFor(width);
      const capacity = Math.floor(available / lineHeight);
      if (capacity <= 0) return null;

      const take = Math.min(capacity, lines.length);
      const rest = lines.slice(take).join(' ');

      textFlowable({
        ...options,
        text: lines.slice(0, take).join(' '),
      }).draw(page, y, x, width);

      return {
        consumed: take * lineHeight,
        rest: rest.length > 0 ? textFlowable({ ...options, text: rest }) : null,
      };
    },
  };
}

function ruleFlowable(height: number, color: string, widthFraction = 1): Flowable {
  return {
    height: RULE_HEIGHT + (height > RULE_HEIGHT ? height - RULE_HEIGHT : 0),
    draw(page, y, x, width) {
      page.blocks.push({
        kind: 'RULE',
        x,
        y: y + height / 2,
        width: width * widthFraction,
        height: RULE_HEIGHT,
        color,
      });
    },
  };
}

/** Fixed vertical space. Carries nothing, so it never needs to split. */
function spaceFlowable(height: number): Flowable {
  return { height, draw() {} };
}

/**
 * A section heading, optionally followed by a rule.
 *
 * Keeping the heading with the body is handled by the CALLER, which passes the
 * reserved height to `Flow.place()` — that needs to know how much of the next
 * block must stay with it, and only the caller knows what follows.
 */
function headingFlowable(params: {
  text: string;
  size: number;
  color: string;
  ruleColor: string;
  showRule: boolean;
  metrics: LayoutMetrics;
  ruleFraction?: number;
}): Flowable {
  const base = textFlowable({
    text: params.text,
    style: 'semibold',
    size: params.size,
    color: params.color,
    lineHeight: params.size * 1.2,
    metrics: params.metrics,
  });

  const ruleGap = 3;
  const ruleTotal = params.showRule ? ruleGap + RULE_HEIGHT + ruleGap : 0;

  return {
    height: base.height + ruleTotal,
    draw(page, y, x, width) {
      base.draw(page, y, x, width);
      if (params.showRule) {
        page.blocks.push({
          kind: 'RULE',
          x,
          y: y + base.height + ruleGap,
          width: width * (params.ruleFraction ?? 1),
          height: RULE_HEIGHT,
          color: params.ruleColor,
        });
      }
    },
  };
}

// ─── Content walkers ────────────────────────────────────────────────────────

function isExperienceEmpty(entry: ResumeExperience): boolean {
  return (
    !entry.jobTitle &&
    !entry.company &&
    entry.responsibilities.length === 0 &&
    entry.achievements.length === 0
  );
}

function isEducationEmpty(entry: ResumeEducation): boolean {
  return !entry.institution && !entry.qualification && !entry.fieldOfStudy && !entry.details;
}

function isProjectEmpty(entry: ResumeProject): boolean {
  return !entry.name && !entry.description && entry.results.length === 0;
}

function isCredentialEmpty(entry: ResumeCredential): boolean {
  return !entry.name;
}

/** Contact details, in the order a recruiter reads them. */
export function contactLineFor(content: ResumeContent): string | null {
  const { basics } = content;
  const parts = [
    basics.email,
    basics.phone,
    basics.location,
    basics.linkedinUrl,
    basics.portfolioUrl,
    basics.websiteUrl,
  ].filter((part): part is string => Boolean(part && part.trim()));
  if (parts.length === 0) return null;
  // The separator is attached to each part so a line break can never strand a
  // lone "·" at the end of a line.
  return parts.map((part, index) => (index === parts.length - 1 ? part : `${part} ·`)).join(' ');
}

// ─── The engine ─────────────────────────────────────────────────────────────

/**
 * Build the full paginated layout.
 *
 * Pure: the same inputs always produce the same output, which is what makes the
 * preview reproducible and the tests meaningful.
 */
export function buildLayout(options: LayoutOptions, metrics: LayoutMetrics): LayoutDocument {
  const template = getTemplate(options.templateKey);
  const accent = getAccent(options.accentKey);
  const density = getDensity(options.density);
  const pageSize = isPageSizeKey(options.pageSize) ? options.pageSize : DEFAULT_PAGE_SIZE;
  const page = PAGE_SIZES[pageSize];
  const margins = options.margins ?? page.margins;

  const body = Math.max(9.5, template.baseFontSize * density.scale);
  const heading = template.baseHeadingSize * density.scale;
  const bodyLine = body * 1.38 + density.lineGap;
  const metaLine = body * 1.22 + density.lineGap;

  const ink = '#17191E';
  const mutedInk = '#4A505A';

  const hidden = new Set(options.hiddenSections ?? []);
  const visible = RESUME_SECTION_KEYS.filter((key) => !hidden.has(key));

  const unsupported = new Set<string>();
  const trackUnsupported = (value: string | null | undefined) => {
    if (!value) return;
    for (const char of metrics.unsupportedCharacters(value)) unsupported.add(char);
  };

  // Track every string that can reach the page.
  const trackContent = (content: ResumeContent) => {
    for (const value of Object.values(content.basics)) trackUnsupported(value);
    trackUnsupported(content.summary);
    for (const entry of content.experiences) {
      trackUnsupported(entry.jobTitle);
      trackUnsupported(entry.company);
      trackUnsupported(entry.location);
      for (const bullet of [...entry.responsibilities, ...entry.achievements, ...entry.technologies]) {
        trackUnsupported(bullet);
      }
    }
    for (const entry of content.education) {
      trackUnsupported(entry.institution);
      trackUnsupported(entry.qualification);
      trackUnsupported(entry.fieldOfStudy);
      trackUnsupported(entry.details);
    }
    for (const skill of content.skills) trackUnsupported(skill.name);
    for (const entry of content.projects) {
      trackUnsupported(entry.name);
      trackUnsupported(entry.description);
      trackUnsupported(entry.role);
      for (const value of [...entry.technologies, ...entry.results]) trackUnsupported(value);
    }
    for (const entry of content.credentials) {
      trackUnsupported(entry.name);
      trackUnsupported(entry.issuer);
      trackUnsupported(entry.proficiency);
      trackUnsupported(entry.details);
    }
  };
  trackContent(options.content);

  const flow = new Flow(margins, page.width, page.height);
  const push = (flowable: Flowable, keepWithNext = 0) => flow.place(flowable, keepWithNext);
  const gap = (points: number) => {
    if (points > 0) push(spaceFlowable(points));
  };

  // ── Header ────────────────────────────────────────────────────────────────
  const basics = options.content.basics;
  const fullName = collapse(basics.fullName ?? '');
  const headline = collapse(basics.headline ?? '');
  const contacts = contactLineFor(options.content);

  if (template.nameBlockFill) {
    const nameSize = heading * 2.1;
    const nameLines = wrapText(
      fullName || 'Your Name',
      flow.contentWidth - 32,
      metrics,
      'semibold',
      nameSize,
    );
    const headlineLines = headline
      ? wrapText(headline, flow.contentWidth - 32, metrics, 'regular', body * 1.15)
      : [];
    const contactLines = contacts
      ? wrapText(contacts, flow.contentWidth - 32, metrics, 'regular', body * 0.98)
      : [];

    const padTop = 14;
    const padBottom = 14;
    const headerHeight =
      padTop +
      nameLines.length * nameSize * 1.18 +
      (headlineLines.length > 0 ? 4 + headlineLines.length * body * 1.3 : 0) +
      (contactLines.length > 0 ? 6 + contactLines.length * body * 1.25 : 0) +
      padBottom;

    push({
      height: headerHeight,
      draw(page, y, x, width) {
        page.blocks.push({ kind: 'FILL', x, y, width, height: headerHeight, color: accent.accent });

        let cursor = y + padTop;
        nameLines.forEach((line, index) => {
          page.blocks.push({
            kind: 'TEXT',
            x: x + 16,
            y: cursor + index * nameSize * 1.18,
            width: metrics.measure(line, 'semibold', nameSize),
            text: line,
            style: 'semibold',
            size: nameSize,
            color: accent.textOnAccent,
          });
        });
        cursor += nameLines.length * nameSize * 1.18;

        if (headlineLines.length > 0) {
          cursor += 4;
          headlineLines.forEach((line, index) => {
            page.blocks.push({
              kind: 'TEXT',
              x: x + 16,
              y: cursor + index * body * 1.3,
              width: metrics.measure(line, 'regular', body * 1.15),
              text: line,
              style: 'regular',
              size: body * 1.15,
              color: accent.textOnAccent,
            });
          });
          cursor += headlineLines.length * body * 1.3;
        }

        if (contactLines.length > 0) {
          cursor += 6;
          contactLines.forEach((line, index) => {
            page.blocks.push({
              kind: 'TEXT',
              x: x + 16,
              y: cursor + index * body * 1.25,
              width: metrics.measure(line, 'regular', body * 0.98),
              text: line,
              style: 'regular',
              size: body * 0.98,
              color: accent.textOnAccent,
            });
          });
        }
      },
    });
    gap(density.sectionGap);
  } else {
    const nameSize = heading * 1.75;
    if (fullName) {
      push(
        textFlowable({
          text: fullName,
          style: 'semibold',
          size: nameSize,
          color: ink,
          lineHeight: nameSize * 1.16,
          metrics,
        }),
      );
    }
    if (headline) {
      gap(2);
      push(
        textFlowable({
          text: headline,
          style: 'regular',
          size: body * 1.14,
          color: accent.accentDeep,
          lineHeight: body * 1.3,
          metrics,
        }),
      );
    }
    if (contacts) {
      gap(4);
      push(
        textFlowable({
          text: contacts,
          style: 'regular',
          size: body * 0.98,
          color: mutedInk,
          lineHeight: body * 1.25,
          metrics,
        }),
      );
    }
    if (template.sectionRules) {
      gap(8);
      push(ruleFlowable(1, accent.accent));
    }
    gap(density.sectionGap);
  }

  // Heading plus a small gap before the body, so a template with no rule (and a
  // rule-bearing one) both read as a heading rather than as two unrelated lines.
  const sectionHeading = (label: string) => [
    headingFlowable({
      text: label.toUpperCase(),
      size: template.style === 'TECHNICAL_MINIMAL' ? heading : heading * 0.94,
      color: accent.accentDeep,
      ruleColor: accent.accent,
      showRule: template.sectionRules,
      metrics,
      ruleFraction:
        template.style === 'MODERN_PROFESSIONAL'
          ? 0.28
          : template.style === 'EXECUTIVE_EXPERIENCED'
            ? 0.62
            : 1,
    }),
    spaceFlowable(3),
  ] as const;

  /**
   * Emit a heading and the gap beneath it.
   *
   * `keepWithNext` reserves room on the current page for the heading plus the
   * first lines of the body, which is what stops a section title from being the
   * last thing on a page.
   */
  const pushSectionHeading = (label: string, keepWithNext: number) => {
    const [heading, trailing] = sectionHeading(label);
    push(heading, keepWithNext);
    push(trailing);
  };

  const bullet = (text: string, color: string, size: number) =>
    textFlowable({
      // The glyph is drawn separately in the gutter; prefixing it here too would
      // print it twice.
      text,
      style: 'regular',
      size,
      color,
      lineHeight: bodyLine,
      metrics,
      indent: BULLET_INDENT,
      bullet: '•',
      bulletColor: accent.accentDeep,
    });

  // ── Summary ───────────────────────────────────────────────────────────────
  const summary = collapse(options.content.summary ?? '');
  if (visible.includes('summary') && summary.length > 0) {
    pushSectionHeading('Professional Summary', bodyLine * 2);
    push(
      textFlowable({
        text: summary,
        style: 'regular',
      size: template.style === 'EXECUTIVE_EXPERIENCED' ? body * 1.06 : body,
        color: ink,
      lineHeight: template.style === 'EXECUTIVE_EXPERIENCED' ? body * 1.52 : bodyLine,
        metrics,
      }),
    );
    gap(density.sectionGap);
  }

  // ── Experience ────────────────────────────────────────────────────────────
  const experiences = options.content.experiences.filter((entry) => !isExperienceEmpty(entry));
  if (visible.includes('experience') && experiences.length > 0) {
    pushSectionHeading('Professional Experience', bodyLine * 2);

    experiences.forEach((entry, index) => {
      if (index > 0) gap(body * 0.5);

      const roleLine = template.inlineMeta
        ? joinParts([entry.jobTitle, entry.company], ' · ')
        : collapse(entry.jobTitle ?? entry.company ?? '');
      const dates = formatDateRange(entry.startDate, entry.endDate, entry.isCurrent);

      if (roleLine || dates) {
        push(
          inlinePairFlowable({
            left: roleLine,
            leftStyle: 'semibold',
            right: dates,
            size: body * 1.03,
            leftColor: ink,
            rightColor: mutedInk,
            lineHeight: metaLine,
            metrics,
            contentWidth: flow.contentWidth,
          }),
          bodyLine * 2,
        );
      }

      if (!template.inlineMeta && entry.jobTitle && entry.company) {
        push(
          textFlowable({
            text: entry.company,
            style: 'regular',
            size: body * 0.98,
            color: accent.accentDeep,
            lineHeight: metaLine,
            metrics,
          }),
        );
      }

      if (entry.location) {
        push(
          textFlowable({
            text: entry.location,
            style: 'regular',
            size: body * 0.95,
            color: mutedInk,
            lineHeight: metaLine,
            metrics,
          }),
        );
      }

      for (const responsibility of entry.responsibilities) {
        push(bullet(responsibility, ink, body));
      }
      for (const achievement of entry.achievements) {
        push(bullet(achievement, ink, body));
      }

      if (entry.technologies.length > 0) {
        gap(1);
        push(
          textFlowable({
            text: `Technologies: ${entry.technologies.join(', ')}`,
            style: 'regular',
            size: body * 0.93,
            color: mutedInk,
            lineHeight: metaLine,
            metrics,
          }),
        );
      }
    });
    gap(density.sectionGap);
  }

  // ── Skills ────────────────────────────────────────────────────────────────
  const skills = options.content.skills;
  if (visible.includes('skills') && skills.length > 0) {
    pushSectionHeading('Skills', bodyLine);
    pushSkills(push, skills, template.compactSkills, body, bodyLine, metrics, accent);
    gap(density.sectionGap);
  }

  // ── Education ─────────────────────────────────────────────────────────────
  const education = options.content.education.filter((entry) => !isEducationEmpty(entry));
  if (visible.includes('education') && education.length > 0) {
    pushSectionHeading('Education', bodyLine * 2);

    education.forEach((entry, index) => {
      if (index > 0) gap(body * 0.45);
      const headline = joinParts([entry.qualification, entry.fieldOfStudy], ', ');
      const dates = formatDateRange(entry.startDate, entry.endDate, false);

      push(
        inlinePairFlowable({
          left: headline ?? entry.institution ?? null,
          leftStyle: 'semibold',
          right: dates,
          size: body,
          leftColor: ink,
          rightColor: mutedInk,
          lineHeight: metaLine,
          metrics,
          contentWidth: flow.contentWidth,
        }),
        bodyLine,
      );

      if (entry.institution && headline) {
        push(
          textFlowable({
            text: entry.institution,
            style: 'regular',
            size: body * 0.95,
            color: mutedInk,
            lineHeight: metaLine,
            metrics,
          }),
        );
      }
      if (entry.details) {
        push(bullet(entry.details, ink, body));
      }
    });
    gap(density.sectionGap);
  }

  // ── Projects ──────────────────────────────────────────────────────────────
  const projects = options.content.projects.filter((entry) => !isProjectEmpty(entry));
  if (visible.includes('projects') && projects.length > 0) {
    pushSectionHeading('Projects', bodyLine * 2);

    projects.forEach((entry, index) => {
      if (index > 0) gap(body * 0.45);
      const dates = formatDateRange(entry.startDate, entry.endDate, false);
      push(
        inlinePairFlowable({
          left: entry.name,
          leftStyle: 'semibold',
          right: dates,
          size: body,
          leftColor: ink,
          rightColor: mutedInk,
          lineHeight: metaLine,
          metrics,
          contentWidth: flow.contentWidth,
        }),
        bodyLine * 2,
      );

      const meta = joinParts([entry.role, entry.technologies.join(', ')]);
      if (meta) {
        push(
          textFlowable({
            text: meta,
            style: 'regular',
            size: body * 0.93,
            color: mutedInk,
            lineHeight: metaLine,
            metrics,
          }),
        );
      }
      if (entry.description) {
        push(bullet(entry.description, ink, body));
      }
      for (const result of entry.results) push(bullet(result, ink, body));
    });
    gap(density.sectionGap);
  }

  // ── Credentials ───────────────────────────────────────────────────────────
  const credentials = options.content.credentials.filter((entry) => !isCredentialEmpty(entry));
  if (visible.includes('credentials') && credentials.length > 0) {
    const headingText = credentials.some((entry) => entry.kind === 'AWARD')
      ? 'Certifications & Awards'
      : credentials.some((entry) => entry.kind === 'LANGUAGE')
        ? 'Certifications & Languages'
        : 'Certifications';
    pushSectionHeading(headingText, bodyLine);

    for (const entry of credentials) {
      const issuer = entry.issuer ? ` — ${entry.issuer}` : '';
      const proficiency = entry.proficiency ? ` (${entry.proficiency})` : '';
      const issued = formatResumeDate(entry.issuedDate);
      push(
        textFlowable({
          text: collapse(`${entry.name}${issuer}${proficiency}`),
          style: 'regular',
          size: body,
          color: ink,
          lineHeight: bodyLine,
          metrics,
        }),
      );
      if (issued || entry.details) {
        push(
          textFlowable({
            text: collapse([issued ? `${issued}${entry.expiresDate ? ` – ${formatResumeDate(entry.expiresDate)}` : ''}` : null, entry.details].filter(Boolean).join(' · ')),
            style: 'regular',
            size: body * 0.92,
            color: mutedInk,
            lineHeight: metaLine,
            metrics,
            indent: BULLET_INDENT,
          }),
        );
      }
    }
    gap(density.sectionGap);
  }

  const pages = flow.finish();

  const warnings: LayoutWarning[] = [];
  if (unsupported.size > 0) {
    warnings.push({
      code: 'UNSUPPORTED_CHARACTERS',
      message: layoutWarningMessages.UNSUPPORTED_CHARACTERS,
      characters: Array.from(unsupported).slice(0, 20),
    });
  }
  const hasAnyContent =
    Boolean(fullName || headline || contacts || summary) ||
    experiences.length > 0 ||
    skills.length > 0 ||
    education.length > 0 ||
    projects.length > 0 ||
    credentials.length > 0;
  if (!hasAnyContent) {
    warnings.push({ code: 'EMPTY_DOCUMENT', message: layoutWarningMessages.EMPTY_DOCUMENT });
  }

  return {
    templateKey: options.templateKey,
    pageSize,
    accentKey: options.accentKey,
    density: options.density,
    fontSize: body,
    ascentRatio: metrics.ascent(100) / 100,
    margins,
    pages,
    warnings,
  };
}

/**
 * Left text with a right-aligned date range on the same line.
 *
 * When the pair genuinely cannot share a line — a very long employer name plus a
 * date range — the date range moves onto its own right-aligned line rather than
 * being truncated or dropped. Overflowing content is never a reason to lose
 * information.
 */
function inlinePairFlowable(params: {
  left: string | null;
  leftStyle: FontStyle;
  right: string | null;
  size: number;
  leftColor: string;
  rightColor: string;
  lineHeight: number;
  metrics: LayoutMetrics;
  contentWidth: number;
}): Flowable {
  const { left, right, leftStyle, size, leftColor, rightColor, lineHeight, metrics, contentWidth } = params;
  const leftLines = left ? wrapText(left, contentWidth, metrics, leftStyle, size) : [];
  const rightLines = right ? wrapText(right, contentWidth, metrics, 'regular', size) : [];
  const rightWidth = right ? metrics.measure(right, 'regular', size) : 0;
  const leftWidth = right ? contentWidth - rightWidth - 12 : 0;
  const canShare = Boolean(left && right && leftWidth > MIN_CONTENT_WIDTH && metrics.measure(left, leftStyle, size) <= leftWidth);

  return {
    height: canShare
      ? Math.max(leftLines.length, rightLines.length, 1) * lineHeight
      : (left ? Math.max(leftLines.length, 1) : 0) * lineHeight + (right ? Math.max(rightLines.length, 1) * lineHeight : 0),

    draw(page, y, x, width) {
      if (!left && !right) return;

      if (!right) {
        if (left) {
          textFlowable({ text: left, style: leftStyle, size, color: leftColor, lineHeight, metrics }).draw(
            page,
            y,
            x,
            width,
          );
        }
        return;
      }

      if (!left) {
        textFlowable({
          text: right,
          style: 'regular',
          size,
          color: rightColor,
          lineHeight,
          metrics,
          align: 'right',
        }).draw(page, y, x, width);
        return;
      }

      const measuredRightWidth = metrics.measure(right, 'regular', size);
      const availableLeftWidth = width - measuredRightWidth - 12;

      if (availableLeftWidth > MIN_CONTENT_WIDTH && metrics.measure(left, leftStyle, size) <= availableLeftWidth) {
        const sharedLeftLines = wrapText(left, availableLeftWidth, metrics, leftStyle, size);
        const sharedRightLines = wrapText(right, measuredRightWidth + 1, metrics, 'regular', size);
        sharedLeftLines.forEach((line, index) => {
          page.blocks.push({
            kind: 'TEXT',
            x,
            y: y + index * lineHeight,
            width: metrics.measure(line, leftStyle, size),
            text: line,
            style: leftStyle,
            size,
            color: leftColor,
          });
        });
        sharedRightLines.forEach((line, index) => {
          page.blocks.push({
            kind: 'TEXT',
            x: x + width - metrics.measure(line, 'regular', size),
            y: y + index * lineHeight,
            width: metrics.measure(line, 'regular', size),
            text: line,
            style: 'regular',
            size,
            color: rightColor,
          });
        });
        return;
      }

      // Too tight to share: stack them, keeping the dates right-aligned.
      textFlowable({ text: left, style: leftStyle, size, color: leftColor, lineHeight, metrics }).draw(
        page,
        y,
        x,
        width,
      );
      textFlowable({
        text: right,
        style: 'regular',
        size,
        color: rightColor,
        lineHeight,
        metrics,
        align: 'right',
      }).draw(page, y + Math.max(leftLines.length, 1) * lineHeight, x, width);
    },
  };
}

function pushSkills(
  push: (flowable: Flowable) => void,
  skills: ResumeSkill[],
  compact: boolean,
  body: number,
  bodyLine: number,
  metrics: LayoutMetrics,
  accent: ReturnType<typeof getAccent>,
): void {
  // Group by category while preserving first-appearance order, so a user's own
  // ordering is respected rather than overwritten by alphabetical sorting.
  const groups = new Map<string, ResumeSkill[]>();
  for (const skill of skills) {
    const key = collapse(skill.category ?? '') || 'Skills';
    const bucket = groups.get(key);
    if (bucket) bucket.push(skill);
    else groups.set(key, [skill]);
  }

  const groupsInOrder = Array.from(groups.entries()).filter(
    ([, items]) => items.some((skill) => skill.name.trim().length > 0),
  );

  if (groupsInOrder.length === 0) return;

  if (compact && groupsInOrder.length === 1) {
    const [, items] = groupsInOrder[0];
    push(
      textFlowable({
        text: items
          .filter((skill) => skill.name.trim().length > 0)
          .map((skill) => skill.name.trim())
          .join(' · '),
        style: 'regular',
        size: body,
        color: '#17191E',
        lineHeight: bodyLine,
        metrics,
      }),
    );
    return;
  }

  // When every skill fell into the default group there is nothing to label:
  // the section heading already says "SKILLS". Printing the word again would
  // make this template's text differ from the others for no visual gain, and a
  // template should never add words the user did not write.
  const singleUngrouped = groupsInOrder.length === 1 && groupsInOrder[0][0] === 'Skills';

  for (const [label, items] of groupsInOrder) {
    const names = items
      .filter((skill) => skill.name.trim().length > 0)
      .map((skill) => skill.name.trim());
    if (names.length === 0) continue;

    if (compact) {
      push(
        textFlowable({
          text: `${label}: ${names.join(' · ')}`,
          style: 'regular',
          size: body,
          color: '#17191E',
          lineHeight: bodyLine,
          metrics,
        }),
      );
    } else {
      if (!singleUngrouped) {
        push(
          textFlowable({
            text: label,
            style: 'semibold',
            size: body * 0.95,
            color: accent.accentDeep,
            lineHeight: metaLineOf(body, bodyLine),
            metrics,
          }),
        );
      }
      push(
        textFlowable({
          text: names.join(' · '),
          style: 'regular',
          size: body,
          color: '#17191E',
          lineHeight: bodyLine,
          metrics,
        }),
      );
    }
  }
}

function metaLineOf(body: number, bodyLine: number): number {
  return Math.min(bodyLine, body * 1.22);
}
