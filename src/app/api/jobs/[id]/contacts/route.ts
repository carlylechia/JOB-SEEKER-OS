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

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return jsonError('Unauthorized', 401, undefined, request);

  const { id } = await params;
  const job = await prisma.jobLead.findFirst({ where: { id, userId: session.user.id, deletedAt: null } });
  if (!job) return jsonError('Job not found', 404, undefined, request);

  return jsonOk({ contacts: job.contacts as Contact[] }, request);
}

export async function POST(request: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return jsonError('Unauthorized', 401, undefined, request);

  const { id } = await params;

  try {
    const existing = await prisma.jobLead.findFirst({ where: { id, userId: session.user.id, deletedAt: null } });
    if (!existing) return jsonError('Job not found', 404, undefined, request);

    const body = await request.json();
    const parsed = contactSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError('Invalid contact data', 422, parsed.error.issues.map((i) => i.message), request);
    }

    const newContact: Contact = {
      id: crypto.randomUUID(),
      ...parsed.data,
    };

    const currentContacts = (existing.contacts as Contact[]) || [];
    const updated = await prisma.jobLead.update({
      where: { id },
      data: { contacts: [...currentContacts, newContact] },
    });

    await logImportantInfo({
      event: 'contact_added',
      userId: session.user.id,
      jobId: id,
      route: `/api/jobs/${id}/contacts`,
      context: { contactName: newContact.name },
    });

    return jsonOk({ job: mapDbJob(updated), contact: newContact }, request);
  } catch (error) {
    await logImportantError({
      event: 'contact_add_failed',
      userId: session.user.id,
      jobId: id,
      route: `/api/jobs/${id}/contacts`,
      error,
    });
    return jsonError('Unable to add contact', 500, undefined, request);
  }
}
