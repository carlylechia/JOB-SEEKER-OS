import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getPendingPublicJobId } from '@/lib/pending-public-job';
import { prisma } from '@/lib/prisma';

export default async function AuthContinuePage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect('/login');
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { profile: true },
  });

  const onboardingComplete = Boolean(user?.profile?.onboardingCompleted);

  if (!onboardingComplete) {
    redirect('/onboarding');
  }

  const pendingJobId = await getPendingPublicJobId();

  if (pendingJobId) {
    redirect(`/auth/continue/import?jobId=${pendingJobId}`);
  }

  redirect('/dashboard');
}