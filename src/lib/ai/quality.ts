/**
 * Deterministic quality checks for generated text.
 *
 * These are deliberately NOT an AI evaluation. They catch the failure modes
 * that are mechanically provable and cheap to detect:
 *
 *   - empty output,
 *   - template placeholders a model forgot to replace,
 *   - corrupted characters,
 *   - the same sentence repeated to pad length,
 *   - output far outside the requested size.
 *
 * A clean report is not a claim that the text is good, truthful or appropriate.
 * Factual verification stays with each feature's existing evidence checks.
 */

export type QualityIssueCode =
  | 'EMPTY'
  | 'PLACEHOLDER'
  | 'CORRUPT_TEXT'
  | 'TOO_SHORT'
  | 'TOO_LONG'
  | 'REPEATED_SENTENCE';

export type QualityIssue = {
  code: QualityIssueCode;
  severity: 'ERROR' | 'WARNING';
  message: string;
};

export type QualityReport = {
  ok: boolean;
  wordCount: number;
  characterCount: number;
  issues: QualityIssue[];
};

export type QualityOptions = {
  /** Below this, warn. Set 0 to disable. Defaults to 80 characters. */
  minChars?: number;
  /** Above this, error. Defaults to 20,000 characters. */
  maxChars?: number;
};

const PLACEHOLDER_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\[(?:insert|your|add|company|role|name)\b[^\]]*\]/gi, label: 'bracketed placeholder' },
  { pattern: /\{\{[^}]*\}\}/g, label: 'double-brace template token' },
  { pattern: /\{[a-z][a-z0-9_.-]{0,40}\}/gi, label: 'template token' },
  { pattern: /<insert[^>]*>/gi, label: 'angle-bracket placeholder' },
  { pattern: /\blorem ipsum\b/gi, label: 'lorem ipsum filler' },
  { pattern: /\b(?:TODO|TBD|XXX)\b/g, label: 'unfinished marker' },
  { pattern: /\bplaceholder\b/gi, label: 'the word "placeholder"' },
];

function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function repeatedSentence(text: string): string | null {
  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim().toLowerCase().replace(/\s+/g, ' '))
    .filter((sentence) => sentence.length >= 40);

  const counts = new Map<string, number>();
  for (const sentence of sentences) {
    const next = (counts.get(sentence) ?? 0) + 1;
    counts.set(sentence, next);
    if (next >= 3) return sentence.slice(0, 120);
  }
  return null;
}

export function assessGeneratedText(text: string, options: QualityOptions = {}): QualityReport {
  const minChars = options.minChars ?? 80;
  const maxChars = options.maxChars ?? 20_000;
  const characterCount = text.length;
  const issues: QualityIssue[] = [];

  if (!text.trim()) {
    return {
      ok: false,
      wordCount: 0,
      characterCount,
      issues: [{ code: 'EMPTY', severity: 'ERROR', message: 'The generated text is empty.' }],
    };
  }

  if (minChars > 0 && text.trim().length < minChars) {
    issues.push({
      code: 'TOO_SHORT',
      severity: 'WARNING',
      message: `The text is shorter than ${minChars} characters.`,
    });
  }

  if (characterCount > maxChars) {
    issues.push({
      code: 'TOO_LONG',
      severity: 'ERROR',
      message: `The text is longer than the ${maxChars.toLocaleString()} character limit.`,
    });
  }

  // U+FFFD means an encoding step already lost bytes; control characters other
  // than tab/newline should never appear in a document a person will read.
  if (/\uFFFD/.test(text) || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) {
    issues.push({
      code: 'CORRUPT_TEXT',
      severity: 'ERROR',
      message: 'The text contains corrupted or non-printable characters.',
    });
  }

  for (const { pattern, label } of PLACEHOLDER_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      issues.push({
        code: 'PLACEHOLDER',
        severity: 'ERROR',
        message: `The text still contains a ${label}.`,
      });
    }
  }

  const repeated = repeatedSentence(text);
  if (repeated) {
    issues.push({
      code: 'REPEATED_SENTENCE',
      severity: 'WARNING',
      message: `The same sentence appears at least three times: “${repeated}…”`,
    });
  }

  return {
    ok: !issues.some((issue) => issue.severity === 'ERROR'),
    wordCount: countWords(text),
    characterCount,
    issues,
  };
}
