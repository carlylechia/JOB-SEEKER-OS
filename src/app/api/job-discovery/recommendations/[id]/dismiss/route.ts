import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { jsonError, jsonOk } from '@/lib/api';

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return jsonError('Unauthorized', 401, undefined, request);
  const userId = session.user.id;
  const { id } = await params;
  const rec = await prisma.dailyJobRecommendation.findFirst({ where: { id, userId } });
  if (!rec) return jsonError('Not found', 404, undefined, request);
  await prisma.dailyJobRecommendation.update({ where: { id }, data: { status: 'DISMISSED' } });
  return jsonOk({ ok: true }, request);
}
