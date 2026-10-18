/**
 * Font metrics and PDF rendering.
 *
 * This is the ONLY module in the release that imports `pdf-lib` or
 * `@pdf-lib/fontkit`. It is server-only by construction: it reads font files
 * from `node_modules`, and the editor bundle never reaches it — the preview
 * consumes the layout blocks over JSON instead.
 *
 * ── Why Inter, embedded from a TTF ─────────────────────────────────────────
 * Measured alternatives, recorded in docs/AUDIT_RESUME_BUILDER.md:
 *
 *   - pdf-lib's STANDARD fonts (Helvetica/Times/Courier) use WinAnsi encoding.
 *     `José`, `Müller`, `Ø Å æ ø` work; `Иван`, `Αλέξανδρος`, `東`, `🎯` throw
 *     `WinAnsi cannot encode`.
 *   - WOFF2 inputs (e.g. `@fontsource/*`) parse, but fontkit cannot detect the
 *     file type, the subsetter throws `RangeError`, and with subsetting off the
 *     extracted text comes back as `JJJJ` — the file renders but its text is NOT
 *     selectable, which defeats the point of exporting a PDF at all.
 *   - A real TTF subset on: 3 pages in ~80 ms, ~10 KB, and text extraction
 *     returns the original string exactly.
 *
 * Inter ships under the SIL Open Font License 1.1. Two weights only — Regular
 * and SemiBold — because three weights across three templates produced no
 * visible difference at these sizes, and every extra embedded weight is roughly
 * 180 KB in every downloaded file (see the subsetting note in `renderPdfLayout`).
 */

import fs from 'node:fs';
import { createRequire } from 'node:module';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { FontStyle, LayoutDocument, LayoutMetrics } from './layout';

// ─── Font files ─────────────────────────────────────────────────────────────

/**
 * Resolved at RUNTIME, through `createRequire`, with a variable specifier.
 *
 * This is deliberate and slightly awkward, so the reason is recorded here:
 *
 *  - A LITERAL `require.resolve('….ttf')` makes webpack create a module for
 *    the font file and try to parse it as JavaScript. The production build fails
 *    with `Module parse failed: Unexpected character`.
 *  - `serverExternalPackages` does not help: it externalises packages reached
 *    through `require`, not a deep file reached through `require.resolve`.
 *  - A variable specifier defeats static analysis, so the bundler emits a
 *    "Critical dependency" warning and leaves the binary alone. The build
 *    succeeds and the file is read from disk exactly where Node put it.
 *
 * The alternative was committing ~690 KB of TTF binaries to the repository to
 * silence one cosmetic warning. The warning is the cheaper trade, and the
 * behaviour it describes — the fonts are runtime assets, not modules — is what
 * we actually want.
 */
const FONT_SPECIFIERS: Record<FontStyle, string> = {
  regular: '@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf',
  semibold: '@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf',
};

const requireFromHere = createRequire(import.meta.url);

let fontBytesCache: Record<FontStyle, Uint8Array> | null = null;

/**
 * Read the TTF bytes once per process.
 *
 * Fonts are immutable for the life of a deployment, so re-reading them per
 * export would be pure waste on a warm lambda. The cache is module-scoped and
 * never mutated.
 */
function loadFontBytes(): Record<FontStyle, Uint8Array> {
  if (fontBytesCache) return fontBytesCache;

  const loaded = {} as Record<FontStyle, Uint8Array>;
  for (const style of ['regular', 'semibold'] as FontStyle[]) {
    loaded[style] = new Uint8Array(fs.readFileSync(requireFromHere.resolve(FONT_SPECIFIERS[style])));
  }
  fontBytesCache = loaded;
  return loaded;
}

/**
 * Measure and draw with the same font objects.
 *
 * `buildMetrics()` builds a throwaway `PDFDocument` and embeds the two fonts
 * into it — about 30 ms on a cold module, negligible after. Building a real
 * document per measurement would be wasteful; the alternative (a hand-rolled
 * metrics table) would eventually disagree with the font and produce a preview
 * that does not match the export, which is the one thing this architecture
 * exists to prevent.
 *
 * pdf-lib's font embedding is async, and the layout engine is sync (it must be
 * usable from a plain function, and testable without a document), so the fonts
 * are prepared once by `preparePdfEngine()` and then read synchronously. Every
 * caller of `getLayoutMetrics()` is already async and awaits the preparation
 * first; forgetting to is a loud, specific error rather than a blank page.
 */
let preparedMetrics: LayoutMetrics | null = null;
let preparation: Promise<LayoutMetrics> | null = null;

export class PdfEngineNotReadyError extends Error {
  readonly code = 'PDF_ENGINE_NOT_READY';

  constructor() {
    super('The PDF engine was used before it finished preparing.');
    this.name = 'PdfEngineNotReadyError';
  }
}

/**
 * Load and embed the fonts. Idempotent and safe to call concurrently.
 *
 * Called at the start of every route that lays out or renders a resume, so the
 * cold-start cost is paid once per container rather than once per request.
 */
export function preparePdfEngine(): Promise<LayoutMetrics> {
  if (!preparation) {
    preparation = PDFDocument.create()
      .then((doc) => buildMetrics(doc))
      .then((metrics) => {
        preparedMetrics = metrics;
        return metrics;
      })
      .catch((error) => {
        // A failed load must not poison the cache; the next request retries.
        preparation = null;
        preparedMetrics = null;
        throw error;
      });
  }
  return preparation;
}

export function getLayoutMetrics(): LayoutMetrics {
  if (!preparedMetrics) throw new PdfEngineNotReadyError();
  return preparedMetrics;
}

async function buildMetrics(doc: PDFDocument): Promise<LayoutMetrics> {
  doc.registerFontkit(fontkit);
  const bytes = loadFontBytes();

  // A 10pt size is the layout reference; widths scale linearly for a font with
  // no optical size axis, and pdf-lib's `widthOfTextAtSize` scales exactly.
  const REFERENCE_SIZE = 100;
  const fonts: Record<FontStyle, PDFFont> = {
    regular: await doc.embedFont(bytes.regular, { subset: false }),
    semibold: await doc.embedFont(bytes.semibold, { subset: false }),
  };

  // Inter has no optical-size axis, so the ascent scales linearly. Read from the
  // real font rather than hardcoded so the two weights cannot disagree.
  const ascentAt = (size: number) =>
    Math.max(
      fonts.regular.heightAtSize(size, { descender: false }),
      fonts.semibold.heightAtSize(size, { descender: false }),
    );

  const widths: Record<FontStyle, Map<string, number>> = {
    regular: new Map(),
    semibold: new Map(),
  };

  // Inter has no optical-size axis, so `widthOfTextAtSize(text, 100) / 100 *
  // size` is exact. Measured once and cached per string per style: the layout
  // engine measures the same strings repeatedly while wrapping.
  const cacheWidth = (text: string, style: FontStyle, size: number): number => {
    if (text.length === 0) return 0;
    let cache = widths[style];
    let base = cache.get(text);
    if (base === undefined) {
      base = fonts[style].widthOfTextAtSize(text, REFERENCE_SIZE);
      // Bound the cache so a pathological document cannot grow it without limit.
      if (cache.size > 20_000) cache.clear();
      cache.set(text, base);
    }
    return (base / REFERENCE_SIZE) * size;
  };

  // Coverage check against the real font, so an unrepresentable character is
  // reported rather than drawn as a blank box or silently dropped.
  const coverage: Record<FontStyle, Set<number>> = { regular: new Set(), semibold: new Set() };
  for (const style of ['regular', 'semibold'] as FontStyle[]) {
    for (const code of fonts[style].getCharacterSet()) coverage[style].add(code);
  }

  return {
    measure: (text, style, size) => cacheWidth(text, style, size),
    ascent: (size) => ascentAt(size),
    unsupportedCharacters(text) {
      const missing = new Set<string>();
      for (const char of text) {
        const code = char.codePointAt(0);
        if (code === undefined) continue;
        if (coverage.regular.has(code) || coverage.semibold.has(code)) continue;
        missing.add(char);
      }
      return Array.from(missing);
    },
  };
}

// ─── Rendering ──────────────────────────────────────────────────────────────

function toRgb(hex: string) {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((char) => char + char)
          .join('')
      : value;
  return rgb(
    parseInt(full.slice(0, 2), 16) / 255,
    parseInt(full.slice(2, 4), 16) / 255,
    parseInt(full.slice(4, 6), 16) / 255,
  );
}

export type RenderPdfResult = {
  bytes: Uint8Array;
  pageCount: number;
};

/**
 * Render a layout document to PDF bytes.
 *
 * The only transformation applied here is the single `pageHeight - y` flip from
 * the engine's top-left origin to PDF's bottom-left origin. Nothing else
 * touches the geometry, which is what keeps the export identical to the
 * preview.
 */
export async function renderPdfLayout(layout: LayoutDocument): Promise<RenderPdfResult> {
  // The layout was produced with these exact fonts; re-deriving them from the
  // layout object is impossible, so a missing preparation is a programming error.
  getLayoutMetrics();

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);

  // Metadata only — never resume content. A generated PDF is a personal
  // document, and its properties are readable by anyone who receives it.
  doc.setProducer('teChia Jobs');
  doc.setCreator('teChia Jobs');

  const bytes = loadFontBytes();
  // FULL FONT, NOT SUBSET — measured, and the reason is worth recording.
  //
  // pdf-lib's own subsetter (`@pdf-lib/fontkit` 1.x, the only version pdf-lib
  // can use) produces a font stream with correct metrics and a correct
  // ToUnicode map but DROPPED GLYPH OUTLINES: the text extracts perfectly with
  // `unpdf` while most renderers draw a sparse, mostly-blank page. Shipping
  // that would mean a resume that looks fine to a test and is unusable to the
  // person it was made for.
  //
  // Subsetting with fontkit 2.x and handing the result to pdf-lib was tried and
  // does not parse (`TTFFont.get` on a table the v2 subsetter omits).
  //
  // So: full faces, ~180 KB each, ~360 KB per PDF. That is a normal size for a
  // PDF, it is generated per request and streamed rather than stored, and it
  // is the only option measured to both render correctly and stay selectable.
  // Revisit if pdf-lib's subsetter is fixed; the decision is one flag away.
  const fonts: Record<FontStyle, PDFFont> = {
    regular: await doc.embedFont(bytes.regular, { subset: false }),
    semibold: await doc.embedFont(bytes.semibold, { subset: false }),
  };

  // Both of the following are computed from the layout's own `ascentRatio`
  // rather than re-measured here, so the export cannot disagree with the
  // geometry the preview was rendered from.
  const baselineOffset = (size: number) => layout.ascentRatio * size;

  for (const layoutPage of layout.pages) {
    const page: PDFPage = doc.addPage([layoutPage.width, layoutPage.height]);

    for (const block of layoutPage.blocks) {
      if (block.kind === 'TEXT') {
        if (block.text.length === 0) continue;
        page.drawText(block.text, {
          x: block.x,
          // Two transforms, both applied here and nowhere else:
          //   1. top-left → bottom-left origin
          //   2. line top → text baseline, using the engine's own ascent ratio
          y: layoutPage.height - block.y - baselineOffset(block.size),
          size: block.size,
          font: fonts[block.style],
          color: toRgb(block.color),
        });
        continue;
      }

      if (block.kind === 'RULE') {
        page.drawRectangle({
          x: block.x,
          y: layoutPage.height - block.y - block.height,
          width: block.width,
          height: block.height,
          color: toRgb(block.color),
        });
        continue;
      }

      page.drawRectangle({
        x: block.x,
        y: layoutPage.height - block.y - block.height,
        width: block.width,
        height: block.height,
        color: toRgb(block.color),
      });
    }
  }

  // Object streams OFF, deliberately.
  //
  // They would save a few kilobytes on a file that is almost entirely embedded
  // font, and cost something real: the catalog, page tree and font dictionaries
  // become invisible in the raw bytes. That matters because the security
  // guarantees here — no `/JavaScript`, no `/OpenAction`, no `/Launch` in a
  // document built from untrusted resume text — are asserted against the raw
  // file, and an assertion against compressed bytes proves nothing. An
  // inspectable export is also a better one to debug.
  const output = await doc.save({ useObjectStreams: false });
  return { bytes: output, pageCount: layout.pages.length };
}

/**
 * A safe download filename.
 *
 * Built from the server-known resume name only. Never from a client-supplied
 * header, never from a path, and stripped to characters that are legal in a
 * `Content-Disposition` filename on every platform.
 */
export function resumeDownloadFileName(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[^\w\s.-]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 80);
  const safe = base.length > 0 ? base : 'resume';
  return `${safe}.pdf`;
}