import { auth } from '@/auth';
import { jsonError, jsonOk } from '@/lib/api';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { generateDailyQueue } from '@/lib/queue-engine';
import { enhanceQueue } from '@/lib/queue-ai';
import { logImportantInfo, logImportantError } from '@/lib/observability';

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return jsonError('Unauthorized', 401, undefined, request);

  const rate = applyRateLimit(`queue:${session.user.id}:${getRequestIp(request)}`, 30, 60_000);
  if (!rate.ok) return jsonError('Too many requests', 429, undefined, request);

  try {
    const rawQueue = await generateDailyQueue(session.user.id);
    const queue = enhanceQueue(rawQueue);

    await logImportantInfo({
      event: 'queue_generated',
      userId: session.user.id,
      route: '/api/queue',
      context: { count: queue.length, types: queue.map((q) => q.type) },
    });

    return jsonOk({ queue }, request);
  } catch (error) {
    await logImportantError({
      event: 'queue_failed',
      userId: session.user.id,
      route: '/api/queue',
      error,
    });
    return jsonError('Unable to generate queue.', 500, undefined, request);
  }
}
