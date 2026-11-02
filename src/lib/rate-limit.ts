/**
 * In-memory fixed-window rate limiting.
 *
 * Keys are built from a trusted client identifier plus the user id where one is
 * available. `x-forwarded-for` is only used as a fallback: proxies append to
 * it, so the left-most value can be attacker supplied. `x-real-ip` (set by the
 * platform edge) and Cloudflare's `cf-connecting-ip` are preferred.
 */

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

const MAX_BUCKETS = 20_000;
const SWEEP_THRESHOLD = 5_000;

/** Validate a single header value as an IPv4/IPv6 literal. */
function normalizeIp(value: string | null | undefined): string | null {
  if (!value) return null;
  let candidate = value.trim();
  if (!candidate || candidate.length > 64) return null;
  if (candidate.startsWith('[') && candidate.endsWith(']')) {
    candidate = candidate.slice(1, -1);
  }

  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(candidate)) {
    const octets = candidate.split('.').map(Number);
    if (octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
      return candidate;
    }
    return null;
  }

  // IPv6 literal (may include a zone id, which is irrelevant to identity).
  if (candidate.includes(':') && /^[0-9a-fA-F:.%]+$/.test(candidate)) {
    return candidate.toLowerCase();
  }

  return null;
}

export function getRequestIp(request: Request) {
  // Platform-provided headers are not influenced by a client-supplied
  // X-Forwarded-For prefix.
  const trusted = [
    request.headers.get('x-real-ip'),
    request.headers.get('cf-connecting-ip'),
    request.headers.get('x-vercel-forwarded-for'),
  ];
  for (const value of trusted) {
    const ip = normalizeIp(value);
    if (ip) return ip;
  }

  // Fallback: use the right-most valid entry. A reverse proxy appends the
  // address it observed, so this is the closest hop rather than a spoofable
  // value the caller can prepend.
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const parts = forwarded.split(',').map((part) => part.trim()).filter(Boolean);
    for (let index = parts.length - 1; index >= 0; index -= 1) {
      const ip = normalizeIp(parts[index]);
      if (ip) return ip;
    }
  }

  return 'unknown';
}

function sweep(now: number) {
  if (buckets.size < SWEEP_THRESHOLD) return;

  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }

  // Still oversized (e.g. a flood of unique keys inside one window): evict the
  // oldest insertions so memory stays bounded.
  if (buckets.size > MAX_BUCKETS) {
    const excess = buckets.size - MAX_BUCKETS;
    let removed = 0;
    for (const key of buckets.keys()) {
      if (removed >= excess) break;
      buckets.delete(key);
      removed += 1;
    }
  }
}

export function applyRateLimit(key: string, limit = 30, windowMs = 60_000) {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt < now) {
    sweep(now);
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { ok: true, remaining: limit - 1, resetAt };
  }

  if (bucket.count >= limit) {
    return { ok: false, remaining: 0, resetAt: bucket.resetAt };
  }

  bucket.count += 1;
  buckets.set(key, bucket);
  return { ok: true, remaining: Math.max(0, limit - bucket.count), resetAt: bucket.resetAt };
}
