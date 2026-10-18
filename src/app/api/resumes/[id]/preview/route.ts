/**
 * Preview layout.
 *
 *   GET /api/resumes/[id]/preview[?template=&accent=&density=&hiddenSections=]
 *
 * Returns the SAME layout blocks the PDF renderer consumes, so the preview is
 * the export rather than an approximation of it.
 *
 * No unsaved draft content is accepted here: this endpoint renders what is
 * STORED. Sending the whole document over on every keystroke to redraw a preview
 * would be a large request for a cosmetic gain, and it would open a second path
 * for unvalidated content to reach the renderer. The editor re-lays out from its
 * own state using the same engine through its own save response.
 *
 * Cost: none. No provider call, no credit, no storage.
 */

import { auth } from '@/auth';
import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { getResume } from '@/lib/resume-builder/documents';
import { buildResumeLayoutFromRecord } from '@/lib/resume-builder/serve';
import { resumeBuilderErrorResponse } from '@/lib/resume-builder/route-errors';
import { serialiseLayout } from '@/lib/resume-builder/wire';
import { DENSITY_VALUES, isAccentKey, isTemplateKey } from '@/lib/resume-builder/templates';
import { HIDABLE_SECTION_KEYS } from '@/lib/resume-builder/schema';

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
      const hiddenRaw = url.searchParams.get('hiddenSections');

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

      try {
        const resume = await getResume({ userId, resumeId: id });
        const layout = await buildResumeLayoutFromRecord(resume, {
          templateKey: isTemplateKey(templateKey) ? templateKey : resume.templateKey,
          accentKey: isAccentKey(accentKey) ? accentKey : resume.accentKey,
          density: density ?? resume.density,
          hiddenSections: hiddenSections ?? resume.hiddenSections,
        });

        return privateNoStore(jsonOk({ layout: serialiseLayout(layout) }, request));
      } catch (error) {
        return resumeBuilderErrorResponse(error, request);
      }
    },
    { event: 'resume_preview_failed', route: ROUTE },
  );
}