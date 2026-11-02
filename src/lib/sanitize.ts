export function sanitizeText(value: unknown, max = 5000) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[<>]/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function sanitizeUrl(value: unknown) {
  const raw = sanitizeText(value, 2048);
  if (!raw) return '';

  // Allow relative paths for internally-generated upload URLs. These are
  // produced by our own API routes and are always under /uploads/.
  //
  // The previous check accepted any dots, which allowed `/uploads/../../.env`.
  // Validate the decoded path segment-by-segment and reject encoded separators
  // so a stored URL can never escape the uploads directory.
  if (raw.startsWith('/uploads/')) {
    if (raw.includes('\\')) return '';
    if (/%(?:2e|2f|5c)/i.test(raw)) return '';

    let decoded: string;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      return '';
    }
    if (decoded.includes('\\') || decoded.includes('\u0000')) return '';

    const pathOnly = decoded.split('?')[0].split('#')[0];
    if (pathOnly.split('/').some((segment) => segment === '..' || segment === '.')) return '';
    if (!/^\/uploads\/[a-zA-Z0-9/._-]+$/.test(pathOnly)) return '';
    return raw;
  }

  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    // Credentials in a URL are never useful to this app and make origin
    // comparisons ambiguous.
    if (url.username || url.password) return '';
    return url.toString();
  } catch {
    return '';
  }
}

export function sanitizeArray(values: unknown, maxItems = 20) {
  if (!Array.isArray(values)) return [] as string[];
  return values.map((v) => sanitizeText(v, 120)).filter(Boolean).slice(0, maxItems);
}
