/**
 * Measured business-letter layout for the existing PDF renderer.
 *
 * Paragraphs use the same bundled Inter metrics as resume exports. Contact and
 * company lines are included only when they exist in the user's saved records;
 * this module never invents addresses or recipient identities.
 */

import type { LayoutDocument, LayoutPage, LayoutTextRun, LayoutMetrics } from '@/lib/resume-builder/layout';
import { wrapText } from '@/lib/resume-builder/layout';
import { DEFAULT_PAGE_SIZE, PAGE_SIZES, getAccent, isPageSizeKey, type PageSizeKey } from '@/lib/resume-builder/templates';

export type LetterApplicant = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  location?: string | null;
  links?: string[];
};

type LetterLayoutParams = {
  content: string;
  metrics: LayoutMetrics;
  fontSize?: number;
  pageSize?: string;
  applicant?: LetterApplicant | null;
  date?: string | null;
  company?: string | null;
  jobTitle?: string | null;
  subject?: string | null;
};

export function buildLetterLayout(params: LetterLayoutParams): LayoutDocument {
  const pageSizeKey: PageSizeKey = isPageSizeKey(params.pageSize) ? params.pageSize : DEFAULT_PAGE_SIZE;
  const page = PAGE_SIZES[pageSizeKey];
  const margins = page.margins;
  const contentWidth = page.width - margins.left - margins.right;
  const bodySize = Math.max(10, params.fontSize ?? 10.5);
  const bodyLine = bodySize * 1.42;
  const pages: LayoutPage[] = [];
  const accent = getAccent('charcoal');
  let pageIndex = 0;
  let currentPage = newPage(pageIndex++, page.width, page.height, margins);
  let y = margins.top;

  const addLine = (text: string, options: { size?: number; style?: 'regular' | 'semibold'; color?: string; gapAfter?: number } = {}) => {
    const size = options.size ?? bodySize;
    const style = options.style ?? 'regular';
    const color = options.color ?? '#17191E';
    for (const line of wrapText(text, contentWidth, params.metrics, style, size)) {
      if (y + size * 1.5 > page.height - margins.bottom && currentPage.blocks.length > 0) {
        pages.push(currentPage);
        currentPage = newPage(pageIndex++, page.width, page.height, margins);
        y = margins.top;
      }
      const block: LayoutTextRun = {
        kind: 'TEXT', x: margins.left, y, width: contentWidth, text: line, style, size, color,
      };
      currentPage.blocks.push(block);
      y += Math.max(bodyLine, size * 1.3);
    }
    y += options.gapAfter ?? 0;
  };

  const applicant = params.applicant;
  if (applicant?.name?.trim()) addLine(applicant.name.trim(), { size: 17, style: 'semibold', gapAfter: 2 });
  const contact = [applicant?.email, applicant?.phone, applicant?.location]
    .filter((value): value is string => Boolean(value?.trim()));
  if (contact.length) addLine(contact.join('  ·  '), { size: 9.5, color: '#4A505A', gapAfter: 2 });
  const links = (applicant?.links ?? []).filter((value) => /^https?:\/\//i.test(value));
  if (links.length) addLine(links.map(displayUrl).join('  ·  '), { size: 9.5, color: accent.accentDeep, gapAfter: 8 });
  if (applicant?.name || contact.length || links.length) y += 4;

  if (params.date) addLine(params.date, { size: 10, color: '#4A505A', gapAfter: 12 });
  if (params.company?.trim()) addLine(params.company.trim(), { style: 'semibold', gapAfter: 2 });
  if (params.jobTitle?.trim()) addLine(`Re: ${params.subject?.trim() || `Application for ${params.jobTitle.trim()}`}`, { style: 'semibold', gapAfter: 12 });
  else if (params.subject?.trim()) addLine(`Re: ${params.subject.trim()}`, { style: 'semibold', gapAfter: 12 });

  const paragraphs = params.content
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  for (const paragraph of paragraphs) {
    addLine(paragraph, { gapAfter: bodyLine * 0.45 });
  }
  if (currentPage.blocks.length) pages.push(currentPage);
  if (!pages.length) pages.push(newPage(0, page.width, page.height, margins));

  const unsupported = new Set<string>();
  for (const documentPage of pages) {
    for (const block of documentPage.blocks) {
      if (block.kind !== 'TEXT') continue;
      for (const character of params.metrics.unsupportedCharacters(block.text)) unsupported.add(character);
    }
  }

  return {
    templateKey: 'classic-ats',
    pageSize: pageSizeKey,
    accentKey: 'charcoal',
    density: 1,
    fontSize: bodySize,
    ascentRatio: params.metrics.ascent(10) / 10,
    margins,
    pages,
    warnings: unsupported.size ? [{
      code: 'UNSUPPORTED_CHARACTERS',
      message: 'Some characters in this letter are not available in the export font.',
      characters: Array.from(unsupported).slice(0, 12),
    }] : [],
  };
}

function newPage(index: number, width: number, height: number, margins: LayoutPage['margins']): LayoutPage {
  return { index, width, height, margins, blocks: [] };
}

function displayUrl(value: string): string {
  try {
    const url = new URL(value);
    const host = url.host.replace(/^www\./, '');
    if (/linkedin\.com/i.test(host)) return 'LinkedIn';
    if (/github\.com/i.test(host)) return 'GitHub';
    return host;
  } catch { return value; }
}
