import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { PageHeader } from '@/components/shared/page-header';
import { OnboardingForm } from '@/components/onboarding/onboarding-form';
import { getUserWorkspace } from '@/lib/db-helpers';

export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login');
  }

  const workspace = await getUserWorkspace(session.user.id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Welcome to Job Seeker OS"
        subtitle="Set your level, regions, salary targets, and stack preferences so ranking and future recommendations reflect your real search goals."
      />
      <OnboardingForm initialPreferences={workspace.preferences} onboardingCompleted={workspace.onboardingCompleted} />
    </div>
  );
}
