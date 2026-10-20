import { auth } from '@/auth';
import { jsonError, jsonOk } from '@/lib/api';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { syncCareerActions, listCareerActions, createCareerAction } from '@/lib/career-queue/service';
import { logImportantInfo, logImportantError } from '@/lib/observability';

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return jsonError('Unauthorized', 401, undefined, request);

  const rate = applyRateLimit(`career-actions:${session.user.id}:${getRequestIp(request)}`, 30, 60_000);
  if (!rate.ok) return jsonError('Too many requests', 429, undefined, request);

  try {
    const url = new URL(request.url);
    const sync = url.searchParams.get('sync') !== 'false';
    if (sync) await syncCareerActions(session.user.id);
    const status = url.searchParams.get('status') ?? undefined;
    const limit = Number(url.searchParams.get('limit') ?? '100');
    const actions = await listCareerActions(session.user.id, { status, limit });
    await logImportantInfo({ event: 'career_queue_access', userId: session.user.id, route: '/api/career-actions', context: { count: actions.length } });
    return jsonOk({ actions }, request);
  } catch (error) {
    await logImportantError({ event: 'career_queue_access_denied', userId: session.user.id, route: '/api/career-actions', error });
    return jsonError('Unable to load career actions.', 500, undefined, request);
  }
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return jsonError('Unauthorized', 401, undefined, request);

  const rate = applyRateLimit(`career-actions-create:${session.user.id}:${getRequestIp(request)}`, 20, 60_000);
  if (!rate.ok) return jsonError('Too many requests', 429, undefined, request);

  try {
    const body = await request.json();
    const title = String(body.title ?? '').trim();
    if (!title) return jsonError('Title is required.', 400, undefined, request);
    const action = await createCareerAction(session.user.id, {
      userId: session.user.id,
      actionType: body.actionType ?? 'REVIEW_WEEKLY_PROGRESS',
      title,
      description: body.description ?? null,
      priority: typeof body.priority === 'number' ? body.priority : 50,
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
      estimatedMinutes: typeof body.estimatedMinutes === 'number' ? body.estimatedMinutes : null,
      sourceType: 'USER_CREATED',
      sourceId: body.sourceId ?? null,
      relatedJobId: body.relatedJobId ?? null,
      relatedResumeId: body.relatedResumeId ?? null,
      relatedPrepPackId: body.relatedPrepPackId ?? null,
      origin: 'USER',
      metadata: body.metadata ?? null,
    });

    return jsonOk({ action }, request);
  } catch (error) {
    if (error instanceof Error && error.message === 'JOB_NOT_FOUND') return jsonError('Job not found.', 404, undefined, request);
    if (error instanceof Error && error.message === 'RESUME_NOT_FOUND') return jsonError('Resume not found.', 404, undefined, request);
    if (error instanceof Error && error.message === 'PREP_PACK_NOT_FOUND') return jsonError('Preparation pack not found.', 404, undefined, request);
    await logImportantError({ event: 'career_action_create_failed', userId: session.user.id, route: '/api/career-actions', error });
    return jsonError('Unable to create action.', 500, undefined, request);
  }
}
