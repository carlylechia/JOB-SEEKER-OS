import { auth } from '@/auth';
import { jsonError, jsonOk } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { ingestJobInput } from '@/lib/ingestion';
import { JobIngestionAiError } from '@/lib/job-ingestion/ai-client';
import { ImageValidationError, validateIngestionImages } from '@/lib/job-ingestion/images';
import { ingestJobSchema } from '@/lib/onboarding-schema';
import { logImportantError, logImportantInfo } from '@/lib/observability';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return jsonError('Unauthorized', 401, undefined, request);

  const rate = applyRateLimit(`jobs:ingest:${session.user.id}:${getRequestIp(request)}`, 8, 60_000);
  if (!rate.ok) return jsonError('Too many requests', 429, undefined, request);

  try {
    const body = await request.json();
    const parsed = ingestJobSchema.safeParse(body);

    if (!parsed.success) {
      return jsonError('Invalid ingestion payload', 422, parsed.error.issues.map((issue) => issue.message), request);
    }

    let images;
    try {
      images = validateIngestionImages(parsed.data.images);
    } catch (error) {
      if (error instanceof ImageValidationError) {
        return jsonError(error.message, 422, undefined, request);
      }
      throw error;
    }

    const result = await ingestJobInput({ ...parsed.data, images });

    await logImportantInfo({
      event: 'job_ingested',
      userId: session.user.id,
      route: '/api/ingest-job',
      context: {
        mode: result.sourceMode,
        usedUrl: Boolean(parsed.data.jobUrl),
        images: result.imageCount,
        aiUsed: result.ai.used,
        model: result.ai.model,
        fallbackReason: result.ai.fallbackReason,
      },
    });

    return jsonOk(result, request);
  } catch (error) {
    if (error instanceof JobIngestionAiError) {
      return jsonError(error.userMessage, 503, [error.code], request);
    }

    await logImportantError({
      event: 'job_ingest_failed',
      userId: session.user.id,
      route: '/api/ingest-job',
      error,
      context: { method: 'POST' },
    });
    return jsonError('Unable to parse the job input right now.', 500, undefined, request);
  }
}
