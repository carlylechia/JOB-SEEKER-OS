import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { requireUser } from '@/lib/authz';
import { getEntitlements } from '@/lib/billing/subscriptions';
import {
  StructuredResumeNotFoundError,
  getResume,
  listTargetableJobs,
} from '@/lib/resume-builder/documents';
import { buildResumeLayoutFromRecord } from '@/lib/resume-builder/serve';
import { RESUME_BUILDER_FEATURE } from '@/lib/resume-builder/entitlements';
import { ACCENT_PALETTE, DENSITY_LABELS, TEMPLATE_LIST } from '@/lib/resume-builder/templates';
import { ResumeEditor } from '@/components/resume-builder/resume-editor';

export const metadata: Metadata = {
  title: 'Resume — teChia Jobs',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

/**
 * The resume editor workspace.
 *
 * A server component that loads the private document, its layout and the
 * caller's targetable jobs with the session, then hands them to the client
 * editor. Loading here rather than in an effect means the editor renders with
 * real data on first paint, and — more importantly — that the ownership check
 * happens before any of the content reaches the browser at all.
 */
export default async function ResumeEditorPage({ params }: Props) {
  const user = await requireUser();
  const { id } = await params;

  const entitlements = await getEntitlements(user.id);

  let resume;
  try {
    resume = await getResume({ userId: user.id, resumeId: id });
  } catch (error) {
    // Another user's resume, or one that no longer exists: identical outcome,
    // because confirming the difference would leak that it exists.
    if (error instanceof StructuredResumeNotFoundError) notFound();
    throw error;
  }

  if (!entitlements.features[RESUME_BUILDER_FEATURE]) {
    return (
      <div className="space-y-4">
        <h1 className="title">This resume is part of Pro</h1>
        <p className="muted">
          The builder and PDF export are available on Pro. Your uploads, career profile, jobs and
          scoring are all unchanged.
        </p>
        <a href="/settings/billing" className="btn-primary">
          See plans
        </a>
      </div>
    );
  }

  const [layout, jobs] = await Promise.all([
    buildResumeLayoutFromRecord(resume),
    listTargetableJobs(user.id, 100),
  ]);

  return (
    <ResumeEditor
      resume={{
        id: resume.id,
        name: resume.name,
        templateKey: resume.templateKey,
        pageSize: resume.pageSize,
        accentKey: resume.accentKey,
        density: resume.density,
        hiddenSections: resume.hiddenSections,
        revision: resume.revision,
        targetJobId: resume.targetJobId,
        targetJob: resume.targetJob,
        content: resume.content,
      }}
      layout={layout}
      templates={TEMPLATE_LIST.map((template) => ({
        key: template.key,
        label: template.label,
        description: template.description,
        atsPrinciples: template.atsPrinciples,
      }))}
      accents={Object.entries(ACCENT_PALETTE).map(([key, tokens]) => ({
        key,
        accent: tokens.accent,
        accentDeep: tokens.accentDeep,
        textOnAccent: tokens.textOnAccent,
      }))}
      densities={DENSITY_LABELS}
      access={{
        canBuild: entitlements.features[RESUME_BUILDER_FEATURE],
        canOptimize: entitlements.features.RESUME_OPTIMIZATION,
        resumeLimit: entitlements.limits.resumes,
      }}
      targetableJobs={jobs.map((job) => ({
        id: job.id,
        title: job.title,
        company: job.company,
        status: job.status,
        hasDescription: job.hasDescription,
      }))}
    />
  );
}
