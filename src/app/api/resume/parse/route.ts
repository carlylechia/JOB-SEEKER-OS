import { auth } from '@/auth';
import { NextResponse } from 'next/server';
import { logImportantError } from '@/lib/observability';
import { extractResumeProfile } from '@/lib/resume';
import { prisma } from '@/lib/prisma';
import path from 'path';
import fs from 'fs/promises';

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]);

// Map mime type to a safe extension
const MIME_TO_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'txt',
};

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get('resume');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Resume file is required' }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'Resume must be 5MB or smaller' }, { status: 413 });
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json({ error: 'Only PDF, DOCX, and TXT resumes are supported' }, { status: 415 });
    }

    // ── Save file to public/uploads/resumes/<userId>.<ext> ──
    const ext = MIME_TO_EXT[file.type] ?? 'bin';
    const fileName = `${session.user.id}.${ext}`;
    const uploadsDir = path.join(process.cwd(), 'public', 'uploads', 'resumes');
    await fs.mkdir(uploadsDir, { recursive: true });

    // Delete stale files with different extensions (e.g. old .pdf when uploading .docx)
    for (const oldExt of ['pdf', 'docx', 'txt', 'bin']) {
      if (oldExt === ext) continue;
      const oldPath = path.join(uploadsDir, `${session.user.id}.${oldExt}`);
      await fs.unlink(oldPath).catch(() => undefined); // ignore if not found
    }

    const filePath = path.join(uploadsDir, fileName);
    const bytes = await file.arrayBuffer();
    await fs.writeFile(filePath, Buffer.from(bytes));
    const resumeUrl = `/uploads/resumes/${fileName}`;

    // ── Parse resume ──
    const extracted = await extractResumeProfile(file);

    // ── Immediately persist resumeUrl to UserProfile (layer 1 of persistence) ──
    // This ensures the resume survives even if the user abandons onboarding after upload.
    await prisma.userProfile.upsert({
      where: { userId: session.user.id },
      create: { userId: session.user.id, resumeUrl },
      update: { resumeUrl },
    });

    return NextResponse.json({
      ok: true,
      resumeUrl,
      extracted,
    });
  } catch (error) {
    await logImportantError({
      event: 'resume_parse_failed',
      userId: session.user.id,
      route: '/api/resume/parse',
      error,
    });

    return NextResponse.json({ error: 'Unable to parse resume' }, { status: 500 });
  }
}
