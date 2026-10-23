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
 * and SemiBold — because three weights across four templates produced no
 * visible difference at these sizes, and every extra embedded weight is roughly
 * 180 KB in every downloaded file (see the subsetting note in `renderPdfLayout`).
 */

import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { FontStyle, LayoutDocument, LayoutMetrics } from './layout';

// ─── Font files ─────────────────────────────────────────────────────────────

/**
 * The two Inter weights live IN THIS REPOSITORY, at
 * `src/lib/resume-builder/fonts/`. Read them from the filesystem; see below for
 * why they are not resolved out of `node_modules` any more.
 *
 * Both are SIL Open Font License 1.1; the licence travels with them in
 * `fonts/LICENSE.txt`, which the OFL requires.
 */
const FONT_FILES: Record<FontStyle, string> = {
  regular: 'Inter_400Regular.ttf',
  semibold: 'Inter_600SemiBold.ttf',
};

/**
 * Why a vendored file rather than `@expo-google-fonts/inter`.
 *
 * The fonts used to be fetched with `createRequire(import.meta.url).resolve()`
 * and a variable specifier, on the reasoning that an unanalysable request would
 * be left alone by the bundler and read off disk at runtime. That reasoning was
 * wrong, and the export was broken in every built deployment while passing
 * tests:
 *
 *  - Under `tsx` the specifier really did resolve, so every test passed.
 *  - Under webpack the `createRequire` import was replaced with a stub whose
 *    `resolve()` unconditionally throws `MODULE_NOT_FOUND`, and whose `keys()`
 *    returns `[]` — the empty context module for a request it could not
 *    analyse. The only symptom was the build's "Critical dependency" warning,
 *    which the release notes recorded as cosmetic. It was the bug.
 *  - Making the specifier LITERAL instead does not help either. It defeats the
 *    warning but webpack then creates a module for the `.ttf` and tries to parse
 *    it as JavaScript, and the production build fails with `Module parse failed:
 *    Unexpected character`. Verified, not assumed.
 *
 * A literal `fs.readFileSync` of a file in the source tree is something the
 * bundler and the Vercel file tracer CAN see, which is the property the previous
 * approach lacked. `tests/resume-pdf.test.ts` guards the shape of this module so
 * the stub pattern cannot be reintroduced.
 *
 * Resolved from `process.cwd()`, which is the deployment root for `next start`
 * and for Vercel's Node runtime, and the project root under `tsx`. The error
 * below lists what was tried rather than surfacing a bare ENOENT, because the
 * failure mode this replaces was one that only appeared in production.
 */
const FONT_DIR = path.join(process.cwd(), 'src', 'lib', 'resume-builder', 'fonts');

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
  const missing: string[] = [];

  for (const style of ['regular', 'semibold'] as FontStyle[]) {
    const file = path.join(FONT_DIR, FONT_FILES[style]);
    try {
      loaded[style] = new Uint8Array(fs.readFileSync(file));
    } catch {
      missing.push(file);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `PDF export could not load its font files from ${FONT_DIR}. ` +
        `Missing: ${missing.join(', ')}. ` +
        'These ship in the repository; a missing file means the deployment did ' +
        'not include them.',
    );
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
        const uri = safeContactUri(block.href);
        if (uri) {
          const baseline = layoutPage.height - block.y - baselineOffset(block.size);
          const annotation = doc.context.obj({
            Type: 'Annot',
            Subtype: 'Link',
            Rect: [block.x, baseline - block.size * 0.3, block.x + block.width, baseline + block.size * 0.9],
            Border: [0, 0, 0],
            A: { Type: 'Action', S: 'URI', URI: uri },
          });
          page.node.addAnnot(doc.context.register(annotation));
        }
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
  // Count pages from the serialized PDF's page tree, not from the layout plan.
  // This is the value one-page generation and export routes rely on.
  const serialized = await PDFDocument.load(output);
  const pageCount = serialized.getPageCount();
  if (pageCount !== layout.pages.length) {
    throw new Error('The rendered PDF page tree does not match the document layout.');
  }
  return { bytes: output, pageCount };
}

function safeContactUri(value?: string): string | null {
  if (!value || /[\r\n\u0000]/.test(value)) return null;
  if (value.startsWith('mailto:')) {
    const address = value.slice('mailto:'.length);
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) ? value : null;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
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
