import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { cache } from 'react';
import { auth } from '@/auth';
import { AppShell } from '@/components/layout/app-shell';
import { prisma } from '@/lib/prisma';

const getProfileStatus = cache(async (userId: string) => {
  return prisma.userProfile.findUnique({
    where: { userId },
    select: { onboardingCompleted: true, profilePictureUrl: true },
  });
});

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login');
  }

  const headersList = await headers();
  const pathname = headersList.get('x-pathname') ?? '';

  // Onboarding page lives here but gets a clean full-screen layout (no AppShell)
  if (pathname.startsWith('/onboarding')) {
    return <>{children}</>;
  }

  // All other (app) routes require completed onboarding
  const profile = await getProfileStatus(session.user.id);
  if (!profile?.onboardingCompleted) {
    redirect('/onboarding');
  }

  const userWithAvatar = {
    ...session.user,
    image: profile?.profilePictureUrl ?? session.user.image ?? null,
  };

  return <AppShell user={userWithAvatar}>{children}</AppShell>;
}
