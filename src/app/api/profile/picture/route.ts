import { auth } from '@/auth';
import { NextResponse } from 'next/server';
import { logImportantError, logImportantInfo } from '@/lib/observability';
import { prisma } from '@/lib/prisma';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { deleteStoredAsset, uploadUserAsset } from '@/lib/durable-upload';

const MAX_FILE_SIZE = 4 * 1024 * 1024; // 4 MB
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rate = applyRateLimit(`profile:picture:${session.user.id}:${getRequestIp(request)}`, 10, 60_000);
  if (!rate.ok) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  try {
    const formData = await request.formData();
    const file = formData.get('picture');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Image file is required' }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'Image must be 4 MB or smaller' }, { status: 413 });
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json({ error: 'Only JPEG, PNG, WebP, or GIF images are accepted' }, { status: 415 });
    }

    const ext = MIME_TO_EXT[file.type] ?? 'jpg';
    const currentProfile = await prisma.userProfile.findUnique({
      where: { userId: session.user.id },
      select: { profilePictureUrl: true },
    });

    const profilePictureUrl = await uploadUserAsset({
      kind: 'avatar',
      userId: session.user.id,
      file,
      ext,
      existingUrl: currentProfile?.profilePictureUrl,
    });

    await prisma.userProfile.upsert({
      where: { userId: session.user.id },
      create: { userId: session.user.id, profilePictureUrl },
      update: { profilePictureUrl },
    });

    await logImportantInfo({ event: 'profile_picture_uploaded', userId: session.user.id, route: '/api/profile/picture' });
    return NextResponse.json({ ok: true, profilePictureUrl });
  } catch (error) {
    await logImportantError({ event: 'profile_picture_upload_failed', userId: session.user.id, route: '/api/profile/picture', error });
    return NextResponse.json({ error: 'Unable to upload picture' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rate = applyRateLimit(`profile:picture:${session.user.id}:${getRequestIp(request)}`, 10, 60_000);
  if (!rate.ok) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  try {
    const currentProfile = await prisma.userProfile.findUnique({
      where: { userId: session.user.id },
      select: { profilePictureUrl: true },
    });

    await deleteStoredAsset(currentProfile?.profilePictureUrl);

    await prisma.userProfile.update({
      where: { userId: session.user.id },
      data: { profilePictureUrl: null },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    await logImportantError({ event: 'profile_picture_delete_failed', userId: session.user.id, route: '/api/profile/picture', error });
    return NextResponse.json({ error: 'Unable to remove picture' }, { status: 500 });
  }
}
