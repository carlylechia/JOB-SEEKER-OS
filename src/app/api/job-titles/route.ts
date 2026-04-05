import { auth } from '@/auth';
import { jsonError, jsonOk } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { logImportantError, logImportantInfo } from '@/lib/observability';
import { prisma } from '@/lib/prisma';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { sanitizeText } from '@/lib/sanitize';

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

export async function GET(request: Request) {
  const items = await prisma.jobTitle.findMany({ orderBy: { name: 'asc' } });
  return jsonOk({ options: items.map((item) => item.name) }, request);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return jsonError('Unauthorized', 401, undefined, request);

  const rate = applyRateLimit(`job-titles:create:${session.user.id}:${getRequestIp(request)}`, 20, 60_000);
  if (!rate.ok) return jsonError('Too many requests', 429, undefined, request);

  try {
    const body = await request.json();
    const name = sanitizeText(String(body?.name || ''), 80);
    if (!name || name.length < 2) return jsonError('Invalid title', 422, undefined, request);
    const slug = slugify(name);
    const title = await prisma.jobTitle.upsert({
      where: { slug },
      update: {},
      create: { name, slug, createdById: session.user.id },
    });
    const options = await prisma.jobTitle.findMany({ orderBy: { name: 'asc' } });
    await logImportantInfo({ event: 'job_title_created', userId: session.user.id, route: '/api/job-titles', context: { name: title.name } });
    return jsonOk({ title: title.name, options: options.map((item) => item.name) }, request, { status: 201 });
  } catch (error) {
    await logImportantError({ event: 'job_title_create_failed', userId: session?.user?.id, route: '/api/job-titles', error, context: { method: 'POST' } });
    return jsonError('Unable to create title option.', 500, undefined, request);
  }
}
