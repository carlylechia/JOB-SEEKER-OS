import { Suspense } from 'react';
import Link from 'next/link';
import { FileText } from 'lucide-react';

import { requireUser } from '@/lib/authz';
import { getEntitlements } from '@/lib/billing/subscriptions';
import { prisma } from '@/lib/prisma';
import { CareerProfileReview } from '@/components/resume/career-profile-review';
import { PlanRequiredCard } from '@/components/billing/plan-required-card';
import { CAREER_PROFILE_FEATURE } from '@/lib/resume/service';
import { RESUME_FORMATS } from '@/lib/resume/limits';
import { getCareerProfile } from '@/lib/resume/career-profile';
import { ResumeAnalysisCta } from '@/components/resume/resume-analysis-cta';

/**
 * Career profile overview and extraction review.
 *
 * Server-rendered: the shell, entitlement decision, saved profile and
 * extraction choice all happen here, so a visitor with no JavaScript still
 * gets a real answer rather than a spinner.
 */
export const dynamic = 'force-dynamic';

export default async function CareerProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ extraction?: string }>;
}) {
  const user = await requireUser();
  const { extraction } = await searchParams;

  const [entitlements, profile, documents, latestExtraction] = await Promise.all([
    getEntitlements(user.id),
    getCareerProfile(user.id),
    prisma.resumeDocument.findMany({
      where: { userId: user.id },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, fileName: true },
    }),
    prisma.resumeExtraction.findFirst({
      where: { userId: user.id, status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
      select: { id: true },
    }),
  ]);

  const canUseCareerProfile = entitlements.features[CAREER_PROFILE_FEATURE];

  // An explicit id is used only if it belongs to this user. Anything else falls
  // back to their most recent completed extraction, so a shared or guessed
  // link can never surface someone else's review.
  const requested = extraction
    ? await prisma.resumeExtraction.findFirst({
        where: { id: extraction, userId: user.id, status: 'COMPLETED' },
        select: { id: true },
      })
    : null;
  const extractionId = requested?.id ?? latestExtraction?.id ?? null;

  if (!canUseCareerProfile) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="title">Career profile</h1>
          <p className="muted mt-1">
            Turn your resume into structured, editable career data you can reuse across every
            application.
          </p>
        </div>
        <PlanRequiredCard
          feature={CAREER_PROFILE_FEATURE}
          currentPlan={entitlements.plan}
          isTrialing={entitlements.isTrialing}
        />
        {profile?.careerProfileConfirmedAt ? (
          <p className="muted">
            You have already built a career profile. It is safe — nothing has been deleted, and it
            will be here when your plan supports it again.
          </p>
        ) : (
          <p className="muted">
            Resume upload, download and replacement stay available on every plan.
          </p>
        )}
      </div>
    );
  }

  if (profile?.careerProfileConfirmedAt && !requested) {
    return (
      <div className="space-y-6 pb-4">
        <div>
          <h1 className="title">Your career profile</h1>
          <p className="muted mt-1">
            Your confirmed career history is saved and ready to reuse in tailored resumes and
            application materials.
          </p>
        </div>

        <section className="card-pad space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-ink">Work experience</h2>
              <p className="muted mt-1">
                {profile.experiences.length} roles · {profile.skills.length} skills ·{' '}
                {profile.education.length} qualifications
              </p>
            </div>
            <Link href="/resumes" className="btn-primary text-xs">
              Build a resume
            </Link>
          </div>

          {profile.experiences.length > 0 ? (
            <ul className="divide-y divide-line">
              {profile.experiences.slice(0, 5).map((experience) => (
                <li key={experience.id} className="py-3 first:pt-0 last:pb-0">
                  <p className="text-sm font-medium text-ink">
                    {experience.jobTitle}
                    {experience.company ? ` · ${experience.company}` : ''}
                  </p>
                  <p className="muted mt-1 text-xs">
                    {[experience.startDate, experience.isCurrent ? 'Present' : experience.endDate]
                      .filter(Boolean)
                      .join(' – ')}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted text-sm">No work experience has been added yet.</p>
          )}

          {profile.skills.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-medium text-ink-2">Skills</h3>
              <ul className="flex flex-wrap gap-2">
                {profile.skills.slice(0, 20).map((skill) => (
                  <li key={skill.id} className="rounded-full bg-surface-sunken px-2.5 py-1 text-xs text-ink-2">
                    {skill.name}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <ResumeAnalysisCta hasResume={documents.length > 0} />
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="title">Career profile</h1>
          <p className="muted mt-1">Build a structured profile from a resume you already have.</p>
        </div>
        <div className="card-pad text-center">
          <FileText className="mx-auto mb-3 h-8 w-8 text-muted" aria-hidden="true" />
          <p className="text-sm font-medium text-ink">No resume uploaded yet</p>
          <p className="muted mx-auto mt-1 max-w-sm">
            Upload a {RESUME_FORMATS.map((f) => f.toUpperCase()).join(', ')} resume and we will
            read it into an editable career profile.
          </p>
          <Link href="/profile" className="btn-primary mt-4 text-xs">
            Upload a resume
          </Link>
        </div>
      </div>
    );
  }

  if (!extractionId) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="title">Career profile</h1>
          <p className="muted mt-1">
            Analyse one of your resumes and we will show you everything we found, with the evidence
            for each item.
          </p>
        </div>
        <div className="card-pad text-center">
          <FileText className="mx-auto mb-3 h-8 w-8 text-muted" aria-hidden="true" />
          <p className="text-sm font-medium text-ink">Nothing analysed yet</p>
          <p className="muted mx-auto mt-1 max-w-sm">
            Pick a resume and run an analysis. It usually takes under a minute.
          </p>
        </div>
        <ResumeAnalysisCta hasResume />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-4">
      <Suspense fallback={<p className="muted py-8 text-center">Loading your review…</p>}>
        <CareerProfileReview extractionId={extractionId} />
      </Suspense>
    </div>
  );
}