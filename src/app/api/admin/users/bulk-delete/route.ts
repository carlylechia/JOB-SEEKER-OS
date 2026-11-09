/**
 * POST /api/admin/users/bulk-delete
 *
 * Admin-only bulk deletion. The client sends only the explicit user ids the
 * administrator selected; it never sends a filter, role or "delete all" flag.
 *
 * The response is structured even when the operation is partial:
 *   { ok, requested, deleted, failed, skipped, outcomes, auditEventId, ... }
 */

import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { getCurrentAdmin } from '@/lib/authz';
import { logImportantInfo } from '@/lib/observability';
import { applyRateLimit } from '@/lib/rate-limit';
import { deleteAdminUsers } from '@/lib/admin/user-deletion';
import { AdminUserDeleteError } from '@/lib/admin/user-delete-error';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const admin = await getCurrentAdmin();

  if (!admin) {
    await logImportantInfo({
      event: 'admin_access_denied',
      context: { route: '/api/admin/users/bulk-delete' },
    });
    return privateNoStore(apiError('FORBIDDEN', 'Administrator access is required.', { request }));
  }

  // Destructive operations share the same per-admin bucket as individual
  // deletion, so a bulk request cannot be used to bypass the rate limit.
  const rate = applyRateLimit(`admin-user-delete:${admin.id}`, 10, 60_000);
  if (!rate.ok) {
    return privateNoStore(
      apiError('RATE_LIMITED', 'Too many delete requests at once. Please wait a moment.', { request }),
    );
  }

  return handleRoute(
    async () => {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return apiError('VALIDATION_FAILED', 'The request body must be valid JSON.', { request });
      }

      if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        return apiError('VALIDATION_FAILED', 'The request body must be an object.', { request });
      }

      // Reject mass assignment and unknown keys explicitly.
      const keys = Object.keys(body);
      if (keys.length !== 1 || keys[0] !== 'userIds') {
        return apiError('VALIDATION_FAILED', 'Only the userIds field is accepted.', { request });
      }

      try {
        const result = await deleteAdminUsers({
          actorId: admin.id,
          userIds: (body as { userIds: unknown }).userIds,
          mode: 'bulk',
        });

        return privateNoStore(
          jsonOk(
            {
              ok: result.deleted > 0,
              partial: result.failed > 0 || result.skipped > 0,
              ...result,
            },
            request,
          ),
        );
      } catch (error) {
        if (error instanceof AdminUserDeleteError) {
          if (error.code === 'VALIDATION_FAILED') {
            return apiError('VALIDATION_FAILED', error.message, { request });
          }
          if (error.code === 'FORBIDDEN') {
            return apiError('FORBIDDEN', error.message, { request });
          }
          return apiError('INTERNAL_ERROR', error.message, {
            request,
            meta: error.code === 'AUDIT_FAILED' ? { auditFailed: true } : undefined,
          });
        }
        throw error;
      }
    },
    { event: 'admin_user_bulk_delete_failed', route: '/api/admin/users/bulk-delete' },
  );
}
