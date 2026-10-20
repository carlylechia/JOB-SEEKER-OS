import { auth } from '@/auth';
import { jsonError, jsonOk } from '@/lib/api';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { buildWeeklyReview } from '@/lib/career-queue/weekly-review';
import { logImportantInfo, logImportantError } from '@/lib/observability';

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return jsonError('Unauthorized', 401, undefined, request);

  const rate = applyRateLimit(`career-review:${session.user.id}:${getRequestIp(request)}`, 10, 60_000);
  if (!rate.ok) return jsonError('Too many requests', 429, undefined, request);

  try {
    const review = await buildWeeklyReview(session.user.id);
    await logImportantInfo({ event: 'career_weekly_review_generated', userId: session.user.id, route: '/api/career-review', context: { actionsCompleted: review.metrics.queueActionsCompleted } });
    return jsonOk({ review }, request);
  } catch (error) {
    await logImportantError({ event: 'career_weekly_review_failed', userId: session.user.id, route: '/api/career-review', error });
    return jsonError('Unable to build weekly review.', 500, undefined, request);
  }
}
