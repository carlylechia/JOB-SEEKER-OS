import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  await prisma.userProfile.update({
    where: { userId: session.user.id },
    data: {
      currentLevel: body.currentLevel,
      targetLevel: body.targetLevel,
      targetRoles: body.targetRoles,
      preferredRegions: body.preferredRegions,
      preferredTitles: body.preferredTitles,
      preferredStack: body.preferredStack,
      mustHaveTech: body.mustHaveTech,
      workRegions: body.workRegions,
      remoteOnly: body.remoteOnly,
      salaryMin: body.salaryMin,
      salaryTarget: body.salaryTarget,
      timezoneToleranceHours: body.timezoneToleranceHours,
    },
  });

  return NextResponse.json({ ok: true });
}
