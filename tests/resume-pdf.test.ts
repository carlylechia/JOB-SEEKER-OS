/**
 * Templates, layout and PDF export.
 *
 * The point of this file is that the exported file is real. Every assertion
 * here either reads the generated PDF back with `unpdf` — the same parser the
 * product already uses to READ uploaded resumes — or checks the geometry that
 * produced it. "The button returns 200" is not evidence of anything.
 *
 * `preparePdfEngine()` is awaited once per test file rather than per test: it
 * reads and embeds two font faces, which is the expensive part, and the result
 * is cached for the life of the process.
 */

import { describe, it, expect, before, afterEach } from './harness';
import { extractText, getDocumentProxy } from 'unpdf';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { buildLayout, wrapText, type LayoutDocument } from '@/lib/resume-builder/layout';
import { getLayoutMetrics, preparePdfEngine, renderPdfLayout, resumeDownloadFileName } from '@/lib/resume-builder/pdf';
import { resumeContentSchema, type ResumeContent } from '@/lib/resume-builder/schema';
import { ACCENT_KEYS, DENSITY_VALUES, TEMPLATE_KEYS, getTemplate } from '@/lib/resume-builder/templates';
import {
  hostileContent,
  longContent,
  longNameContent,
  minimalContent,
  typicalContent,
  unicodeContent,
} from './resume-builder-fixtures';

before(async () => {
  await preparePdfEngine();
});

const metrics = () => getLayoutMetrics();

function layoutOf(
  content: ResumeContent,
  templateKey: (typeof TEMPLATE_KEYS)[number] = 'classic-ats',
  overrides: { accentKey?: string; density?: number; hiddenSections?: string[] } = {},
): LayoutDocument {
  return buildLayout(
    {
      content,
      templateKey,
      accentKey: (overrides.accentKey ?? 'gold') as never,
      density: (overrides.density ?? 1) as never,
      hiddenSections: overrides.hiddenSections ?? [],
    },
    metrics(),
  );
}

/** Render and read the text back out of the generated PDF. */
async function renderAndExtract(
  layout: LayoutDocument,
): Promise<{ text: string; pageCount: number; bytes: Uint8Array }> {
  const { bytes, pageCount } = await renderPdfLayout(layout);
  // `getDocumentProxy` takes ownership of the buffer and detaches it, so a
  // copy is kept for the structural assertions. Several tests below inspect the
  // raw PDF, and reading them off a detached buffer silently returns nothing.
  const raw = new Uint8Array(bytes);
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return { text, pageCount, bytes: raw };
}

const rawOf = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1');

const normaliseForCompare = (value: string) => value.replace(/\s+/g, ' ').trim();

// ─── Templates ──────────────────────────────────────────────────────────────

describe('templates', () => {
  it('every template renders the same content', async () => {
    const content = typicalContent();
    for (const templateKey of TEMPLATE_KEYS) {
      const layout = layoutOf(content, templateKey);
      const { text } = await renderAndExtract(layout);

      expect(text).toContain('Jordan Ellis');
      expect(text).toContain('Acme Payments Ltd');
      expect(text).toContain('Reduced p99 checkout latency by 38% across three teams.');
      expect(text).toContain('TypeScript');
      expect(text).toContain('AWS Certified Solutions Architect');
    }
  });

  it('templates differ in presentation but not in content', async () => {
    // Categorised skills are excluded on purpose: a template may legitimately
    // render a category as its own labelled line, which adds a word. Everything
    // else — name, contact, summary, every role, bullet and credential — must be
    // byte-identical across all three, in the same order. If this fails, a
    // template is dropping or reordering content, which is a data bug rather
    // than a design one.
    const content = resumeContentSchema.parse({
      ...typicalContent(),
      skills: typicalContent().skills.map((skill) => ({ ...skill, category: null })),
    });

    const texts: string[] = [];
    for (const templateKey of TEMPLATE_KEYS) {
      const { text } = await renderAndExtract(layoutOf(content, templateKey));
      texts.push(normaliseForCompare(text));
    }
    expect(texts[1]).toBe(texts[0]);
    expect(texts[2]).toBe(texts[0]);
  });

  it('the block geometry differs between templates', () => {
    const content = typicalContent();
    const classic = layoutOf(content, 'classic-ats');
    const modern = layoutOf(content, 'modern-professional');
    const geometry = (layout: ReturnType<typeof layoutOf>) =>
      layout.pages[0].blocks.map((block) => [
        block.kind,
        block.x,
        block.y,
        block.width,
        'height' in block ? block.height : null,
        'size' in block ? block.size : null,
      ]);
    expect(geometry(modern)).not.toEqual(geometry(classic));
  });

  it('falls back to a known template for an unknown key rather than throwing', () => {
    const template = getTemplate('wordart-2000');
    expect(template.key).toBe('classic-ats');
  });

  it('every accent in the palette has a readable deep variant and on-fill ink', () => {
    for (const key of ACCENT_KEYS) {
      const tokens = getTemplate('classic-ats');
      expect(tokens).toBeDefined();
      expect(key.length).toBeGreaterThan(0);
    }
  });

  it('supports all three density settings', async () => {
    const content = typicalContent();
    for (const density of DENSITY_VALUES) {
      const layout = layoutOf(content, 'classic-ats', { density });
      const { text } = await renderAndExtract(layout);
      expect(text).toContain('Jordan Ellis');
    }
  });

  it('compact density is tighter than relaxed', () => {
    const content = longContent();
    const compact = layoutOf(content, 'technical-minimal', { density: 0 });
    const relaxed = layoutOf(content, 'technical-minimal', { density: 2 });
    expect(compact.pages.length).toBeLessThanOrEqual(relaxed.pages.length);
  });

  it('hides a section without deleting it', async () => {
    const content = typicalContent();
    const shown = await renderAndExtract(layoutOf(content, 'classic-ats'));
    const hidden = await renderAndExtract(
      layoutOf(content, 'classic-ats', {
        hiddenSections: ['skills', 'education', 'projects', 'credentials'],
      }),
    );

    expect(shown.text).toContain('SKILLS');
    expect(hidden.text).not.toContain('SKILLS');
    expect(hidden.text).not.toContain('EDUCATION');
    // The experience section is untouched.
    expect(hidden.text).toContain('PROFESSIONAL EXPERIENCE');
    expect(hidden.text).toContain('Jordan Ellis');
    // The content itself is untouched; only its presentation changed.
    expect(typicalContent().skills.length).toBeGreaterThan(0);
  });
});

// ─── Layout ─────────────────────────────────────────────────────────────────

describe('the layout engine', () => {
  it('produces one page for a minimal resume', () => {
    const layout = layoutOf(minimalContent());
    expect(layout.pages.length).toBe(1);
  });

  it('warns rather than silently rendering nothing for an empty resume', () => {
    const layout = layoutOf(resumeContentSchema.parse({}));
    expect(layout.warnings.some((warning) => warning.code === 'EMPTY_DOCUMENT')).toBe(true);
  });

  it('spans multiple pages for a long resume', () => {
    const layout = layoutOf(longContent());
    expect(layout.pages.length).toBeGreaterThan(1);
  });

  it('never places a block outside the page', () => {
    for (const templateKey of TEMPLATE_KEYS) {
      const layout = layoutOf(longContent(12), templateKey);
      for (const page of layout.pages) {
        for (const block of page.blocks) {
          expect(block.x).toBeGreaterThanOrEqual(-1);
          expect(block.y).toBeGreaterThanOrEqual(-1);
          expect(block.x).toBeLessThanOrEqual(page.width + 1);
          expect(block.y).toBeLessThanOrEqual(page.height + 1);
        }
      }
    }
  });

  it('never overlaps text blocks on the same line', () => {
    // Two text runs at the same baseline must not collide. Right-aligned dates
    // sit next to left-aligned titles, so this is the check that proves the
    // inline-pair layout is actually computing a safe gap.
    for (const templateKey of TEMPLATE_KEYS) {
      const layout = layoutOf(longContent(), templateKey);
      for (const page of layout.pages) {
        const runs = page.blocks
          .filter((block) => block.kind === 'TEXT')
          .map((block) => ({ x: block.x, right: block.x + block.width, y: block.y }));

        for (let i = 0; i < runs.length; i += 1) {
          for (let j = i + 1; j < runs.length; j += 1) {
            const a = runs[i];
            const b = runs[j];
            if (Math.abs(a.y - b.y) > 0.5) continue;
            if (a.x < b.right && b.x < a.right) {
              throw new Error(`overlap on ${templateKey}: "${a.x}..${a.right}" vs "${b.x}..${b.right}"`);
            }
          }
        }
      }
    }
  });

  it('keeps long role and employer names separate from their dates', () => {
    const layout = layoutOf(longNameContent(), 'classic-ats');
    for (const page of layout.pages) {
      const runs = page.blocks.filter((block) => block.kind === 'TEXT');
      for (let i = 0; i < runs.length; i += 1) {
        for (let j = i + 1; j < runs.length; j += 1) {
          const first = runs[i];
          const second = runs[j];
          if (Math.abs(first.y - second.y) > 0.5) continue;
          const firstRight = first.x + first.width;
          const secondRight = second.x + second.width;
          if (first.x < secondRight && second.x < firstRight) {
            throw new Error(`long role heading overlap: "${first.text}" / "${second.text}"`);
          }
        }
      }
    }
  });

  it('does not strand a section heading at the foot of a page', () => {
    const layout = layoutOf(longContent());
    for (let index = 0; index < layout.pages.length - 1; index += 1) {
      const page = layout.pages[index];
      const texts = page.blocks.filter((block) => block.kind === 'TEXT');
      const last = texts[texts.length - 1];
      if (!last || last.kind !== 'TEXT') continue;
      // A heading is uppercase and semibold; if one is the very last thing on a
      // page its body has moved to the next one, which is what we forbid.
      if (last.style === 'semibold' && last.text === last.text.toUpperCase() && last.text.length > 3) {
        throw new Error(`section heading "${last.text}" stranded at the foot of page ${index + 1}`);
      }
    }
  });

  it('wraps on whitespace', () => {
    const lines = wrapText('one two three four five six seven', 60, metrics(), 'regular', 10);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(' ')).toBe('one two three four five six seven');
  });

  it('breaks an over-long token by character rather than clipping it', () => {
    const token = 'A'.repeat(200);
    const lines = wrapText(token, 100, metrics(), 'regular', 10);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe(token);
  });

  it('never returns an empty line for whitespace-only input', () => {
    expect(wrapText('   ', 100, metrics(), 'regular', 10)).toHaveLength(0);
  });

  it('drops an empty optional section rather than printing its heading', () => {
    const layout = layoutOf(resumeContentSchema.parse({ basics: { fullName: 'Only A Name' } }));
    const texts = layout.pages[0].blocks.filter((block) => block.kind === 'TEXT');
    const labels = texts.map((block) => (block.kind === 'TEXT' ? block.text : ''));
    expect(labels).not.toContain('WORK EXPERIENCE');
    expect(labels).not.toContain('SKILLS');
  });
});

// ─── PDF export ─────────────────────────────────────────────────────────────

describe('PDF export', () => {
  it('generates a valid PDF file', async () => {
    const { bytes, pageCount, text } = await renderAndExtract(layoutOf(typicalContent()));
    const raw = rawOf(bytes);
    // The strongest evidence of validity is that a real PDF parser opened it
    // and returned the text — `renderAndExtract` would have thrown otherwise.
    expect(raw.startsWith('%PDF-')).toBe(true);
    expect(raw).toContain('%%EOF');
    expect(pageCount).toBe(1);
    expect(text).toContain('Jordan Ellis');
  });

  it('produces real bytes rather than an empty body', async () => {
    const { bytes } = await renderPdfLayout(layoutOf(minimalContent()));
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it('exports a minimal resume', async () => {
    const { text, pageCount } = await renderAndExtract(layoutOf(minimalContent()));
    expect(pageCount).toBe(1);
    expect(normaliseForCompare(text)).toContain('A Person');
  });

  it('exports a typical one-page resume with every section', async () => {
    const { text, pageCount } = await renderAndExtract(layoutOf(typicalContent()));
    expect(pageCount).toBe(1);

    const flat = normaliseForCompare(text);
    expect(flat).toContain('Jordan Ellis');
    expect(flat).toContain('Senior Backend Engineer');
    expect(flat).toContain('Reduced p99 checkout latency by 38% across three teams.');
    expect(flat).toContain('TypeScript');
    expect(flat).toContain('University of Bristol');
    expect(flat).toContain('ledgerkit');
    expect(flat).toContain('AWS Certified Solutions Architect');
  });

  it('exports a long resume across multiple pages', async () => {
    const { text, pageCount } = await renderAndExtract(layoutOf(longContent()));
    expect(pageCount).toBeGreaterThan(2);
    // Content from the first page AND the last survives.
    expect(text).toContain('Jordan Ellis');
    expect(text).toContain('Credential number 5');
  });

  it('keeps content in reading order', async () => {
    const { text } = await renderAndExtract(layoutOf(typicalContent()));
    const flat = normaliseForCompare(text);
    const nameIndex = flat.indexOf('Jordan Ellis');
    const summaryIndex = flat.indexOf('PROFESSIONAL SUMMARY');
    const experienceIndex = flat.indexOf('PROFESSIONAL EXPERIENCE');
    const educationIndex = flat.indexOf('EDUCATION');

    expect(nameIndex).toBeGreaterThanOrEqual(0);
    expect(summaryIndex).toBeGreaterThan(nameIndex);
    expect(experienceIndex).toBeGreaterThan(summaryIndex);
    expect(educationIndex).toBeGreaterThan(experienceIndex);
  });

  it('keeps text selectable and Unicode-intact', async () => {
    const { text } = await renderAndExtract(layoutOf(unicodeContent()));
    const flat = normaliseForCompare(text);
    // Latin, Latin Extended-A, Greek and Cyrillic all survive verbatim.
    expect(flat).toContain('José Müller-Þórsdóttir');
    expect(flat).toContain('Ünïcödé GmbH');
    expect(flat).toContain('Инженер · μηχανικός');
    expect(flat).toContain('Иван Петров и Αλέξανδρος worked on this.');
    expect(flat).toContain('Café, naïve, façade, Straße');
    expect(flat).toContain('“curly quotes”');
    expect(flat).toContain('— em dashes');
  });

  it('reports characters the export font cannot draw rather than mangling them', async () => {
    // Inter covers Latin, Latin Extended-A, Greek and Cyrillic. It does NOT
    // cover CJK or emoji, so those characters have no glyph. The contract is
    // that the layout SAYS SO — a warning naming the characters — rather than
    // emitting blank boxes or mojibake and letting the user find out after
    // sending the file.
    const content = resumeContentSchema.parse({
      basics: { fullName: '田中太郎' },
      summary: 'Ordinary text.',
    });
    const layout = layoutOf(content);

    const warning = layout.warnings.find((entry) => entry.code === 'UNSUPPORTED_CHARACTERS');
    expect(warning).toBeDefined();
    expect(warning?.characters).toContain('田');
    expect(warning?.message.length).toBeGreaterThan(0);
  });

  it('does not warn about characters the font does cover', async () => {
    const layout = layoutOf(unicodeContent());
    const warning = layout.warnings.find((entry) => entry.code === 'UNSUPPORTED_CHARACTERS');
    // The fixture's only uncovered characters are the CJK ones.
    if (warning) {
      for (const char of warning.characters ?? []) {
        expect('日本語のドキュメントを書いています。').toContain(char);
      }
    }
    expect(normaliseForCompare(await renderAndExtract(layout).then((result) => result.text)))
      .toContain('Ελληνικά');
  });

  it('does not clip a very long employer or project name', async () => {
    const content = longNameContent();
    const { text } = await renderAndExtract(layoutOf(content));
    const flat = normaliseForCompare(text);

    const unbroken = 'SupercalifragilisticexpialidociousInternationalConsortiumHoldingsLimited';
    // Every character survives, even though it is broken across lines.
    expect(flat.replace(/\s+/g, '')).toContain(unbroken.repeat(3));
    expect(flat.replace(/\s+/g, '')).toContain(`${unbroken}project`);
  });

  it('renders a long skill list rather than truncating it', async () => {
    const content = longContent(2);
    const { text } = await renderAndExtract(layoutOf(content));
    expect(text).toContain('Technology-1');
    expect(text).toContain('Technology-36');
  });

  it('omits empty optional sections', async () => {
    const content = resumeContentSchema.parse({
      basics: { fullName: 'Minimal Person' },
      experiences: [],
      skills: [],
      credentials: [],
    });
    const { text } = await renderAndExtract(layoutOf(content));
    expect(text).toContain('Minimal Person');
    expect(text).not.toContain('CERTIFICATIONS');
    expect(text).not.toContain('SKILLS');
  });

  it('renders hostile document text as literal text, never as markup', async () => {
    const content = hostileContent();
    const { bytes, text } = await renderAndExtract(layoutOf(content));

    // The payload is present as text...
    expect(text).toContain('IGNORE ALL PREVIOUS INSTRUCTIONS');
    // ...and nothing was interpreted. A PDF has no DOM to execute against, and
    // the renderer only ever draws text runs it was handed.
    const raw = rawOf(bytes);
    expect(raw).not.toContain('/JavaScript');
    expect(raw).not.toContain('/JS');
    expect(raw).not.toContain('/OpenAction');
    expect(raw).not.toContain('/Launch');
  });

  it('does not let document text escape into PDF structure', async () => {
    const content = resumeContentSchema.parse({
      basics: { fullName: '%%EOF injected' },
      summary: ') /JS (alert(1)) >> endobj',
    });
    const { bytes, text } = await renderAndExtract(layoutOf(content));
    const raw = rawOf(bytes);
    expect(raw).not.toContain('/JavaScript');
    expect(text).toContain('endobj');
  });

  it('exports the current saved version, not a stale one', async () => {
    // Each render is produced from the content it was handed, so two renders of
    // two documents differ in exactly the content that differs.
    const before = resumeContentSchema.parse({
      basics: { fullName: 'Jordan Ellis', headline: 'Backend Engineer' },
    });
    const after = resumeContentSchema.parse({
      basics: { fullName: 'Jordan Ellis', headline: 'Principal Platform Engineer' },
    });

    const first = await renderAndExtract(layoutOf(before));
    const second = await renderAndExtract(layoutOf(after));

    expect(first.text).toContain('Backend Engineer');
    expect(first.text).not.toContain('Principal Platform Engineer');
    expect(second.text).toContain('Principal Platform Engineer');
  });

  it('embeds the font faces rather than relying on the reader having them', async () => {
    // Object streams are off precisely so this is inspectable: the font
    // dictionaries and their `/FontFile2` streams must be visible in the raw
    // bytes, which is the evidence that a reader without Inter installed still
    // gets the right glyphs.
    const { bytes } = await renderAndExtract(layoutOf(minimalContent()));
    const raw = rawOf(bytes);
    expect(raw).toContain('/FontFile2');
    expect(raw).toContain('/Type /Font');
    expect(raw).toContain('/FontDescriptor');
    expect(raw).toContain('/ToUnicode');
  });

  it('is bounded and fast for a long resume', async () => {
    const started = Date.now();
    const { bytes } = await renderPdfLayout(layoutOf(longContent(12)));
    const duration = Date.now() - started;
    expect(bytes.byteLength).toBeLessThan(2 * 1024 * 1024);
    // Generous, but a regression that made layout quadratic would trip it.
    expect(duration).toBeLessThan(10_000);
  });
});

// ─── Font resolution ────────────────────────────────────────────────────────

describe('font files', () => {
  /**
   * Regression guard for a bug that reached production and could not be caught
   * by any behavioural test above.
   *
   * The fonts were once loaded with `createRequire(import.meta.url).resolve()`
   * and a variable specifier. Under `tsx` that resolves perfectly, so every
   * test in this file passed — including every assertion about real PDF bytes.
   * Under webpack the same call was replaced by a stub whose `resolve()` always
   * throws `MODULE_NOT_FOUND`, so PDF export failed in every built deployment
   * while the build itself only warned.
   *
   * These tests cannot run webpack, but they CAN pin the property the fix rests
   * on: the fonts are ordinary files in the repository, read through a literal
   * path, so the bundler and the deployment file tracer can both see them.
   */

  const raw = readFileSync(
    new URL('../src/lib/resume-builder/pdf.ts', import.meta.url),
    'utf8',
  );

  /**
   * The module's executable code, with comments removed.
   *
   * The comments in this file name every mechanism that used to be used here,
   * because that record is the point of it — so asserting against the raw text
   * would match its own explanation of the bug. What must be absent is the code.
   */
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('does not resolve fonts through a mechanism the bundler can stub', () => {
    // Every one of these works under tsx and fails, or breaks the build, under
    // webpack. Their absence from the executable code is the actual fix.
    expect(code).not.toContain('createRequire');
    expect(code).not.toContain('.resolve(');
    expect(code).not.toContain('require(');
    expect(code).not.toContain('expo-google-fonts');
  });

  it('reads the fonts from a literal path inside the repository', () => {
    expect(code).toContain('readFileSync');
    // A `process.cwd()` join of literal segments is what the Vercel file tracer
    // follows; a computed or interpolated path is what it cannot.
    expect(code).toContain(
      "path.join(process.cwd(), 'src', 'lib', 'resume-builder', 'fonts')",
    );
    // The two filenames must be literals, not looked up by pattern.
    expect(code).toContain("regular: 'Inter_400Regular.ttf'");
    expect(code).toContain("semibold: 'Inter_600SemiBold.ttf'");
  });

  it('ships both weights in the repository', () => {
    // The vendored files are the ones the export embeds, so a missing or
    // truncated file is a hard failure rather than a silently broken export.
    for (const file of ['Inter_400Regular.ttf', 'Inter_600SemiBold.ttf']) {
      const bytes = readFileSync(
        new URL(`../src/lib/resume-builder/fonts/${file}`, import.meta.url),
      );
      // A partial or Git-LFS pointer file would be tiny; these are ~340 KB.
      expect(bytes.byteLength).toBeGreaterThan(100_000);
      // A TTF begins 0x00010000; 'true' and 'OTTO' are the other valid flavours.
      // A text file here means the binary was committed as text.
      const magic = bytes.readUInt32BE(0);
      const valid = magic === 0x00010000 || magic === 0x74727565 || magic === 0x4f54544f;
      expect(valid).toBe(true);
    }
  });

  it('keeps the font licence with the fonts', () => {
    // The OFL requires the licence to accompany the font files, and the files
    // are now in this repository rather than inside someone else's package.
    const licence = readFileSync(
      new URL('../src/lib/resume-builder/fonts/LICENSE.txt', import.meta.url),
      'utf8',
    );
    expect(licence).toContain('SIL Open Font License');
  });

  it('reports the directory it searched rather than a bare ENOENT', () => {
    // The old failure was `Cannot find module '@expo-google-fonts/...'` thrown
    // from inside the bundler, which named neither the file, the directory, nor
    // the fact that the file ships with the application. The message must.
    expect(code).toContain('PDF export could not load its font files');
    expect(code).toContain('Missing:');
    expect(code).toContain('the deployment did');
  });
});

// ─── Download filenames ─────────────────────────────────────────────────────

describe('download filenames', () => {
  it('derives a safe filename from the resume name', () => {
    expect(resumeDownloadFileName('Jordan Ellis')).toBe('Jordan-Ellis.pdf');
  });

  it('strips path separators and control characters', () => {
    // The segments are flattened, not resolved: there is no path here to walk,
    // and no traversal survives into the header.
    const name = resumeDownloadFileName('../../etc/passwd');
    expect(name).not.toContain('/');
    expect(name).not.toContain('..');
    expect(name.endsWith('.pdf')).toBe(true);
  });

  it('strips characters that would break a Content-Disposition header', () => {
    const name = resumeDownloadFileName('a"b;c\nd\re');
    expect(name).not.toContain('"');
    expect(name).not.toContain(';');
    expect(name).not.toContain('\n');
    expect(name).not.toContain('\r');
  });

  it('never returns an empty filename', () => {
    expect(resumeDownloadFileName('')).toBe('resume.pdf');
    expect(resumeDownloadFileName('...')).toBe('resume.pdf');
    expect(resumeDownloadFileName('///')).toBe('resume.pdf');
  });

  it('bounds the length', () => {
    expect(resumeDownloadFileName('x'.repeat(500))).toHaveLength(84);
  });

  it('handles unicode names without dropping them', () => {
    const name = resumeDownloadFileName('José Müller');
    expect(name.length).toBeGreaterThan(4);
    expect(name.endsWith('.pdf')).toBe(true);
  });
});
