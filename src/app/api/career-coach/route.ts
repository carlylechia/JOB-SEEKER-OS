import { auth } from '@/auth';
import { jsonError, jsonOk } from '@/lib/api';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { runCareerCoach } from '@/lib/career-queue/coach';
import { PlanRequiredError } from '@/lib/billing/subscriptions';
import { UsageLimitExceededError } from '@/lib/billing/usage';
import { logImportantInfo, logImportantError } from '@/lib/observability';

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return jsonError('Unauthorized', 401, undefined, request);

  const rate = applyRateLimit(`career-coach:${session.user.id}:${getRequestIp(request)}`, 10, 60_000);
  if (!rate.ok) return jsonError('Too many requests', 429, undefined, request);

  try {
    const body = await request.json();
    const question = String(body.question ?? '').trim();
    if (!question) return jsonError('Question is required.', 400, undefined, request);

    const result = await runCareerCoach(session.user.id, question, '/api/career-coach');
    return jsonOk({ result }, request);
  } catch (error) {
    if (error instanceof PlanRequiredError) return jsonError(error.message, 403, undefined, request);
    if (error instanceof UsageLimitExceededError) return jsonError(error.message, 403, undefined, request);
    await logImportantError({ event: 'career_coach_request_failed', userId: session.user.id, route: '/api/career-coach', error });
    return jsonError('Unable to run career coach.', 500, undefined, request);
  }
}
