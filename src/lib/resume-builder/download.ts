/**
 * Response headers for a resume PDF download.
 *
 * Extracted from the route so the headers can be asserted directly rather than
 * inferred. Every one of them is a decision, not boilerplate:
 *
 *  - `Cache-Control: private, no-store, must-revalidate` — a resume is a
 *    personal document. A CDN, a proxy or the browser's back button must never
 *    be the reason one person's resume is still on screen after another person
 *    uses the same machine.
 *  - `Content-Disposition: attachment` — download, not navigate. Navigating to
 *    a PDF renders it in the browser's viewer, where it can be printed, saved
 *    and shared without the user meaning to.
 *  - `Content-Security-Policy: default-src 'none'; sandbox` — belt and braces
 *    for a file built from untrusted resume text.
 *  - `X-Content-Type-Options: nosniff` — never let a browser second-guess the
 *    declared type.
 *  - `Vary: Cookie` — so any intermediary treats this as per-user.
 *
 * `Content-Length` is set from the real byte count so a truncated response is
 * detectable rather than silently short.
 */

import { resumeDownloadFileName } from './pdf';

export function resumeDownloadHeaders(params: {
  /** Server-known resume name. Never from a request header. */
  resumeName: string;
  byteLength: number;
}): Headers {
  const fileName = resumeDownloadFileName(params.resumeName);

  return new Headers({
    'Content-Type': 'application/pdf',
    'Content-Length': String(params.byteLength),
    // `filename` is the ASCII fallback; `filename*` is the RFC 5987 form that
    // survives a non-Latin resume name. Both are derived from the server-known
    // name, and `resumeDownloadFileName` has already stripped quotes,
    // semicolons and control characters, so neither can break the header.
    'Content-Disposition':
      `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
    Pragma: 'no-cache',
    Vary: 'Cookie',
  });
}