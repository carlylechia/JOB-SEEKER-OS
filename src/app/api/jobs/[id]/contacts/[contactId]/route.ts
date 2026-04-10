import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { mapDbJob } from '@/lib/db-helpers';
import { jsonError, jsonOk } from '@/lib/api';
import { logImportantError, logImportantInfo } from '@/lib/observability';
import { sanitizeText } from '@/lib/sanitize';
import { z } from 'zod';
import { Contact } from '@/types';

const contactSchema = z.object({
  name: z.string().min(1).max(120).transform((v) => sanitizeText(v, 120)),
  company: z.string().max(120).default('').transform((v) => sanitizeText(v, 120)),
  title: z.string().max(120).default('').transform((v) => sanitizeText(v, 120)),
  relationshipType: z.string().max(60).default('').transform((v) => sanitizeText(v, 60)),
  outreachDate: z.string().max(20).optional().default('').transform((v) => sanitizeText(v, 20)),
  responseDate: z.string().max(20).optional().default('').transform((v) => sanitizeText(v, 20)),
  nextFollowUp: z.string().max(20).optional().default('').transform((v) => sanitizeText(v, 20)),
  notes: z.string().max(2000).optional().default('').transform((v) => sanitizeText(v, 2000)),
});

type Params = { params: Promise<{ id: string; contactId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return jsonError('Unauthorized', 401, undefined, request);

  const { id, contactId } = await params;

  try {
    const existing = await prisma.jobLead.findFirst({ where: { id, userId: session.user.id, deletedAt: null } });
    if (!existing) return jsonError('Job not found', 404, undefined, request);

    const body = await request.json();
    const parsed = contactSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError('Invalid contact data', 422, parsed.error.issues.map((i) => i.message), request);
    }

    const contacts = (existing.contacts as Contact[]) || [];
    const idx = contacts.findIndex((c) => c.id === contactId);
    if (idx === -1) return jsonError('Contact not found', 404, undefined, request);

    contacts[idx] = { ...contacts[idx], ...parsed.data };

    const updated = await prisma.jobLead.update({ where: { id }, data: { contacts } });

    return jsonOk({ job: mapDbJob(updated) }, request);
  } catch (error) {
    await logImportantError({
      event: 'contact_update_failed',
      userId: session.user.id,
      jobId: id,
      route: `/api/jobs/${id}/contacts/${contactId}`,
      error,
    });
    return jsonError('Unable to update contact', 500, undefined, request);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return jsonError('Unauthorized', 401, undefined, request);

  const { id, contactId } = await params;

  try {
    const existing = await prisma.jobLead.findFirst({ where: { id, userId: session.user.id, deletedAt: null } });
    if (!existing) return jsonError('Job not found', 404, undefined, request);

    const contacts = ((existing.contacts as Contact[]) || []).filter((c) => c.id !== contactId);
    const updated = await prisma.jobLead.update({ where: { id }, data: { contacts } });

    await logImportantInfo({
      event: 'contact_removed',
      userId: session.user.id,
      jobId: id,
      route: `/api/jobs/${id}/contacts/${contactId}`,
    });

    return jsonOk({ job: mapDbJob(updated) }, request);
  } catch (error) {
    await logImportantError({
      event: 'contact_delete_failed',
      userId: session.user.id,
      jobId: id,
      route: `/api/jobs/${id}/contacts/${contactId}`,
      error,
    });
    return jsonError('Unable to delete contact', 500, undefined, request);
  }
}
