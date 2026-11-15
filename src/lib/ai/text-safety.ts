/**
 * Text safety at the AI provider boundary.
 *
 * Provider APIs reject some byte sequences even when the surrounding JSON is
 * valid. In particular, a lone UTF-16 surrogate (a user paste split in the
 * middle of an emoji, or a malformed database value) can make an otherwise
 * perfect request fail with a 400 that looks unrelated to its cause.
 *
 * This function is deliberately conservative:
 *  - control characters that cannot appear in a well-formed prompt become a
 *    space; newlines and tabs are preserved;
 *  - lone surrogates become U+FFFD, the Unicode replacement character;
 *  - nothing else is removed, so the job description and candidate evidence
 *    are never silently shortened.
 */
export function sanitizeProviderText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '\uFFFD')
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');
}
