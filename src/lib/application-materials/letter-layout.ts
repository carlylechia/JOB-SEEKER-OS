/**
 * Layout for an exported cover letter or application message.
 *
 * Produces a `LayoutDocument` — the same shape the resume renderer consumes —
 * so `renderPdfLayout` can turn it into a downloadable PDF without a second
 * rendering stack. One or more A4 pages, single column, greeting + body +
 * sign-off as text blocks.
 *
 * Server-only: imported by the export route and never by the client bundle.
 */

import type { LayoutDocument, LayoutPage, LayoutBlock } from '@/lib/resume-builder/layout';
import { DEFAULT_MARGINS, PAGE_HEIGHT, PAGE_WIDTH } from '@/lib/resume-builder/layout';

const CONTENT_WIDTH = PAGE_WIDTH - DEFAULT_MARGINS.left - DEFAULT_MARGINS.right;

/**
 * Build a letter layout from the assembled material text.
 *
 * `content` is the full letter text (greeting + body + sign-off), already
 * assembled server-side. Paragraphs are split on blank lines and flow across
 * pages; a paragraph is never split mid-line.
 */
export function buildLetterLayout(params: {
  content: string;
  fontSize?: number;
}): LayoutDocument {
  const { content, fontSize = 11 } = params;

  const paragraphs = content
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p): p is string => p.length > 0);

  const lineHeight = fontSize * 1.4;
  const bottomLimit = PAGE_HEIGHT - DEFAULT_MARGINS.bottom - fontSize;

  const pages: LayoutPage[] = [];
  let pageIndex = 0;
  let currentPage: LayoutPage = newPage(pageIndex++);
  let y = DEFAULT_MARGINS.top;
  const currentBlocks: LayoutBlock[] = [];
  currentPage.blocks = currentBlocks;

  function flushLine(blocks: LayoutBlock[], text: string, y: number) {
    blocks.push({
      kind: 'TEXT',
      x: DEFAULT_MARGINS.left,
      y,
      width: CONTENT_WIDTH,
      text,
      style: 'regular',
      size: fontSize,
      color: '#111318',
    });
  }

  for (const paragraph of paragraphs) {
    const lines = wrapText(paragraph, fontSize, CONTENT_WIDTH);
    for (const line of lines) {
      if (y + fontSize > bottomLimit && currentBlocks.length > 0) {
        pages.push(currentPage);
        currentPage = newPage(pageIndex++);
        currentBlocks.length = 0;
        currentPage.blocks = currentBlocks;
        y = DEFAULT_MARGINS.top;
      }
      flushLine(currentBlocks, line, y);
      y += lineHeight;
    }
    // Paragraph gap — only add if there is room; otherwise next page handles it.
    if (y + lineHeight * 0.5 > bottomLimit && currentBlocks.length > 0) {
      pages.push(currentPage);
      currentPage = newPage(pageIndex++);
      currentBlocks.length = 0;
      currentPage.blocks = currentBlocks;
      y = DEFAULT_MARGINS.top;
    } else {
      y += lineHeight * 0.5;
    }
  }

  if (currentBlocks.length > 0) {
    pages.push(currentPage);
  }
  if (pages.length === 0) {
    pages.push(newPage(0));
  }

  return {
    templateKey: 'classic-ats',
    pageSize: 'A4',
    accentKey: 'gold',
    density: 1,
    fontSize,
    ascentRatio: 0.72,
    margins: DEFAULT_MARGINS,
    pages,
    warnings: [],
  };
}

function newPage(index: number): LayoutPage {
  return {
    index,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    margins: DEFAULT_MARGINS,
    blocks: [],
  };
}

/**
 * Wrap a paragraph into lines no wider than `maxWidth` points.
 *
 * A rough estimate using average character width; good enough for a
 * downloadable letter.
 */
function wrapText(text: string, fontSize: number, maxWidth: number): string[] {
  const avgCharWidth = fontSize * 0.55;
  const maxChars = Math.max(10, Math.floor(maxWidth / avgCharWidth));
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}
