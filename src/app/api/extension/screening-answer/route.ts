import { auth } from '@/auth';
import { apiError, handleRoute, jsonOk } from '@/lib/api';
import { withCors, handleOptions } from '@/lib/cors';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import OpenAI from 'openai';
import { z } from 'zod';
import { getAiModel } from '@/lib/ai/model-registry';
import { isSensitiveQuestion, SENSITIVE_QUESTION_MESSAGE } from '@/lib/ai/sensitive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  question: z.string().trim().min(1).max(500),
  jobDescription: z.string().trim().max(8000).optional().default(''),
  profile: z.record(z.unknown()).optional().default({}),
});

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

export async function POST(request: Request) {
  return handleRoute(
    async () => {
      const session = await auth();
      if (!session?.user?.id) return withCors(apiError('UNAUTHENTICATED', 'Please sign in to teChia Jobs first.', { request }), request);

      const userId = session.user.id;
      const rate = applyRateLimit(`extension:screening:${userId}:${getRequestIp(request)}`, 20, 60_000);
      if (!rate.ok) return withCors(apiError('RATE_LIMITED', 'Too many requests.', { request }), request);

      let parsed: z.infer<typeof bodySchema>;
      try {
        parsed = bodySchema.parse(await request.json());
      } catch {
        return withCors(apiError('VALIDATION_FAILED', 'Invalid request.', { request }), request);
      }

      if (isSensitiveQuestion(parsed.question)) {
        return withCors(apiError('VALIDATION_FAILED', SENSITIVE_QUESTION_MESSAGE, { request }), request);
      }

      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) return withCors(apiError('AI_UNAVAILABLE', 'AI is not configured.', { request }), request);

      const client = new OpenAI({ apiKey, timeout: 30000 });
      const model = getAiModel('EXTENSION_AUTOFILL');

      const profileText = JSON.stringify(parsed.profile || {}).slice(0, 4000);
      const jobText = parsed.jobDescription.slice(0, 4000);

      let answer = '';
      try {
        const response = await client.responses.create({
          model,
          input: [
            {
              role: 'system',
              content:
                'You help a job applicant answer a screening question. Use only facts from the provided profile and job description. Do not invent employers, dates, or metrics. If unknown, say you do not have that information. Keep it concise (1-4 sentences).',
            },
            {
              role: 'user',
              content: `Profile:\n${profileText}\n\nJob description:\n${jobText}\n\nQuestion:\n${parsed.question}\n\nAnswer:`,
            },
          ],
        });
        answer = (response.output_text || '').trim();
      } catch {
        return withCors(apiError('AI_UNAVAILABLE', 'Could not generate an answer.', { request }), request);
      }

      if (!answer) return withCors(apiError('AI_UNAVAILABLE', 'Could not generate an answer.', { request }), request);

      return withCors(jsonOk({ answer }, request), request);
    },
    { event: 'extension_screening_failed', route: '/api/extension/screening-answer' },
  );
}
