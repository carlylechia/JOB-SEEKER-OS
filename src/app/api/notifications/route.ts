import { auth } from '@/auth';
import { jsonOk, jsonError } from '@/lib/api';
import { getUserNotifications } from '@/lib/notifications';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';

export async function GET(request: Request) {
  const rl = applyRateLimit(`notif:${getRequestIp(request)}`, 30, 60_000);
  if (!rl.ok) return jsonError('Too many requests', 429);

  const session = await auth();
  if (!session?.user?.id) return jsonError('Unauthorized', 401);

  const notifications = await getUserNotifications(session.user.id);
  return jsonOk({ notifications });
}
