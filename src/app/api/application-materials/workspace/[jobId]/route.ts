/**
 * AI application materials — one job's application kit.
 *
 *   GET /api/application-materials/workspace/[jobId]
 *
 * Returns the job, every material written for it, the caller's resumes and the
 * honest availability of each material type. Scoped by the session userId; a
 * job belonging to another user is a non-disclosing 404.
 */

import { auth } from '@/auth';
import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import {
  ApplicationWorkspaceNotFoundError,
  loadApplicationWorkspace,
} from '@/lib/application-materials/workspace-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/application-materials/workspace/[jobId]';

type Params = { params: Promise<{ jobId: string }> };

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

export async function GET(request: Request, { params }: Params) {
  return handleRoute(
    async () => {
      const session = await auth();
      if (!session?.user?.id) {
        return apiError('UNAUTHENTICATED', 'Please sign in.', { request });
      }

      const { jobId } = await params;

      const rate = applyRateLimit(
        `${ROUTE}:${session.user.id}:${getRequestIp(request)}`,
        30,
        60_000,
      );
      if (!rate.ok) {
        return apiError('RATE_LIMITED', 'Too many requests. Please wait a moment.', { request });
      }

      try {
        const workspace = await loadApplicationWorkspace({
          userId: session.user.id,
          jobId,
        });
        return privateNoStore(jsonOk({ workspace }, request));
      } catch (error) {
        if (error instanceof ApplicationWorkspaceNotFoundError) {
          return apiError('NOT_FOUND', 'Application kit not found.', { request });
        }
        throw error;
      }
    },
    { event: 'application_material_workspace_route_failed', route: ROUTE },
  );
}
