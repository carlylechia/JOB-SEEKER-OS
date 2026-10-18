/**
 * GET /api/admin/upgrade-requests
 *
 * Server-side paginated, searchable, filterable request inbox.
 * Admin-only. Never loads the full table into the browser.
 */

import { z } from 'zod';
import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { getCurrentAdmin } from '@/lib/authz';
import { prisma } from '@/lib/prisma';
import { logImportantInfo } from '@/lib/observability';
import { buildMailtoUrl, buildWhatsappUrl, whatsappPrefill } from '@/lib/billing/upgrade-requests';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(['PENDING', 'CONTACTED', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
  plan: z.enum(['PRO', 'PREMIUM']).optional(),
  contactMethod: z.enum(['EMAIL', 'WHATSAPP']).optional(),
  sort: z.enum(['createdAt', 'updatedAt']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export async function GET(request: Request) {
  const admin = await getCurrentAdmin();

  if (!admin) {
    await logImportantInfo({ event: 'admin_access_denied', context: { route: '/api/admin/upgrade-requests' } });
    return privateNoStore(apiError('FORBIDDEN', 'Administrator access is required.', { request }));
  }

  return handleRoute(
    async () => {
      const url = new URL(request.url);
      const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
      if (!parsed.success) {
        return apiError('VALIDATION_FAILED', 'Invalid query parameters.', { request });
      }

      const { q, status, plan, contactMethod, sort = 'createdAt', order = 'desc', page = 1, pageSize = 25 } =
        parsed.data;

      const where: Record<string, unknown> = {};
      if (status) where.status = status;
      if (plan) where.requestedPlan = plan;
      if (contactMethod) where.contactMethod = contactMethod;
      if (q) {
        // Message text and contact fields are searchable, parameterised.
        where.OR = [
          { message: { contains: q, mode: 'insensitive' } },
          { contactEmail: { contains: q, mode: 'insensitive' } },
          { whatsappNumber: { contains: q, mode: 'insensitive' } },
          { user: { is: { email: { contains: q, mode: 'insensitive' } } } },
          { user: { is: { name: { contains: q, mode: 'insensitive' } } } },
        ];
      }

      const skip = (page - 1) * pageSize;

      const [total, requests] = await Promise.all([
        prisma.upgradeRequest.count({ where: where as never }),
        prisma.upgradeRequest.findMany({
          where: where as never,
          take: pageSize,
          skip,
          orderBy: { [sort]: order } as never,
          select: {
            id: true,
            requestedPlan: true,
            currentPlanSnapshot: true,
            status: true,
            contactMethod: true,
            contactEmail: true,
            whatsappNumber: true,
            createdAt: true,
            updatedAt: true,
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                subscription: { select: { plan: { select: { code: true } } } },
              },
            },
          },
        }),
      ]);

      // Contact links are constructed server-side from validated values —
      // never from arbitrary user-supplied URLs.
      const enriched = requests.map((r) => ({
        ...r,
        whatsappUrl: buildWhatsappUrl(r.whatsappNumber, whatsappPrefill(r.user.name, r.requestedPlan)),
        mailtoUrl: buildMailtoUrl(r.contactEmail, `Your teChia Jobs ${r.requestedPlan} upgrade request`),
      }));

      return privateNoStore(
        jsonOk(
          { requests: enriched, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } },
          request,
        ),
      );
    },
    { event: 'admin_upgrade_requests_list_failed', route: '/api/admin/upgrade-requests' },
  );
}