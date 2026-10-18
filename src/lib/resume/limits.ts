/**
 * Centralised resume limits and file-type rules.
 *
 * There is exactly one place that decides how large a resume may be, how much
 * text we will extract, how many pages we will read, and which formats are
 * allowed. Components import from here for client-side hints; the server
 * re-checks every one of these values independently and never trusts the client.
 *
 * Before this module the same `5 * 1024 * 1024` constant was duplicated in the
 * parse route, the profile page and the onboarding step, and the format check
 * trusted the browser-supplied MIME type.
 */

/** Upload ceiling. Large enough for a designed PDF, small enough for serverless. */
export const RESUME_MAX_FILE_BYTES = 5 * 1024 * 1024;

/**
 * Ceiling on the text we will send to a provider.
 *
 * ~24k characters is roughly 6k tokens — far more than a normal one- or
 * two-page resume, and a hard stop well inside any model's context window.
 * Anything larger is truncated with an explicit marker rather than silently
 * cut mid-sentence.
 */
export const RESUME_MAX_EXTRACTED_CHARS = 24_000;

/**
 * Floor below which extracted text is treated as "no usable content".
 *
 * Kept low on purpose. A genuinely sparse resume is a valid resume, and
 * refusing to read one because it is short would be worse than returning
 * whatever it does contain. The check that actually catches a blank or scanned
 * document is `RESUME_MEANINGFUL_CHAR_FLOOR`, measured on letters and digits
 * rather than whitespace and punctuation.
 */
export const RESUME_MIN_USABLE_CHARS = 40;

/** Letters and digits required before we believe a document is readable. */
export const RESUME_MEANINGFUL_CHAR_FLOOR = 20;

/**
 * Page cap for PDF parsing. A 40-page PDF is not a resume, and pdf.js is the
 * most expensive parser we run, so we stop reading rather than burn CPU/memory
 * (and a provider call) on a document that is obviously not a resume.
 */
export const RESUME_MAX_PDF_PAGES = 25;

/** Expanded-DOCX page cap. Mammoth's `pageBreak` count is a reasonable proxy. */
export const RESUME_MAX_DOCX_PAGES = 40;

/**
 * Archive-bomb guard.
 *
 * A `.docx` is a ZIP. A few hundred KB of compressed XML can expand into
 * hundreds of megabytes, so we cap the expansion ratio before handing anything
 * to the XML parser.
 */
export const RESUME_MAX_ZIP_EXPANSION_RATIO = 120;
export const RESUME_MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;

/** Provider call ceiling. Keeps a stuck request inside the function budget. */
export const RESUME_AI_TIMEOUT_MS = 45_000;

/** Storage fetch ceiling, so a pathological blob cannot stall the request. */
export const RESUME_STORAGE_FETCH_TIMEOUT_MS = 15_000;

/** Minimum free-text characters that prove a PDF is not just scanned images. */
export const RESUME_IMAGE_ONLY_TEXT_FLOOR = 40;

export type ResumeFormat = 'pdf' | 'docx' | 'txt';

export const RESUME_FORMATS: readonly ResumeFormat[] = ['pdf', 'docx', 'txt'];

/** Extensions we accept, mapped to the format the parser should use. */
const EXTENSION_TO_FORMAT: Record<string, ResumeFormat> = {
  pdf: 'pdf',
  docx: 'docx',
  txt: 'txt',
  // `.text` is what macOS "Save as plain text" produces; same parser as `.txt`.
  text: 'txt',
};

export const RESUME_ACCEPT_ATTRIBUTE = '.pdf,.docx,.txt,.text';

export const RESUME_MIME_BY_FORMAT: Record<ResumeFormat, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
};

/**
 * Legacy binary Word documents. Deliberately unsupported: there is no safe,
 * maintained parser worth the dependency, and MIME type alone cannot reliably
 * distinguish them. Detected by signature so we can refuse precisely.
 */
export const RESUME_UNSUPPORTED_MESSAGE =
  'Legacy .doc files are not supported. Save your resume as PDF or DOCX and try again.';

/** Formats a user might reasonably expect us to take, refused with a reason. */
const REFUSED_EXTENSIONS: Record<string, string> = {
  doc: RESUME_UNSUPPORTED_MESSAGE,
  rtf: 'RTF files are not supported. Save your resume as PDF or DOCX and try again.',
  odt: 'ODT files are not supported. Save your resume as PDF or DOCX and try again.',
  pages: 'Pages files are not supported. Export your resume as PDF and try again.',
  zip: 'Archive files are not supported. Upload the resume document itself.',
  rar: 'Archive files are not supported. Upload the resume document itself.',
  '7z': 'Archive files are not supported. Upload the resume document itself.',
  exe: 'Executable files are not supported.',
  dmg: 'Executable files are not supported.',
};

/**
 * Format implied by the filename extension.
 *
 * Only a *hint*: it is used to produce a precise error message, never to decide
 * which parser runs. The real decision is made from magic bytes.
 */
export function formatFromFilename(filename: string): ResumeFormat | null {
  const match = /\.([a-z0-9]+)$/i.exec(filename.trim());
  if (!match) return null;
  return EXTENSION_TO_FORMAT[match[1].toLowerCase()] ?? null;
}

/** A specific, human-readable reason to refuse this filename. */
export function refusalForFilename(filename: string): string | null {
  const match = /\.([a-z0-9]+)$/i.exec(filename.trim());
  if (!match) return null;
  return REFUSED_EXTENSIONS[match[1].toLowerCase()] ?? null;
}

export function isSupportedExtension(filename: string): boolean {
  return formatFromFilename(filename) !== null;
}

export const RESUME_UNSUPPORTED_MEDIA_MESSAGE =
  'Only PDF, DOCX and plain-text resumes are supported.';

/** Formats the UI is allowed to advertise. `.text` is accepted, not advertised. */
export function formatAcceptLabel(): string {
  return 'PDF, DOCX or TXT';
}