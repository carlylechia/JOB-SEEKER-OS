import { auth } from '@/auth';
import { jsonError, jsonOk } from '@/lib/api';
import { handleOptions } from '@/lib/cors';
import { prisma } from '@/lib/prisma';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';
import { z } from 'zod';

const bodySchema = z.object({
  skill: z.string().trim().min(1).max(80),
  list: z.enum(['preferredStack', 'mustHaveTech']).optional().default('preferredStack'),
});

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return jsonError('Unauthorized', 401, undefined, request);
  }

  const rate = applyRateLimit(
    `preferences:skills:${session.user.id}:${getRequestIp(request)}`,
    30,
    60_000,
  );
  if (!rate.ok) {
    return jsonError('Too many requests', 429, undefined, request);
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch {
    return jsonError('Invalid skill payload', 422, undefined, request);
  }

  const profile = await prisma.userProfile.findUnique({
    where: { userId: session.user.id },
    select: { preferredStack: true, mustHaveTech: true },
  });

  const key = parsed.list;
  const current = (profile?.[key] ?? []) as string[];
  const normalized = parsed.skill.trim();
  if (current.some((item) => item.toLowerCase() === normalized.toLowerCase())) {
    return jsonOk({ ok: true, added: false }, request);
  }

  const next = [...current, normalized].slice(0, key === 'preferredStack' ? 20 : 12);

  await prisma.userProfile.update({
    where: { userId: session.user.id },
    data: { [key]: next },
  });

  return jsonOk({ ok: true, added: true }, request);
}
