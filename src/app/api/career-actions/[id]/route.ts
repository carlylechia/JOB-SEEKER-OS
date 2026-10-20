import { auth } from '@/auth';
import { jsonError, jsonOk } from '@/lib/api';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { updateCareerAction, deleteCareerAction, getCareerAction } from '@/lib/career-queue/service';
import { logImportantInfo, logImportantError } from '@/lib/observability';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) return jsonError('Unauthorized', 401, undefined, request);

  const action = await getCareerAction(session.user.id, id);
  if (!action) return jsonError('Not found.', 404, undefined, request);
  return jsonOk({ action }, request);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) return jsonError('Unauthorized', 401, undefined, request);

  const rate = applyRateLimit(`career-actions-update:${session.user.id}:${getRequestIp(request)}`, 30, 60_000);
  if (!rate.ok) return jsonError('Too many requests', 429, undefined, request);

  try {
    const body = await request.json();
    const patch: Record<string, unknown> = {};
    if (body.title !== undefined) patch.title = String(body.title);
    if (body.description !== undefined) patch.description = body.description === null ? null : String(body.description);
    if (body.status !== undefined) patch.status = String(body.status);
    if (body.priority !== undefined) patch.priority = Number(body.priority);
    if (body.dueDate !== undefined) patch.dueDate = body.dueDate ? new Date(body.dueDate) : null;
    if (body.estimatedMinutes !== undefined) patch.estimatedMinutes = body.estimatedMinutes === null ? null : Number(body.estimatedMinutes);
    if (body.snoozedUntil !== undefined) patch.snoozedUntil = body.snoozedUntil ? new Date(body.snoozedUntil) : null;

    const action = await updateCareerAction(session.user.id, id, patch as any);
    return jsonOk({ action }, request);
  } catch (error) {
    if (error instanceof Error && error.message === 'NOT_FOUND') return jsonError('Not found.', 404, undefined, request);
    if (error instanceof Error && error.message === 'INVALID_STATUS') return jsonError('Invalid status.', 400, undefined, request);
    await logImportantError({ event: 'career_action_update_failed', userId: session.user.id, route: '/api/career-actions/[id]', error });
    return jsonError('Unable to update action.', 500, undefined, request);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) return jsonError('Unauthorized', 401, undefined, request);

  try {
    await deleteCareerAction(session.user.id, id);
    return jsonOk({ ok: true }, request);
  } catch (error) {
    if (error instanceof Error && error.message === 'NOT_FOUND') return jsonError('Not found.', 404, undefined, request);
    if (error instanceof Error && error.message === 'FORBIDDEN_DELETE') return jsonError('Only user-created actions can be deleted.', 403, undefined, request);
    await logImportantError({ event: 'career_action_delete_failed', userId: session.user.id, route: '/api/career-actions/[id]', error });
    return jsonError('Unable to delete action.', 500, undefined, request);
  }
}
