import { auth } from '@/auth';
import { NextResponse } from 'next/server';
import { logImportantError } from '@/lib/observability';
import { extractResumeProfile } from '@/lib/resume';

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]);

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

    const extracted = await extractResumeProfile(file);

    return NextResponse.json({
      ok: true,
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
