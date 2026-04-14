import { auth } from '@/auth';
import { jsonOk, jsonError } from '@/lib/api';
import { touchStreak } from '@/lib/streak';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';

export async function POST(request: Request) {
  const rl = applyRateLimit(`streak:${getRequestIp(request)}`, 60, 60_000);
  if (!rl.ok) return jsonError('Too many requests', 429);

  const session = await auth();
  if (!session?.user?.id) return jsonError('Unauthorized', 401);

  const { streakCount, changed } = await touchStreak(session.user.id);
  return jsonOk({ streakCount, changed });
}
