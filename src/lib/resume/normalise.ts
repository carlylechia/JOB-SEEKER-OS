/**
 * Conservative normalisation for resume text and extracted values.
 *
 * Two rules:
 *
 *  - NORMALISE, DON'T INVENT. `normalizeResumeDate('Since 2019')` returns
 *    `'2019'`, not `'2019-01-01'`. Precision the resume did not state is
 *    precision we do not have.
 *
 *  - THE MODEL IS NOT A WITNESS. `verifyEvidence` re-reads the actual resume
 *    text and downgrades any claim whose supporting snippet cannot actually be
 *    found there. A model that self-reports `SUPPORTED` for something the
 *    document never says gets corrected here, not in the UI.
 */

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

/** Tokens that mean "still there", not a date. */
const ONGOING_TOKENS = new Set([
  'present',
  'current',
  'currently',
  'now',
  'ongoing',
  'to present',
  'date',
  'todate',
]);

export const ONGOING_DATE = 'present';

const MIN_PLAUSIBLE_YEAR = 1940;

/**
 * Collapse runs of whitespace while keeping line structure.
 *
 * Section boundaries and ordering are the main signal a resume carries, so we
 * normalise *within* lines and between lines rather than flattening the whole
 * document into one string — which is what the previous extractor did, and why
 * it produced a 500-character "summary" that was really the top of the page.
 */
export function normalizeResumeText(raw: string): string {
  return raw
    // Normalise line endings and strip NUL/zero-width noise.
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n')
    // Collapse runs of 3+ blank lines to a single blank line, so section gaps
    // survive without padding the payload with whitespace.
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Prepare extracted text for the provider.
 *
 * Bounded by character count (not tokens) because that is the only limit we can
 * enforce before spending anything. Truncation is explicit so the model knows
 * the document continues rather than believing it saw everything.
 */
export function prepareTextForProvider(
  text: string,
  maxChars: number,
): { text: string; truncated: boolean; originalChars: number } {
  const originalChars = text.length;
  if (originalChars <= maxChars) return { text, truncated: false, originalChars };

  // Cut on a line boundary where possible so sections stay intact.
  let cut = text.slice(0, maxChars);
  const lastBreak = cut.lastIndexOf('\n');
  if (lastBreak > maxChars * 0.6) cut = cut.slice(0, lastBreak);

  return {
    text: `${cut}\n\n[Resume continues — truncated at ${maxChars} characters]`,
    truncated: true,
    originalChars,
  };
}

/** Rough "is this real prose" signal, used to detect image-only PDFs. */
export function countMeaningfulChars(text: string): number {
  return text.replace(/[^A-Za-z0-9]/g, '').length;
}

export function isOngoingDate(value: string | null | undefined): boolean {
  if (!value) return false;
  const key = value.toLowerCase().replace(/[\s._-]/g, '');
  return ONGOING_TOKENS.has(key) || ONGOING_TOKENS.has(value.toLowerCase().trim());
}

/**
 * Normalise a date as written on a resume into a canonical, partial form.
 *
 * Returns `'YYYY-MM'`, `'YYYY'`, `ONGOING_DATE`, or `null` when nothing usable
 * is present. Never fabricates a day, and never invents a month the resume did
 * not print.
 */
export function normalizeResumeDate(input: string | null | undefined, at: Date = new Date()): string | null {
  if (input === null || input === undefined) return null;

  const raw = String(input).replace(/[–—]/g, '-').trim();
  if (!raw) return null;
  if (isOngoingDate(raw)) return ONGOING_DATE;

  const maxYear = at.getUTCFullYear() + 1;

  const clampYear = (year: number): string | null =>
    year >= MIN_PLAUSIBLE_YEAR && year <= maxYear ? String(year) : null;

  // YYYY-MM-DD / YYYY/MM/DD
  let match = /^(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?$/.exec(raw);
  if (match) {
    const year = clampYear(Number(match[1]));
    const month = Number(match[2]);
    if (!year || month < 1 || month > 12) return null;
    return `${year}-${String(month).padStart(2, '0')}`;
  }

  // YYYY/MM or YYYY-MM (already canonical)
  match = /^(\d{4})[-/.](\d{1,2})$/.exec(raw);
  if (match) {
    const year = clampYear(Number(match[1]));
    const month = Number(match[2]);
    if (!year || month < 1 || month > 12) return null;
    return `${year}-${String(month).padStart(2, '0')}`;
  }

  // MM/YYYY (US order) — only when the first part cannot be a year.
  match = /^(\d{1,2})[-/.](\d{4})$/.exec(raw);
  if (match) {
    const month = Number(match[1]);
    const year = clampYear(Number(match[2]));
    if (!year || month < 1 || month > 12) return null;
    return `${year}-${String(month).padStart(2, '0')}`;
  }

  // "January 2020", "Jan 2020", "Jan. 2020"
  match = /^([a-z]{3,9})\.?\s+'?(\d{4})'?$/i.exec(raw);
  if (match) {
    const month = MONTHS[match[1].toLowerCase()];
    const year = clampYear(Number(match[2]));
    if (!year) return null;
    if (!month) return year;
    return `${year}-${String(month).padStart(2, '0')}`;
  }

  // "2020" anywhere, possibly with a prefix like "Since" / "Est."
  match = /\b(\d{4})\b/.exec(raw);
  if (match) return clampYear(Number(match[1]));

  return null;
}

/**
 * Order two partial dates. Undated entries sort last rather than pretending to
 * be ancient, because "unknown" is not "oldest".
 */
export function compareResumeDates(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (a === ONGOING_DATE) return 1;
  if (b === ONGOING_DATE) return -1;
  return a < b ? 1 : -1;
}

/**
 * Two date ranges that overlap or are out of order are a contradiction the
 * user should see, not something we silently average away.
 */
export function detectDateConflict(
  start: string | null,
  end: string | null,
): string | null {
  if (!start || !end) return null;
  if (start === ONGOING_DATE) return 'Start date is marked as ongoing.';
  if (end === ONGOING_DATE) return null;
  return start > end ? `Start date (${start}) is after end date (${end}).` : null;
}

/** Canonical comparison key: lowercase, punctuation-free, collapsed. */
export function normalizeForCompare(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, ' ')
    .trim();
}

export function looseEquals(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return normalizeForCompare(a) === normalizeForCompare(b);
}

/**
 * Only `http`/`https` survive. The model reads a URL out of untrusted text, so
 * this is the boundary that stops `javascript:`, `data:` and `file:` URLs from
 * ever reaching the database or an `href`.
 */
export function sanitizeExtractedUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = String(input).trim();
  if (!raw) return null;

  // Models sometimes echo a bare domain; that is not a usable link.
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;

  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname || !url.hostname.includes('.')) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Does this snippet actually appear in the resume?
 *
 * Compares on a punctuation-free, whitespace-collapsed form so line wrapping and
 * bullet glyphs do not cause false negatives. Short snippets are not verified —
 * a three-character "evidence" match proves nothing.
 */
export function snippetAppearsIn(snippet: string, resumeText: string): boolean {
  const needle = normalizeForCompare(snippet);
  if (needle.length < 12) return false;
  return normalizeForCompare(resumeText).includes(needle);
}

/**
 * Re-derive an evidence level from the document itself.
 *
 * Rules:
 *  - A verbatim snippet we can find is `SUPPORTED`.
 *  - A snippet we cannot find is `NEEDS_REVIEW`, whatever the model claimed.
 *    We do not know whether the model paraphrased or invented it, and the user
 *    does not either.
 *  - Without a snippet, only an explicit `INFERRED`/`SUGGESTED` claim may stay
 *    below `SUPPORTED`; anything asserted with no snippet and no reason to
 *    doubt it is still marked `NEEDS_REVIEW`, because absence of evidence is
 *    not evidence.
 */
export function verifyEvidence<T extends { snippet: string | null; level: string }>(
  evidence: T,
  resumeText: string,
): T {
  if (!evidence.snippet) {
    return evidence.level === 'SUGGESTED' || evidence.level === 'NEEDS_REVIEW'
      ? evidence
      : { ...evidence, level: 'NEEDS_REVIEW' as const };
  }

  if (snippetAppearsIn(evidence.snippet, resumeText)) {
    return evidence.level === 'SUGGESTED'
      ? { ...evidence, level: 'NEEDS_REVIEW' as const }
      : evidence;
  }

  return { ...evidence, level: 'NEEDS_REVIEW' as const };
}

/** Trailing/leading whitespace removal for every string in a flat record. */
export function trimOrNull(value: unknown, max = 1200): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/** Drop empty strings, de-duplicate case-insensitively, preserve first-seen order. */
export function dedupeStrings(values: readonly unknown[], maxItems = 60): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
    if (!text) continue;
    const key = normalizeForCompare(text);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
}