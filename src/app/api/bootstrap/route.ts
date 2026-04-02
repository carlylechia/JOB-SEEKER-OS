import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getUserWorkspace } from '@/lib/db-helpers';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const workspace = await getUserWorkspace(session.user.id);
  return NextResponse.json(workspace);
}
