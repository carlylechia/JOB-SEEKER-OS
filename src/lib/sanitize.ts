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
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.toString();
  } catch {
    return '';
  }
}

export function sanitizeArray(values: unknown, maxItems = 20) {
  if (!Array.isArray(values)) return [] as string[];
  return values.map((v) => sanitizeText(v, 120)).filter(Boolean).slice(0, maxItems);
}
