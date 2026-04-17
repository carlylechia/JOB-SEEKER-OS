import { auth } from '@/auth';
import { jsonOk, jsonError } from '@/lib/api';
import { markNotificationRead, markAllNotificationsRead } from '@/lib/notifications';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { z } from 'zod';

const schema = z.object({
  id: z.string().optional(),
  all: z.boolean().optional(),
});

export async function PATCH(request: Request) {
  const rl = applyRateLimit(`notif-read:${getRequestIp(request)}`, 30, 60_000);
  if (!rl.ok) return jsonError('Too many requests', 429);

  const session = await auth();
  if (!session?.user?.id) return jsonError('Unauthorized', 401);

  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return jsonError('Invalid request', 400);

  const { id, all } = parsed.data;

  if (all) {
    await markAllNotificationsRead(session.user.id);
  } else if (id) {
    await markNotificationRead(id);
  } else {
    return jsonError('Provide id or all=true', 400);
  }

  return jsonOk({ ok: true });
}
