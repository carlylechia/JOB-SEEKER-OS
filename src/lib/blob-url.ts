/**
 * Pure Vercel Blob URL helpers.
 *
 * Kept free of Node-only imports so both server routes and client components can
 * decide whether a stored URL may be rendered directly or must go through an
 * authenticated proxy.
 *
 * Every check parses the URL and inspects `hostname`; none of them trust a
 * substring match. A stored URL can arrive from user input (the onboarding
 * profile schema accepts a photo URL), and the avatar proxy attaches the Blob
 * token to its upstream request, so a lax check would turn that route into a
 * token-leaking SSRF primitive.
 */

const BLOB_DOMAIN = 'blob.vercel-storage.com';
const PRIVATE_BLOB_SUFFIX = `.private.${BLOB_DOMAIN}`;

function parseHttpUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed : null;
  } catch {
    return null;
  }
}

/** Any Vercel Blob object, public or private. */
export function isVercelBlobUrl(url: string): boolean {
  const parsed = parseHttpUrl(url);
  if (!parsed) return false;
  return parsed.hostname === BLOB_DOMAIN || parsed.hostname.endsWith(`.${BLOB_DOMAIN}`);
}

/**
 * A Vercel Blob object that requires token-gated delivery.
 *
 * Private Blob objects are served from `<store-id>.private.blob.vercel-storage.com`
 * (the SDK builds exactly that URL). Public Blob URLs use `.public.` instead.
 */
export function isPrivateVercelBlobUrl(url: string): boolean {
  const parsed = parseHttpUrl(url);
  if (!parsed) return false;
  return parsed.hostname.endsWith(PRIVATE_BLOB_SUFFIX);
}

/**
 * True only for a private avatar owned by this user.
 *
 * The storage token can read the whole store, so the proxy must never become a
 * generic fetcher for any URL a user can place in their profile row. The upload
 * path is always `avatars/<userId>/...`.
 */
export function isOwnedPrivateAvatarUrl(url: string, userId: string): boolean {
  const parsed = parseHttpUrl(url);
  if (!parsed || !isPrivateVercelBlobUrl(url)) return false;
  return parsed.pathname.startsWith(`/avatars/${userId}/`);
}
