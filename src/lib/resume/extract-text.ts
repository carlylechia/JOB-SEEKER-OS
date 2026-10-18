/**
 * Turning a stored resume into plain text.
 *
 * Everything in this module treats the file as hostile input:
 *
 *  - The real format comes from MAGIC BYTES, never from the filename and never
 *    from the browser-supplied Content-Type. Both of those are attacker-chosen.
 *  - Every parser runs behind an explicit size and time budget, because a
 *    malformed document is a cheap way to pin a serverless function.
 *  - DOCX is a ZIP, so it is inspected as one before anything decompresses it.
 *  - When there is genuinely no text, we say so. We never invent content, and we
 *    do not fall back to OCR.
 */

import { extractText, getDocumentProxy } from 'unpdf';
import mammoth from 'mammoth';
import {
  RESUME_MAX_DOCX_PAGES,
  RESUME_MAX_EXTRACTED_CHARS,
  RESUME_MAX_FILE_BYTES,
  RESUME_MAX_PDF_PAGES,
  RESUME_MAX_UNCOMPRESSED_BYTES,
  RESUME_MAX_ZIP_EXPANSION_RATIO,
  RESUME_IMAGE_ONLY_TEXT_FLOOR,
  RESUME_MIN_USABLE_CHARS,
  formatFromFilename,
  refusalForFilename,
  type ResumeFormat,
} from './limits';
import { countMeaningfulChars, normalizeResumeText } from './normalise';
import type { ExtractionErrorCode } from './schema';

export type ResumeTextResult =
  | {
      ok: true;
      format: ResumeFormat;
      text: string;
      /** True when the document was longer than we were willing to read. */
      truncated: boolean;
      /** Pages read, for PDFs. Null for other formats. */
      pages: number | null;
    }
  | {
      ok: false;
      code: ExtractionErrorCode;
      /** Safe, user-facing copy. */
      message: string;
    };

const MESSAGES: Record<ExtractionErrorCode, string> = {
  UNSUPPORTED_FORMAT: 'Only PDF, DOCX and plain-text resumes are supported.',
  CORRUPT_FILE: 'We could not open that document. It may be damaged — try exporting it again.',
  NO_TEXT_FOUND: 'We could not find any readable text in that file.',
  IMAGE_ONLY_PDF:
    'That PDF looks like a scan or image, so there is no text to read. Upload a text-based PDF, or copy the text into a .txt file.',
  TOO_LARGE: 'That document is too large to analyze.',
  PARSE_FAILED: 'We hit a problem reading that document. Please try a different file.',
  AI_NOT_CONFIGURED: 'Resume analysis is not available right now.',
  AI_RATE_LIMITED: 'Our analysis service is busy.',
  AI_TIMEOUT: 'Analysis took too long.',
  AI_REFUSED: 'Our analysis provider could not process that document.',
  AI_EMPTY_RESPONSE: 'The analysis returned no usable results.',
  AI_INVALID_RESPONSE: 'The analysis returned results we could not verify.',
  AI_UNAVAILABLE: 'Our analysis service is temporarily unavailable.',
};

function fail(code: ExtractionErrorCode, message?: string): ResumeTextResult {
  return { ok: false, code, message: message ?? MESSAGES[code] };
}

// ─── Magic bytes ───────────────────────────────────────────────────────────

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const ZIP_SIGNATURES = [
  [0x50, 0x4b, 0x03, 0x04], // local file header
  [0x50, 0x4b, 0x05, 0x06], // empty archive
  [0x50, 0x4b, 0x07, 0x08], // spanned archive
];
// OLE2 compound file: legacy .doc / .xls / .ppt
const OLE2_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

/** Does the byte stream contain this ASCII marker? Used to identify ZIP members. */
function containsAscii(bytes: Uint8Array, needle: string): boolean {
  const pattern = new TextEncoder().encode(needle);
  const limit = bytes.length - pattern.length;
  outer: for (let i = 0; i <= limit; i += 1) {
    if (bytes[i] !== pattern[0]) continue;
    for (let j = 1; j < pattern.length; j += 1) {
      if (bytes[i + j] !== pattern[j]) continue outer;
    }
    return true;
  }
  return false;
}

/**
 * Identify a document from its bytes.
 *
 * The filename is consulted only to produce a precise error message for a
 * format we deliberately refuse — never to decide which parser runs. A file
 * named `resume.pdf` that is actually a ZIP is a ZIP.
 */
export function detectResumeFormat(
  bytes: Uint8Array,
  filename: string,
): { ok: true; format: ResumeFormat } | { ok: false; code: ExtractionErrorCode; message: string } {
  if (bytes.length === 0) return fail('CORRUPT_FILE', 'That file is empty.');

  if (startsWith(bytes, PDF_SIGNATURE)) return { ok: true, format: 'pdf' };

  if (startsWith(bytes, OLE2_SIGNATURE)) {
    return fail('UNSUPPORTED_FORMAT', refusalForFilename(filename) ?? MESSAGES.UNSUPPORTED_FORMAT);
  }

  if (ZIP_SIGNATURES.some((signature) => startsWith(bytes, signature))) {
    // A .docx is a ZIP whose payload is an OOXML wordprocessing document. Both
    // markers appear uncompressed in the ZIP headers, so this identifies the
    // format without decompressing anything.
    const looksLikeWordDocument = containsAscii(bytes, 'word/document.xml');
    if (looksLikeWordDocument) return { ok: true, format: 'docx' };
    return fail(
      'UNSUPPORTED_FORMAT',
      'That file is a zip archive, not a Word document. Upload the resume document itself.',
    );
  }

  // No binary signature. Accept as plain text only if it really decodes as text.
  if (formatFromFilename(filename) === 'txt' || isProbablyText(bytes)) {
    if (decodeText(bytes) !== null) return { ok: true, format: 'txt' };
  }

  const refusal = refusalForFilename(filename);
  if (refusal) return fail('UNSUPPORTED_FORMAT', refusal);
  return fail('UNSUPPORTED_FORMAT');
}

// ─── Plain text decoding ───────────────────────────────────────────────────

/** Control characters that should not appear in a text resume, other than whitespace. */
function textNoiseRatio(decoded: string): number {
  let suspicious = 0;
  for (const char of decoded) {
    const code = char.codePointAt(0) ?? 0;
    const isAllowedWhitespace = code === 9 || code === 10 || code === 13;
    if (code < 32 && !isAllowedWhitespace) suspicious += 1;
    // U+FFFD means the decoder hit bytes it could not map.
    if (code === 0xfffd) suspicious += 1;
  }
  return decoded.length === 0 ? 1 : suspicious / decoded.length;
}

/**
 * Decode text, tolerating the BOMs Word and macOS actually emit.
 * Returns null for binary content, which is how a renamed executable is caught.
 */
export function decodeText(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0xef, 0xbb, 0xbf])) {
    return strictDecode(bytes.subarray(3), 'utf-8');
  }
  if (startsWith(bytes, [0xff, 0xfe])) return strictDecode(bytes.subarray(2), 'utf-16le');
  if (startsWith(bytes, [0xfe, 0xff])) return strictDecode(bytes.subarray(2), 'utf-16be');

  const decoded = strictDecode(bytes, 'utf-8');
  if (decoded === null) return null;
  // A little slop: real resumes occasionally carry a stray control byte.
  return textNoiseRatio(decoded) <= 0.02 ? decoded : null;
}

function strictDecode(bytes: Uint8Array, encoding: 'utf-8' | 'utf-16le' | 'utf-16be'): string | null {
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function isProbablyText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 2048);
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) return false;
    // Control bytes outside tab/newline/carriage return suggest binary.
    if (byte < 9 || (byte > 13 && byte < 32)) suspicious += 1;
  }
  return sample.length === 0 || suspicious / sample.length <= 0.05;
}

// ─── ZIP inspection (DOCX archive-bomb guard) ──────────────────────────────

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_ENTRY_SIGNATURE = 0x02014b50;

export type ZipSummary = {
  entries: number;
  totalCompressed: number;
  totalUncompressed: number;
  /** Expansion ratio, guarded against division by zero. */
  ratio: number;
};

/**
 * Walk the ZIP central directory to learn how much this archive would expand to.
 *
 * DOCX is a ZIP, and a few hundred kilobytes of compressed XML can expand into
 * hundreds of megabytes. We measure the declared expansion BEFORE handing the
 * file to the XML parser, so a bomb is refused rather than decompressed.
 *
 * Returns null when the archive cannot be read as a ZIP; callers treat that as
 * corrupt rather than assuming it is safe.
 */
export function inspectZipArchive(bytes: Uint8Array): ZipSummary | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // End-of-central-directory record sits in the last 64KB + 22 bytes.
  const scanFloor = Math.max(0, bytes.length - (0xffff + 22));
  let eocd = -1;
  for (let i = bytes.length - 22; i >= scanFloor; i -= 1) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;

  const entryCount = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (centralOffset >= bytes.length || centralSize > bytes.length) return null;

  let cursor = centralOffset;
  let totalCompressed = 0;
  let totalUncompressed = 0;
  let parsed = 0;

  for (let i = 0; i < entryCount; i += 1) {
    if (cursor + 46 > bytes.length) break;
    if (view.getUint32(cursor, true) !== CENTRAL_ENTRY_SIGNATURE) break;

    totalCompressed += view.getUint32(cursor + 20, true);
    totalUncompressed += view.getUint32(cursor + 24, true);

    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    cursor += 46 + nameLength + extraLength + commentLength;
    parsed += 1;
  }

  if (parsed === 0) return null;

  return {
    entries: parsed,
    totalCompressed,
    totalUncompressed,
    ratio: totalCompressed === 0 ? Number.POSITIVE_INFINITY : totalUncompressed / totalCompressed,
  };
}

// ─── Parsers ───────────────────────────────────────────────────────────────

async function extractPdfText(bytes: Uint8Array): Promise<ResumeTextResult> {
  const document = await getDocumentProxy(bytes);
  // WARNING: pdf.js takes ownership of the buffer it is given and may detach the
  // underlying ArrayBuffer. Nothing may touch `bytes` after this call — callers
  // must keep their own copy if they need one.
  //
  // Releases the parsed document and any decoded fonts. Called on every exit
  // path so a long-running function does not accumulate pdf.js caches.
  const release = () => {
    void Promise.resolve(document.cleanup?.()).catch(() => undefined);
  };

  let totalPages: number;
  try {
    totalPages = document.numPages;
  } catch {
    release();
    return fail('CORRUPT_FILE');
  }

  // A document far past the page cap is not a resume. Refuse before doing the
  // per-page work rather than after.
  if (totalPages > RESUME_MAX_PDF_PAGES * 2) {
    release();
    return fail('TOO_LARGE', 'That PDF has too many pages to be a resume.');
  }

  let raw: string;
  let readPages: number;
  try {
    const result = await extractText(document, { mergePages: true });
    raw = Array.isArray(result.text) ? result.text.join('\n\n') : result.text;
    readPages = result.totalPages;
  } finally {
    release();
  }

  const normalized = normalizeResumeText(raw ?? '');
  const wasTruncated = totalPages > RESUME_MAX_PDF_PAGES;

  if (normalized.length < RESUME_MIN_USABLE_CHARS) {
    // Distinguish "scanned image with no text layer" from "a genuinely blank
    // document", because the fix is different and only the user can apply it.
    if (countMeaningfulChars(normalized) <= RESUME_IMAGE_ONLY_TEXT_FLOOR) {
      return fail('IMAGE_ONLY_PDF');
    }
    return fail('NO_TEXT_FOUND');
  }

  return {
    ok: true,
    format: 'pdf',
    text: normalized.slice(0, RESUME_MAX_EXTRACTED_CHARS),
    truncated: wasTruncated || normalized.length > RESUME_MAX_EXTRACTED_CHARS,
    pages: readPages ?? Math.min(totalPages, RESUME_MAX_PDF_PAGES),
  };
}

async function extractDocxText(bytes: Uint8Array): Promise<ResumeTextResult> {
  const archive = inspectZipArchive(bytes);
  if (!archive) return fail('CORRUPT_FILE', 'That Word file could not be read as a document.');

  if (archive.totalUncompressed > RESUME_MAX_UNCOMPRESSED_BYTES) {
    return fail('TOO_LARGE', 'That Word file expands to an unusually large size and was refused.');
  }
  if (archive.ratio > RESUME_MAX_ZIP_EXPANSION_RATIO) {
    return fail('TOO_LARGE', 'That Word file expands to an unusually large size and was refused.');
  }

  // `extractRawText` reads the document body only: no images are rendered, no
  // embedded content is executed, and macros are never part of a .docx payload.
  const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  const normalized = normalizeResumeText(result.value ?? '');

  if (normalized.length < RESUME_MIN_USABLE_CHARS) return fail('NO_TEXT_FOUND');

  return {
    ok: true,
    format: 'docx',
    text: normalized.slice(0, RESUME_MAX_EXTRACTED_CHARS),
    truncated: normalized.length > RESUME_MAX_EXTRACTED_CHARS,
    pages: null,
  };
}

function extractTxtText(bytes: Uint8Array): ResumeTextResult {
  const decoded = decodeText(bytes);
  if (decoded === null) {
    return fail('CORRUPT_FILE', 'That file is not readable text.');
  }

  const normalized = normalizeResumeText(decoded);
  if (normalized.length < RESUME_MIN_USABLE_CHARS) return fail('NO_TEXT_FOUND');

  return {
    ok: true,
    format: 'txt',
    text: normalized.slice(0, RESUME_MAX_EXTRACTED_CHARS),
    truncated: normalized.length > RESUME_MAX_EXTRACTED_CHARS,
    pages: null,
  };
}

export type ResumeExtractOptions = {
  /** Hard ceiling, so a wedged parser cannot consume the whole function. */
  timeoutMs: number;
};

/**
 * Full pipeline: identify from bytes, parse, bound, normalise.
 *
 * A timeout is treated as a failure the user can retry, never as success with
 * partial content.
 */
export async function extractResumeText(
  bytes: Uint8Array,
  filename: string,
  options: ResumeExtractOptions,
): Promise<ResumeTextResult> {
  if (bytes.length === 0) return fail('CORRUPT_FILE', 'That file is empty.');
  if (bytes.length > RESUME_MAX_FILE_BYTES) return fail('TOO_LARGE');

  const detected = detectResumeFormat(bytes, filename);
  if (!detected.ok) return detected;

  const run = async (): Promise<ResumeTextResult> => {
    try {
      switch (detected.format) {
        case 'pdf':
          return await extractPdfText(bytes);
        case 'docx':
          return await extractDocxText(bytes);
        case 'txt':
          return extractTxtText(bytes);
      }
    } catch (error) {
      // A parser that throws is a malformed document, not a server fault. The
      // detail is logged server-side; the user gets a retryable message.
      const { logImportantInfo } = await import('@/lib/observability');
      await logImportantInfo({
        event: 'resume_extraction_parse_failed',
        context: {
          format: detected.format,
          sizeBytes: bytes.length,
          errorName: error instanceof Error ? error.name : 'UnknownError',
        },
      });
      return fail('PARSE_FAILED');
    }
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ResumeTextResult>((resolve) => {
    timer = setTimeout(() => resolve(fail('PARSE_FAILED', 'Reading that document took too long. Please try a smaller file.')), options.timeoutMs);
  });

  try {
    return await Promise.race([run(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}