/**
 * GET /api/profile/picture/file
 *
 * Authenticated delivery for a PRIVATE profile-picture blob.
 *
 * A private Vercel Blob store cannot serve objects directly to the browser, and
 * a public upload is rejected by the store. The upload route therefore stores
 * the avatar privately and this route streams it back to its owner.
 *
 * Ownership is derived from the session, never from a request parameter. The
 * storage token can read the whole store, so the URL must also belong to this
 * user's own `avatars/<userId>/` prefix; otherwise this would be a generic
 * token-gated proxy.
 */

import { auth } from '@/auth';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logImportantError } from '@/lib/observability';
import { isOwnedPrivateAvatarUrl } from '@/lib/blob-url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Matches the upload cap in `/api/profile/picture`. */
const MAX_AVATAR_BYTES = 4 * 1024 * 1024;

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

const ALLOWED_IMAGE_TYPES = new Set(Object.values(CONTENT_TYPE_BY_EXT));

function guessContentType(url: string): string {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  return CONTENT_TYPE_BY_EXT[ext] ?? '';
}

export async function GET(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const profile = await prisma.userProfile.findUnique({
      where: { userId: session.user.id },
      select: { profilePictureUrl: true },
    });

    const avatarUrl = profile?.profilePictureUrl;
    if (!avatarUrl) {
      return NextResponse.json({ error: 'No profile picture' }, { status: 404 });
    }

    // Local development uploads are already served from `/public/uploads`.
    // Redirecting keeps this route from needing filesystem access.
    if (avatarUrl.startsWith('/uploads/')) {
      return NextResponse.redirect(new URL(avatarUrl, request.url), 302);
    }

    // Legacy public blobs and external URLs are rendered directly by the
    // client helper. Never proxy arbitrary URLs with the storage token.
    if (!isOwnedPrivateAvatarUrl(avatarUrl, session.user.id)) {
      return NextResponse.json({ error: 'Profile picture unavailable' }, { status: 404 });
    }

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json({ error: 'Image storage is unavailable' }, { status: 503 });
    }

    // Bound the upstream request so a stuck store cannot hold the function open.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    let upstream: Response;
    try {
      upstream = await fetch(avatarUrl, {
        headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
        cache: 'no-store',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: 'Profile picture unavailable' }, { status: 404 });
    }

    const contentType =
      upstream.headers.get('content-type')?.split(';')[0]?.trim() ||
      guessContentType(avatarUrl);
    if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
      return NextResponse.json({ error: 'Profile picture unavailable' }, { status: 404 });
    }

    const declaredLength = Number(upstream.headers.get('content-length') ?? '0');
    if (declaredLength > MAX_AVATAR_BYTES) {
      return NextResponse.json({ error: 'Profile picture unavailable' }, { status: 404 });
    }

    // Measure the real body too: a missing or dishonest Content-Length must not
    // let the route buffer an oversized object.
    const bytes = new Uint8Array(await upstream.arrayBuffer());
    if (bytes.length > MAX_AVATAR_BYTES) {
      return NextResponse.json({ error: 'Profile picture unavailable' }, { status: 404 });
    }

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(bytes.length),
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        // The URL includes an upload-version query, so a replacement busts this.
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (error) {
    await logImportantError({
      event: 'profile_picture_serve_failed',
      userId: session.user.id,
      route: '/api/profile/picture/file',
      error,
    });
    return NextResponse.json({ error: 'Unable to load profile picture' }, { status: 500 });
  }
}
