/**
 * Client-safe redirect sanitisation.
 *
 * `callbackUrl` values arrive from the query string, so they are attacker
 * controlled. Only same-origin absolute paths are allowed; protocol-relative
 * (`//evil.example`), scheme URLs (`javascript:`) and backslash variants are
 * rejected. This module deliberately has no Node-only imports so auth pages
 * can use it in the browser bundle.
 */
export function safeInternalPath(value: unknown, fallback = '/dashboard'): string {
  if (typeof value !== 'string') return fallback;

  const trimmed = value.trim();
  if (!trimmed.startsWith('/')) return fallback;
  if (trimmed.startsWith('//')) return fallback;
  if (trimmed.includes('\\')) return fallback;
  if (/[\u0000-\u001F\u007F]/.test(trimmed)) return fallback;

  try {
    const base = 'https://internal.invalid';
    const url = new URL(trimmed, base);
    // A same-origin relative path must not change the host.
    if (url.origin !== base) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
