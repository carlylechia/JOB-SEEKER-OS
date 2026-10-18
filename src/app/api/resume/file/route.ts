/**
 * GET /api/resume/file
 *
 * Authenticated delivery for PRIVATE resume blobs.
 *
 * WHY THIS EXISTS: resumes are personally identifiable (name, contact details,
 * employment history). They were previously uploaded as PUBLIC Vercel blobs, so
 * anyone who obtained the URL could read them. They are now stored private and
 * streamed through this route.
 *
 * AUTHORIZATION: the caller must be authenticated AND must own the profile
 * whose resume is being requested. There is no userId parameter — ownership is
 * derived from the session, so a user can never fetch another user's resume by
 * guessing an id.
 */

import { auth } from '@/auth';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logImportantError } from '@/lib/observability';
import { isPrivateResumeUrl } from '@/lib/durable-upload';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Only ever serve these; never proxy an arbitrary user-supplied URL. */
const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain; charset=utf-8',
};

function guessContentType(url: string): string {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  return CONTENT_TYPE_BY_EXT[ext] ?? 'application/octet-stream';
}

export async function GET(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Ownership is enforced by reading the caller's OWN profile. There is no
    // way to ask for someone else's.
    const profile = await prisma.userProfile.findUnique({
      where: { userId: session.user.id },
      select: { resumeUrl: true },
    });

    const resumeUrl = profile?.resumeUrl;
    if (!resumeUrl) {
      return NextResponse.json({ error: 'No resume uploaded' }, { status: 404 });
    }

    // Legacy public blob uploads (created before private storage) still work:
    // redirect rather than proxy, so existing users are not locked out.
    if (!isPrivateResumeUrl(resumeUrl)) {
      return NextResponse.redirect(resumeUrl, 302);
    }

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      // Private blob access requires the store token; fail safely rather than
      // leaking a URL or throwing internals to the client.
      return NextResponse.json({ error: 'File storage is unavailable' }, { status: 503 });
    }

    // Server-to-server fetch with the store token. The browser never sees the
    // underlying storage URL.
    const upstream = await fetch(resumeUrl, {
      headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
      cache: 'no-store',
    });

    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: 'Unable to load your resume' }, { status: 404 });
    }

    const filename = resumeUrl.split('/').pop() ?? 'resume';

    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': guessContentType(resumeUrl),
        // Force download rather than inline render of untrusted content.
        'Content-Disposition': `attachment; filename="${filename.replace(/"/g, '')}"`,
        'X-Content-Type-Options': 'nosniff',
        // Private: one user's resume must never be cached for another.
        'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    await logImportantError({
      event: 'resume_download_failed',
      userId: session.user.id,
      route: '/api/resume/file',
      error,
    });
    return NextResponse.json({ error: 'Unable to load your resume' }, { status: 500 });
  }
}