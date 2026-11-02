/**
 * GET /api/admin/users
 *
 * Server-side paginated, filtered, sorted user directory.
 *
 * SECURITY:
 *   - admin-only
 *   - SELECTIVE fields only: no password hashes, no reset/verification tokens,
 *     no resume contents, no private files. Admin can see account + billing
 *     metadata, NOT a dump of every user's private data.
 *   - search is passed to Prisma as structured parameters; no raw SQL
 *   - every query is bounded by `take`/cursor pagination
 */

import { z } from 'zod';
import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { getCurrentAdmin } from '@/lib/authz';
import { prisma } from '@/lib/prisma';
import { buildAdminUserWhere, parseAdminUserFilters } from '@/lib/admin/user-filters';
import { logImportantInfo } from '@/lib/observability';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  q: z.string().trim().max(120).optional(),
  plan: z.enum(['FREE', 'PRO', 'PREMIUM', 'NONE']).optional(),
  status: z.enum(['TRIALING', 'ACTIVE', 'EXPIRED', 'CANCELLED', 'SUSPENDED', 'NONE']).optional(),
  role: z.enum(['USER', 'ADMIN']).optional(),
  access: z.enum(['all', 'trial', 'paid', 'free']).optional(),
  sort: z.enum(['createdAt', 'name', 'email', 'trialEndsAt']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  joinedFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  joinedTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function GET(request: Request) {
  const admin = await getCurrentAdmin();

  if (!admin) {
    await logImportantInfo({
      event: 'admin_access_denied',
      context: { route: '/api/admin/users' },
    });
    return privateNoStore(apiError('FORBIDDEN', 'Administrator access is required.', { request }));
  }

  return handleRoute(
    async () => {
      const url = new URL(request.url);
      const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
      if (!parsed.success) {
        return apiError('VALIDATION_FAILED', 'Invalid query parameters.', { request });
      }

      const {
        q,
        plan,
        status,
        role,
        access,
        sort = 'createdAt',
        order = 'desc',
        page = 1,
        pageSize = 25,
      } = parsed.data;

      const filters = parseAdminUserFilters({
        q,
        access,
        role,
        plan,
        status,
        joinedFrom: parsed.data.joinedFrom,
        joinedTo: parsed.data.joinedTo,
      });

      const where = buildAdminUserWhere(filters);
      const skip = (page - 1) * pageSize;

      const [total, users] = await Promise.all([
        prisma.user.count({ where }),
        prisma.user.findMany({
          where,
          take: pageSize,
          skip,
          // Bounded offset pagination: acceptable to this data volume, and
          // avoids the complexity of cursor pagination in the admin UI.
          orderBy: {
            ...(sort === 'trialEndsAt'
              ? { subscription: { trialEndsAt: order } }
              : { [sort]: order }),
          } as never,
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            emailVerified: true,
            createdAt: true,
            lastActiveDate: true,
            // Billing metadata only.
            subscription: {
              select: {
                id: true,
                status: true,
                startsAt: true,
                endsAt: true,
                trialStartsAt: true,
                trialEndsAt: true,
                source: true,
                plan: { select: { code: true, name: true } },
              },
            },
          },
        }),
      ]);

      return privateNoStore(
        jsonOk(
          {
            users,
            pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
          },
          request,
        ),
      );
    },
    { event: 'admin_users_list_failed', route: '/api/admin/users' },
  );
}
