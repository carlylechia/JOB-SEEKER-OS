/**
 * Response headers for application-material downloads.
 *
 * Every header is a decision, not boilerplate:
 *
 *  - `Cache-Control: private, no-store, must-revalidate` — a draft is a personal
 *    document. A shared cache must never be the reason one person's letter is
 *    still on screen after another person uses the same machine.
 *  - `Content-Disposition: attachment` — download, not navigate.
 *  - `Content-Security-Policy: default-src 'none'; sandbox` — belt and braces
 *    for a file built from user-supplied text.
 *  - `X-Content-Type-Options: nosniff` — never let a browser second-guess the
 *    declared type.
 *  - `Vary: Cookie` — so any intermediary treats this as per-user.
 */

export function downloadHeaders(params: {
  fileName: string;
  byteLength: number;
  contentType: string;
}): Headers {
  const safe = params.fileName
    .normalize('NFKD')
    .replace(/[^\w\s.-]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 80) || 'download';

  return new Headers({
    'Content-Type': params.contentType,
    'Content-Length': String(params.byteLength),
    'Content-Disposition':
      `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(safe)}`,
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
    Pragma: 'no-cache',
    Vary: 'Cookie',
  });
}
