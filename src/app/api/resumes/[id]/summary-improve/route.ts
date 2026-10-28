import { auth } from '@/auth';
import { apiError, handleRoute, jsonOk, privateNoStore } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { getEntitlements } from '@/lib/billing/subscriptions';
import { prisma } from '@/lib/prisma';
import { getResume } from '@/lib/resume-builder/documents';
import { buildResumeLayoutFromRecord } from '@/lib/resume-builder/serve';
import { serialiseLayout, serialiseResumeDetail } from '@/lib/resume-builder/wire';
import { resumeContentSchema } from '@/lib/resume-builder/schema';
import OpenAI from 'openai';
import { z } from 'zod';
import { zodTextFormat } from 'openai/helpers/zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/resumes/[id]/summary-improve';
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;

const summarySchema = z.object({ summary: z.string().min(1).max(600) });

type Params = { params: Promise<{ id: string }> };

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

export async function POST(request: Request, { params }: Params) {
  return handleRoute(
    async () => {
      const session = await auth();
      if (!session?.user?.id) return apiError('UNAUTHENTICATED', 'Please sign in.', { request });

      const userId = session.user.id;
      const { id } = await params;

      const rate = applyRateLimit(`${ROUTE}:${userId}:${getRequestIp(request)}`, RATE_LIMIT, RATE_WINDOW_MS);
      if (!rate.ok) return apiError('RATE_LIMITED', 'Too many requests. Please wait a moment.', { request });

      const entitlements = await getEntitlements(userId);
      if (!entitlements.features.RESUME_OPTIMIZATION && !entitlements.isAdmin) {
        return apiError('FORBIDDEN', 'Summary improvement is available on Pro.', { request });
      }

      const resume = await getResume({ userId, resumeId: id });
      if (!resume.targetJobId) {
        return apiError('NOT_FOUND', 'Choose a target job first.', { request });
      }

      const job = await prisma.jobLead.findFirst({
        where: { id: resume.targetJobId, userId },
        select: { title: true, company: true, jobDescription: true },
      });
      if (!job) return apiError('NOT_FOUND', 'Target job not found.', { request });

      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) return apiError('AI_UNAVAILABLE', 'AI is not configured.', { request });

      const client = new OpenAI({ apiKey, timeout: 30000 });
      const model = process.env.RESUME_OPTIMIZATION_MODEL?.trim() || 'gpt-4.1-mini';

      const currentSummary = resume.content.summary || '';
      const jobText = [job.title, job.company, job.jobDescription || ''].join('\n').slice(0, 4000);

      let proposed = '';
      try {
        const response = await client.responses.parse({
          model,
          input: [
            {
              role: 'system',
              content:
                'You rewrite one professional summary for a specific job. Use only facts already in the resume summary or job description. Do not invent numbers, employers, credentials, or technologies. Return a concise 2-4 sentence summary.',
            },
            {
              role: 'user',
              content: `Current summary:\n${currentSummary}\n\nJob:\n${jobText}\n\nRewrite the summary to better fit this job without adding unsupported facts.`,
            },
          ],
          text: { format: zodTextFormat(summarySchema, 'summary') },
        });
        proposed = response.output_parsed?.summary?.trim() || '';
      } catch {
        return apiError('AI_UNAVAILABLE', 'Could not generate a summary.', { request });
      }

      if (!proposed) return apiError('AI_UNAVAILABLE', 'Could not generate a summary.', { request });

      const nextContent = { ...resume.content, summary: proposed };
      const validated = resumeContentSchema.parse(nextContent);

      await prisma.$transaction(async (tx) => {
        const result = await tx.structuredResume.updateMany({
          where: { id: resume.id, userId, revision: resume.revision },
          data: { content: validated as unknown as object, revision: { increment: 1 } },
        });
        if (result.count === 0) {
          throw new Error('stale');
        }
      });

      const updated = await getResume({ userId, resumeId: id });
      const layout = await buildResumeLayoutFromRecord(updated);

      return privateNoStore(
        jsonOk(
          {
            resume: serialiseResumeDetail(updated),
            layout: serialiseLayout(layout),
            appliedCount: 1,
          },
          request,
        ),
      );
    },
    { event: 'summary_improve_failed', route: ROUTE },
  );
}
