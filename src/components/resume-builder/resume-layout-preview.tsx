'use client';

/**
 * Resume preview.
 *
 * This component renders the SAME layout blocks the PDF renderer consumes, at
 * the same coordinates, in the same units. It is not a re-implementation of the
 * document and it does not reflow anything — every run, every bullet and every
 * heading is absolutely positioned from the server's geometry.
 *
 * That is the whole point. A preview that re-rendered the content in HTML would
 * drift from the export the first time a font metric disagreed, and the user
 * would only find out after sending the file to an employer. Here, "what I see"
 * and "what they get" are the same numbers.
 *
 * The only transformation applied is the one the PDF also applies: a line's top
 * edge is converted to its baseline using the layout's own `ascentRatio`, so a
 * heading lands at the same height in both.
 *
 * Scaled to fit its container with a single `transform: scale()` on the page
 * wrapper, which keeps the internal geometry in true points and the browser's
 * sub-pixel text rendering intact.
 */

// The same typeface the PDF embeds, so a line the server wrapped to fit fits
// here too. `@fontsource` splits the family into subsets with explicit
// unicode-ranges, so a Latin-only resume downloads ~24 KB rather than the full
// 340 KB face, and Cyrillic or Greek text pulls in only its own subset.
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';

import { useMemo, type CSSProperties } from 'react';
import { DOCUMENT_FONT_FAMILIES } from '@/lib/resume-builder/templates';
import type { LayoutBlock, LayoutDocument, LayoutPage } from '@/lib/resume-builder/layout';

type Props = {
  layout: LayoutDocument;
  /**
   * Width in CSS pixels available for the preview.
   *
   * Used only to compute the scale factor; the page keeps its true point size so
   * nothing is measured at a different size than the PDF uses.
   */
  availableWidth: number;
  className?: string;
  /** Accessible description of what is being shown. */
  label?: string;
  /** Recently applied proposal text to visually mark in the live preview. */
  highlightedText?: string[];
};

/**
 * Mirrors the PDF's font stack.
 *
 * The PDF embeds Inter Regular and SemiBold, so the preview asks for the same
 * two weights and nothing else. If the webfont somehow fails to load the
 * fallback stack takes over: the layout is absolute, so it degrades to slightly
 * different letterforms rather than to a broken document.
 */
const FONT_STACK =
  `'${DOCUMENT_FONT_FAMILIES.pdf}', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`;

export function ResumeLayoutPreview({
  layout,
  availableWidth,
  className,
  label = 'Resume preview',
  highlightedText = [],
}: Props) {
  const pageWidth = layout.pages[0]?.width ?? 595.28;
  const scale = useMemo(() => {
    if (availableWidth <= 0) return 1;
    return Math.min(1, availableWidth / pageWidth);
  }, [availableWidth, pageWidth]);

  if (layout.pages.length === 0) {
    return (
      <p className="muted py-8 text-center" role="status">
        Nothing to preview yet.
      </p>
    );
  }

  return (
    <div className={className}>
      <div className="flex flex-col items-center gap-5">
        {layout.pages.map((page) => (
          <PreviewPage
            key={page.index}
            page={page}
            scale={scale}
            ascentRatio={layout.ascentRatio}
            label={`${label}, page ${page.index + 1} of ${layout.pages.length}`}
            highlightedText={highlightedText}
          />
        ))}
      </div>

      {layout.warnings.length > 0 ? (
        <ul className="mt-4 space-y-1 text-xs text-warn-text">
          {layout.warnings.map((warning) => (
            <li key={warning.code}>
              {warning.message}
              {warning.characters && warning.characters.length > 0 ? (
                <span className="ml-1 font-mono">{warning.characters.join(' ')}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function PreviewPage({
  page,
  scale,
  ascentRatio,
  label,
  highlightedText,
}: {
  page: LayoutPage;
  scale: number;
  ascentRatio: number;
  label: string;
  highlightedText: string[];
}) {
  return (
    <div
      role="img"
      aria-label={label}
      className="relative shrink-0 overflow-hidden rounded-lg border border-line bg-white shadow-soft"
      style={{ width: page.width * scale, height: page.height * scale }}
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{
          width: page.width,
          height: page.height,
          transform: `scale(${scale})`,
        }}
      >
        {page.blocks.map((block, index) => (
          <PreviewBlock
            key={index}
            block={block}
            ascentRatio={ascentRatio}
            highlightedText={highlightedText}
          />
        ))}
      </div>
    </div>
  );
}

function PreviewBlock({
  block,
  ascentRatio,
  highlightedText,
}: {
  block: LayoutBlock;
  ascentRatio: number;
  highlightedText: string[];
}) {
  if (block.kind === 'FILL') {
    return (
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: `${block.x}pt`,
          top: `${block.y}pt`,
          width: `${block.width}pt`,
          height: `${block.height}pt`,
          background: block.color,
        }}
      />
    );
  }

  if (block.kind === 'RULE') {
    return (
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: `${block.x}pt`,
          top: `${block.y}pt`,
          width: `${block.width}pt`,
          // A 0.75pt rule would fall below one device pixel and vanish; the PDF
          // renderer has the same floor.
          height: `${Math.max(block.height, 0.5)}pt`,
          background: block.color,
        }}
      />
    );
  }

  const style: CSSProperties = {
        position: 'absolute',
        left: `${block.x}pt`,
        top: `${block.y - ascentRatio * block.size}pt`,
        fontFamily: FONT_STACK,
        fontSize: `${block.size}pt`,
        fontWeight: block.style === 'semibold' ? 600 : 400,
        lineHeight: 1,
        color: block.color,
        whiteSpace: 'pre',
      };
  const normalizedBlockText = normalizeHighlightText(block.text);
  const isHighlighted =
    normalizedBlockText.length >= 10 &&
    highlightedText.some((text) => {
      const normalizedText = normalizeHighlightText(text);
      return normalizedText.includes(normalizedBlockText) || normalizedBlockText.includes(normalizedText);
    });

  if (isHighlighted) {
    style.backgroundColor = 'rgba(212, 175, 55, 0.32)';
    style.boxShadow = '0 0 0 1.5pt rgba(212, 175, 55, 0.55)';
    style.borderRadius = '1pt';
  }

  if (block.href) {
    const label = block.text.replace(/^\s*·\s*/, '').trim();
    return (
      <a
        href={block.href}
        target={block.href.startsWith('mailto:') ? undefined : '_blank'}
        rel={block.href.startsWith('mailto:') ? undefined : 'noreferrer'}
        aria-label={`Open ${label}`}
        title={label}
        className="hover:underline focus:underline focus:outline-none"
        style={style}
      >
        {block.text}
      </a>
    );
  }

  return <span aria-hidden="true" style={style}>{block.text}</span>;
}

function normalizeHighlightText(text: string) {
  return text.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}
