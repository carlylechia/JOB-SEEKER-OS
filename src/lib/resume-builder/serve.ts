/**
 * Server-side resume rendering helpers.
 *
 * The single seam between "a stored document" and "laid-out pages". Every
 * caller — the editor page, the preview endpoint, the PDF export — goes through
 * here, so there is exactly one place that knows fonts have to be prepared
 * before layout can run.
 *
 * This module is server-only by construction: it reaches `pdf.ts`, which reads
 * font files off disk and imports `pdf-lib`. Nothing in the client editor bundle
 * reaches it.
 */

import { buildLayout, type LayoutDocument } from './layout';
import { getLayoutMetrics, preparePdfEngine, renderPdfLayout } from './pdf';
import type { ResumeContent } from './schema';
import {
  DEFAULT_PAGE_SIZE,
  getAccent,
  isAccentKey,
  isPageSizeKey,
  isTemplateKey,
  type Density,
  type PageMargins,
} from './templates';
import type { StructuredResumeRecord } from './documents';

export type LayoutSource = {
  content: ResumeContent;
  templateKey?: string;
  accentKey?: string;
  density?: number;
  pageSize?: string;
  margins?: PageMargins;
  hiddenSections?: readonly string[];
};

/**
 * Lay out a document.
 *
 * Template, accent and density come from a validated source and are re-checked
 * here, so a value that arrived from a request body and slipped past validation
 * falls back to the default instead of reaching the renderer.
 */
export async function buildResumeLayout(source: LayoutSource): Promise<LayoutDocument> {
  await preparePdfEngine();

  return buildLayout(
    {
      content: source.content,
      templateKey: isTemplateKey(source.templateKey) ? source.templateKey : 'classic-ats',
      accentKey: isAccentKey(source.accentKey) ? source.accentKey : 'gold',
      density: (source.density === 0 || source.density === 1 || source.density === 2
        ? source.density
        : 1) as Density,
      pageSize: isPageSizeKey(source.pageSize) ? source.pageSize : DEFAULT_PAGE_SIZE,
      margins: source.margins,
      hiddenSections: source.hiddenSections ?? [],
    },
    getLayoutMetrics(),
  );
}

/** Lay out a stored resume record. */
export async function buildResumeLayoutFromRecord(
  resume: StructuredResumeRecord,
  overrides: Partial<LayoutSource> = {},
): Promise<LayoutDocument> {
  return buildResumeLayout({
    content: resume.content,
    templateKey: resume.templateKey,
    accentKey: resume.accentKey,
    density: resume.density,
    pageSize: resume.pageSize,
    hiddenSections: resume.hiddenSections,
    ...overrides,
  });
}

/** Render a laid-out document to PDF bytes. */
export async function renderResumePdf(layout: LayoutDocument) {
  await preparePdfEngine();
  return renderPdfLayout(layout);
}

export { getAccent };
