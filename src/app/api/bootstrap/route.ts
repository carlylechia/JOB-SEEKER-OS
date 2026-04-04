import { auth } from '@/auth';
import { jsonError, jsonOk } from '@/lib/api';
import { getUserWorkspace } from '@/lib/db-helpers';
import { logImportantError } from '@/lib/observability';

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return jsonError('Unauthorized', 401, undefined, request);
  }

  try {
    const workspace = await getUserWorkspace(session.user.id);
    return jsonOk(workspace, request);
  } catch (error) {
    await logImportantError({
      event: 'workspace_bootstrap_failed',
      userId: session.user.id,
      route: '/api/bootstrap',
      error,
      context: { method: 'GET' },
    });
    return jsonError('Unable to load workspace.', 500, undefined, request);
  }
}
