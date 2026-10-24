/**
 * Preview layout.
 *
 *   GET  /api/resumes/[id]/preview[?template=&accent=&density=&hiddenSections=]
 *   POST /api/resumes/[id]/preview with a validated, unsaved draft
 *
 * Returns the SAME layout blocks the PDF renderer consumes, so the preview is
 * the export rather than an approximation of it.
 *
 * Draft requests are debounced by the editor and validated against the same
 * schema as persisted content. They are rendered with the same layout engine
 * but are never written to storage.
 *
 * Cost: none. No provider call, no credit, no storage.
 */

import { auth } from '@/auth';
import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { getResume } from '@/lib/resume-builder/documents';
import { buildResumeLayout, buildResumeLayoutFromRecord } from '@/lib/resume-builder/serve';
import { resumeBuilderErrorResponse } from '@/lib/resume-builder/route-errors';
import { serialiseLayout } from '@/lib/resume-builder/wire';
import { DENSITY_VALUES, isAccentKey, isPageSizeKey, isTemplateKey } from '@/lib/resume-builder/templates';
import {
  HIDABLE_SECTION_KEYS,
  RESUME_SECTION_KEYS,
  previewRequestSchema,
  type ResumeSectionKey,
} from '@/lib/resume-builder/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/resumes/[id]/preview';
type Params = { params: Promise<{ id: string }> };

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

export async function GET(request: Request, { params }: Params) {
  return handleRoute(
    async () => {
      const session = await auth();
      if (!session?.user?.id) return apiError('UNAUTHENTICATED', 'Please sign in.', { request });

      const userId = session.user.id;
      const { id } = await params;

      const rate = applyRateLimit(`${ROUTE}:${userId}:${getRequestIp(request)}`, 120, 60_000);
      if (!rate.ok) {
        return apiError('RATE_LIMITED', 'Too many preview requests. Please wait a moment.', {
          request,
        });
      }

      const url = new URL(request.url);
      const templateKey = url.searchParams.get('template');
      const accentKey = url.searchParams.get('accent');
      const densityRaw = url.searchParams.get('density');
      const pageSizeRaw = url.searchParams.get('pageSize');
      const hiddenRaw = url.searchParams.get('hiddenSections');
      const orderRaw = url.searchParams.get('sectionOrder');

      // An unrecognised value falls back to the stored one rather than
      // failing: a stale bookmark with `?template=wordart` should still render a
      // resume rather than error.
      const density =
        densityRaw !== null && DENSITY_VALUES.includes(Number(densityRaw) as 0 | 1 | 2)
          ? (Number(densityRaw) as 0 | 1 | 2)
          : undefined;

      const hiddenSections =
        hiddenRaw !== null
          ? hiddenRaw
              .split(',')
              .map((value) => value.trim())
              .filter((value): value is (typeof HIDABLE_SECTION_KEYS)[number] =>
                (HIDABLE_SECTION_KEYS as readonly string[]).includes(value),
              )
          : undefined;

      const requestedOrder = orderRaw?.split(',') ?? [];
      const sectionOrder = requestedOrder.length === RESUME_SECTION_KEYS.length &&
        new Set(requestedOrder).size === RESUME_SECTION_KEYS.length &&
        requestedOrder.every((value) => (RESUME_SECTION_KEYS as readonly string[]).includes(value))
        ? requestedOrder as ResumeSectionKey[]
        : undefined;

      try {
        const resume = await getResume({ userId, resumeId: id });
        const layout = await buildResumeLayoutFromRecord(resume, {
          templateKey: isTemplateKey(templateKey) ? templateKey : resume.templateKey,
          accentKey: isAccentKey(accentKey) ? accentKey : resume.accentKey,
          density: density ?? resume.density,
          pageSize: isPageSizeKey(pageSizeRaw) ? pageSizeRaw : resume.pageSize,
          hiddenSections: hiddenSections ?? resume.hiddenSections,
          sectionOrder: sectionOrder ?? resume.sectionOrder,
        });

        return privateNoStore(jsonOk({ layout: serialiseLayout(layout) }, request));
      } catch (error) {
        return resumeBuilderErrorResponse(error, request);
      }
    },
    { event: 'resume_preview_failed', route: ROUTE },
  );
}

export async function POST(request: Request, { params }: Params) {
  return handleRoute(
    async () => {
      const session = await auth();
      if (!session?.user?.id) return apiError('UNAUTHENTICATED', 'Please sign in.', { request });

      const userId = session.user.id;
      const { id } = await params;
      const rate = applyRateLimit(`${ROUTE}:${userId}:${getRequestIp(request)}`, 120, 60_000);
      if (!rate.ok) {
        return apiError('RATE_LIMITED', 'Too many preview requests. Please wait a moment.', { request });
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return apiError('BAD_REQUEST', 'That preview request was not valid.', { request });
      }

      const parsed = previewRequestSchema.safeParse(body);
      if (!parsed.success) {
        return apiError('VALIDATION_FAILED', 'Some resume details cannot be previewed yet.', { request });
      }

      try {
        const resume = await getResume({ userId, resumeId: id });
        const layout = await buildResumeLayout({
          content: parsed.data.content ?? resume.content,
          templateKey: parsed.data.templateKey ?? resume.templateKey,
          accentKey: parsed.data.accentKey ?? resume.accentKey,
          density: parsed.data.density ?? resume.density,
          hiddenSections: parsed.data.hiddenSections ?? resume.hiddenSections,
          sectionOrder: parsed.data.sectionOrder ?? resume.sectionOrder,
          pageSize: parsed.data.pageSize ?? resume.pageSize,
        });
        return privateNoStore(jsonOk({ layout: serialiseLayout(layout) }, request));
      } catch (error) {
        return resumeBuilderErrorResponse(error, request);
      }
    },
    { event: 'resume_draft_preview_failed', route: ROUTE },
  );
}
