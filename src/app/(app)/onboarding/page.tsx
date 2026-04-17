import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { OnboardingShell } from '@/components/onboarding/onboarding-shell';
import type { SeniorityLevel } from '@/types';

export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login');
  }

  const [user, profile, titleOptions] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { name: true, email: true, linkedinId: true },
    }),
    prisma.userProfile.findUnique({
      where: { userId: session.user.id },
      select: {
        onboardingStep: true,
        onboardingCompleted: true,
        onboardingSkipped: true,
        profilePictureUrl: true,
        resumeUrl: true,
        preferredTitles: true,
        preferredStack: true,
        salaryMin: true,
        salaryTarget: true,
        currentLevel: true,
        targetLevel: true,
        timezoneMatches: true,
        remotePreference: true,
        location: true,
        linkedinPhotoUrl: true,
        linkedinUrl: true,
        githubUrl: true,
        portfolioUrl: true,
        headline: true,
      },
    }),
    prisma.jobTitle.findMany({ orderBy: { name: 'asc' }, select: { name: true } }),
  ]);

  if (profile?.onboardingCompleted && !profile?.onboardingSkipped) {
    redirect('/dashboard');
  }

  const initialData = {
    name: user?.name ?? '',
    email: user?.email ?? '',
    isLinkedinUser: Boolean(user?.linkedinId),
    linkedinPhotoUrl: profile?.linkedinPhotoUrl ?? '',
    currentStep: profile?.onboardingStep ?? 1,
    profilePictureUrl: profile?.profilePictureUrl ?? '',
    location: profile?.location ?? '',
    remotePreference: (profile?.remotePreference ?? 'REMOTE') as 'REMOTE' | 'HYBRID' | 'ONSITE' | 'FLEXIBLE',
    timezones: profile?.timezoneMatches ?? [],
    resumeUrl: profile?.resumeUrl ?? '',
    jobTitles: profile?.preferredTitles ?? [],
    skills: profile?.preferredStack ?? [],
    salaryMin: profile?.salaryMin ?? 0,
    salaryTarget: profile?.salaryTarget ?? 0,
    currentLevel: (profile?.currentLevel ?? 'MID') as SeniorityLevel,
    targetLevel: (profile?.targetLevel ?? 'MID') as SeniorityLevel,
    titleOptions: titleOptions.map((t) => t.name),
    linkedinUrl: profile?.linkedinUrl ?? '',
    githubUrl: profile?.githubUrl ?? '',
    portfolioUrl: profile?.portfolioUrl ?? '',
    headline: profile?.headline ?? '',
  };

  return <OnboardingShell initialData={initialData} />;
}

