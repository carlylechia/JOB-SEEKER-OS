import { sanitizeText, sanitizeUrl } from './sanitize';

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^0\.0\.0\.0$/,
  /^169\.254\./,
  /^::1$/i,
  /^fc00:/i,
  /^fe80:/i,
];

export function normalizeHttpUrl(value: unknown) {
  return sanitizeUrl(value);
}

export function isSafeExternalUrl(raw: string) {
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return false;

    const host = url.hostname.trim().toLowerCase();
    if (!host) return false;
    if (PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(host))) return false;

    const octets = host.split('.').map((part) => Number(part));
    if (octets.length === 4 && octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
      const [a, b] = octets;
      if (a === 172 && b >= 16 && b <= 31) return false;
    }

    return true;
  } catch {
    return false;
  }
}

export function sourceLabelFromUrl(raw: string) {
  try {
    const url = new URL(raw);
    return sanitizeText(url.hostname.replace(/^www\./, ''), 80);
  } catch {
    return '';
  }
}
