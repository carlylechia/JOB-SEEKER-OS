/**
 * Sensitive-question guard for AI screening answers.
 *
 * The browser extension must never let a model answer a question the candidate
 * should answer personally: legal declarations, protected characteristics,
 * compensation expectations, identity documents or payment details. The client
 * mirrors this rule so it does not offer an action the server will refuse; the
 * server enforces it here because the client can be bypassed.
 */

const SENSITIVE_PATTERNS = [
  'citizen',
  'citizenship',
  'nationality',
  'visa',
  'sponsor',
  'work authori',
  'right to work',
  'gender',
  'ethnic',
  'religio',
  'disabilit',
  'veteran',
  'military',
  'marital',
  'date of birth',
  'ssn',
  'social security',
  'national insurance',
  'bank',
  'iban',
  'sort code',
  'routing number',
  'salary',
  'compensation',
  'wage',
  'conviction',
  'convict',
  'crime',
  'criminal',
  'background check',
  'drug test',
  'health',
  'diversity',
  'equal opportunity',
  'eeo',
  'password',
  'otp',
  'two factor',
];

/**
 * Short words that must match as words, not substrings: "storage", "trace",
 * "shipping" and "Essex" must not trip the guard.
 */
const SENSITIVE_BOUNDARY = /\b(?:age|sex|race|pin)\b/i;

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function isSensitiveQuestion(question: string): boolean {
  if (!question.trim()) return false;
  if (SENSITIVE_BOUNDARY.test(question)) return true;
  const normalised = normalise(question);
  return SENSITIVE_PATTERNS.some((term) => normalised.includes(normalise(term)));
}

/** Human-readable refusal, safe to show in the extension popup. */
export const SENSITIVE_QUESTION_MESSAGE =
  'This question needs your own answer. It may be a legal or protected declaration, so it was not answered automatically.';
