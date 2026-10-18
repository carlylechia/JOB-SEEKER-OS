import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { cache } from 'react';
import { auth } from '@/auth';
import { AppShell } from '@/components/layout/app-shell';
import { TrialBanner } from '@/components/billing/trial-countdown';
import { getEffectiveSubscription } from '@/lib/billing/subscriptions';
import { prisma } from '@/lib/prisma';

const getProfileStatus = cache(async (userId: string) => {
  return prisma.userProfile.findUnique({
    where: { userId },
    select: { onboardingCompleted: true, profilePictureUrl: true },
  });
});

/**
 * Billing state is resolved once per request on the server and passed down.
 * The client only renders it — it never decides access.
 */
const getBillingBanner = cache(async (userId: string) => {
  const effective = await getEffectiveSubscription(userId);
  return {
    isAdmin: effective.isAdmin,
    isTrialing: effective.isTrialing,
    trialExpired: effective.trialExpired,
    trialEndsAt: effective.trialEndsAt?.toISOString() ?? null,
  };
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

  // Role is read fresh from the database, never from a stale JWT claim.
  const [dbUser, billing] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    }),
    getBillingBanner(session.user.id),
  ]);

  const userWithAvatar = {
    ...session.user,
    image: profile?.profilePictureUrl ?? session.user.image ?? null,
    role: dbUser?.role ?? 'USER',
  };

  const showTrialBanner = !billing.isAdmin && Boolean(billing.trialEndsAt);

  return (
    <AppShell user={userWithAvatar}>
      {showTrialBanner && billing.trialEndsAt ? (
        <TrialBanner
          trialEndsAt={billing.trialEndsAt}
          isTrialing={billing.isTrialing}
          trialExpired={billing.trialExpired}
        />
      ) : null}
      {children}
    </AppShell>
  );
}
