/**
 * Where a saved profile-picture URL should be rendered from.
 *
 * Private Blob objects cannot be fetched by the browser directly, so they are
 * served through the authenticated `/api/profile/picture/file` route. Public
 * Blob uploads, LinkedIn photos, pasted external URLs and local dev uploads are
 * already browser-readable and are returned unchanged.
 *
 * The version query changes whenever a new upload creates a new blob path,
 * letting the browser cache one avatar for a while without showing an old one
 * after a replacement.
 */

import { isPrivateVercelBlobUrl } from './blob-url';

export function profilePictureSrc(url: string | null | undefined): string {
  const trimmed = url?.trim();
  if (!trimmed) return '';
  if (!isPrivateVercelBlobUrl(trimmed)) return trimmed;

  let version = '';
  try {
    version = new URL(trimmed).pathname.split('/').pop() ?? '';
  } catch {
    // A malformed URL should still reach the route, which will return a safe
    // 404 rather than attempting a fetch.
  }

  return version
    ? `/api/profile/picture/file?v=${encodeURIComponent(version)}`
    : '/api/profile/picture/file';
}
