import type { Metadata } from 'next';

import { requireUser } from '@/lib/authz';
import { getEntitlements } from '@/lib/billing/subscriptions';
import {
  careerProfileSummary,
  countResumes,
  listResumes,
} from '@/lib/resume-builder/documents';
import { RESUME_BUILDER_FEATURE } from '@/lib/resume-builder/entitlements';
import { ResumeListClient } from '@/components/resume-builder/resume-list-client';
import { PageHeader } from '@/components/shared/page-header';

export const metadata: Metadata = {
  title: 'Resumes — teChia Jobs',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * The resume library.
 *
 * A server component: the user's own resumes, their plan limit and their career
 * profile readiness are all private data, so they are loaded with the session and
 * handed to the client rather than fetched after paint. The client component only
 * renders what it is given — it never decides access.
 */
export default async function ResumesPage() {
  const user = await requireUser();

  const [entitlements, resumes, profile, total] = await Promise.all([
    getEntitlements(user.id),
    listResumes(user.id),
    careerProfileSummary(user.id),
    countResumes(user.id),
  ]);

  const canBuild = entitlements.features[RESUME_BUILDER_FEATURE];
  const limit = entitlements.limits.resumes;

  return (
    <div className="space-y-6 pb-4">
      <PageHeader
        title="Resumes"
        subtitle={
          canBuild
            ? 'Build one resume and tailor versions of it for each role you apply to.'
            : 'The resume builder is available on Pro. Everything else in your workspace stays exactly as it is.'
        }
      />

      <ResumeListClient
        initialResumes={resumes.map((resume) => ({
          id: resume.id,
          name: resume.name,
          origin: resume.origin,
          targetJob: resume.targetJob,
          sourceResumeId: resume.sourceResumeId,
          updatedAt: resume.updatedAt.toISOString(),
          createdAt: resume.createdAt.toISOString(),
          hasContent:
            Boolean(resume.content.basics.fullName || resume.content.summary) ||
            resume.content.experiences.length > 0,
        }))}
        careerProfile={profile}
        access={{
          canBuild,
          canOptimize: entitlements.features.RESUME_OPTIMIZATION,
          plan: entitlements.plan,
          isAdmin: entitlements.isAdmin,
          isTrialing: entitlements.isTrialing,
          resumeLimit: limit,
          resumesUsed: total,
        }}
      />
    </div>
  );
}