import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  BookOpenCheck,
  FileBadge,
  FileText,
  HelpCircle,
  Landmark,
  Mail,
  Search,
  Sparkles,
  UserRound,
  type LucideIcon,
} from 'lucide-react';

import { requireUser } from '@/lib/authz';
import { getEntitlements } from '@/lib/billing/subscriptions';
import { prisma } from '@/lib/prisma';
import { PageHeader } from '@/components/shared/page-header';
import type { FeatureKey } from '@/lib/billing/plans';

export const metadata: Metadata = {
  title: 'Application Studio — teChia Jobs',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

type StudioModule = {
  href: string;
  title: string;
  description: string;
  icon: LucideIcon;
  stat: string;
  action: string;
  feature?: FeatureKey;
};

type StudioSection = {
  title: string;
  description: string;
  modules: StudioModule[];
};

export default async function StudioPage() {
  const user = await requireUser();

  const [
    entitlements,
    profile,
    experienceCount,
    skillCount,
    resumeCount,
    uploadCount,
    materialCount,
    coverLetterCount,
    prepPackCount,
    templateCount,
  ] = await Promise.all([
    getEntitlements(user.id),
    prisma.userProfile.findUnique({
      where: { userId: user.id },
      select: { careerProfileConfirmedAt: true, headline: true },
    }),
    prisma.careerExperience.count({ where: { userId: user.id } }),
    prisma.careerSkill.count({ where: { userId: user.id, confirmed: true } }),
    prisma.structuredResume.count({ where: { userId: user.id } }),
    prisma.resumeDocument.count({ where: { userId: user.id } }),
    prisma.applicationMaterial.count({ where: { userId: user.id } }),
    prisma.applicationMaterial.count({
      where: { userId: user.id, type: 'COVER_LETTER' },
    }),
    prisma.interviewPrepPack.count({ where: { userId: user.id } }),
    prisma.followUpTemplate.count({ where: { userId: user.id } }),
  ]);

  const profileReady = Boolean(profile?.careerProfileConfirmedAt);
  const foundationStat = profileReady
    ? `${experienceCount} role${experienceCount === 1 ? '' : 's'} · ${skillCount} verified skill${
        skillCount === 1 ? '' : 's'
      }`
    : experienceCount > 0
      ? `${experienceCount} role${experienceCount === 1 ? '' : 's'} awaiting confirmation`
      : 'Not started';

  const sections: StudioSection[] = [
    {
      title: 'Candidate foundation',
      description:
        'Everything generated later is grounded in this material. Confirm it once, reuse it everywhere.',
      modules: [
        {
          href: '/career-profile',
          title: 'Career profile',
          description:
            'Your confirmed roles, skills, education and achievements. This is the source of truth for every tailored document.',
          icon: UserRound,
          stat: foundationStat,
          action: profileReady ? 'Review profile' : 'Confirm profile',
          feature: 'CAREER_PROFILE_INTELLIGENCE',
        },
        {
          href: '/resumes',
          title: 'Resume library',
          description:
            'Your master resume, uploaded source documents and every independently editable variant.',
          icon: FileBadge,
          stat: `${resumeCount} structured · ${uploadCount} uploaded`,
          action: 'Open library',
          feature: 'RESUME_BUILDER',
        },
        {
          href: '/career-profile',
          title: 'Resume intelligence',
          description:
            'Extract structured facts from an uploaded resume, review conflicts and promote only what you confirm.',
          icon: Search,
          stat: uploadCount > 0 ? `${uploadCount} document${uploadCount === 1 ? '' : 's'} available` : 'Upload a resume to begin',
          action: 'Analyse a resume',
          feature: 'AI_RESUME_PARSER',
        },
      ],
    },
    {
      title: 'Application writing',
      description:
        'Job-specific material, generated from verified facts and saved beside the opportunity it belongs to.',
      modules: [
        {
          href: '/resumes',
          title: 'Resume tailoring',
          description:
            'Create a job-specific version that preserves your master resume and keeps every revision.',
          icon: Sparkles,
          stat: resumeCount > 0 ? `${resumeCount} document${resumeCount === 1 ? '' : 's'} ready to tailor` : 'Build a master resume first',
          action: 'Tailor a resume',
          feature: 'RESUME_OPTIMIZATION',
        },
        {
          href: '/application-materials',
          title: 'Cover letters & messages',
          description:
            'Cover letters, recruiter outreach, follow-ups, connection notes and thank-you messages.',
          icon: Mail,
          stat:
            materialCount > 0
              ? `${coverLetterCount} cover letter${coverLetterCount === 1 ? '' : 's'} · ${materialCount} total`
              : 'No drafts yet',
          action: 'Open writing library',
          feature: 'AI_COVER_LETTER',
        },
        {
          href: '/jobs',
          title: 'Screening answers',
          description:
            'Answers are prepared inside each application workspace, with evidence and a confirmation step before use.',
          icon: HelpCircle,
          stat: 'Contextual per application',
          action: 'Open a job workspace',
        },
        {
          href: '/templates',
          title: 'Templates',
          description:
            'Reusable structures for follow-ups and outreach that generated material can build on.',
          icon: FileText,
          stat: `${templateCount} template${templateCount === 1 ? '' : 's'}`,
          action: 'Manage templates',
        },
      ],
    },
    {
      title: 'Research & interviews',
      description:
        'Know the employer, predict the conversation and practise with your own evidence.',
      modules: [
        {
          href: '/interview-prep',
          title: 'Company research',
          description:
            'Source-backed company context used to sharpen your answers, with citations and honest limitations.',
          icon: Landmark,
          stat: prepPackCount > 0 ? `${prepPackCount} preparation pack${prepPackCount === 1 ? '' : 's'}` : 'No research packs yet',
          action: 'Open research',
          feature: 'AI_INTERVIEW_PREP',
        },
        {
          href: '/interview-prep',
          title: 'Interview preparation',
          description:
            'Role-specific questions, STAR coaching, mock sessions and feedback that tracks recurring weaknesses.',
          icon: BookOpenCheck,
          stat: prepPackCount > 0 ? `${prepPackCount} pack${prepPackCount === 1 ? '' : 's'} in progress` : 'Prepare for your next interview',
          action: 'Prepare for an interview',
          feature: 'AI_INTERVIEW_PREP',
        },
      ],
    },
  ];

  return (
    <div className="space-y-8 pb-6">
      <PageHeader
        title="Application Studio"
        subtitle="One workspace for the material that wins the application: your evidence, your documents, your research and your interview preparation."
        action={
          <Link href="/jobs" className="btn-primary gap-1.5 text-sm">
            <Search className="h-3.5 w-3.5" /> Find a job to prepare
          </Link>
        }
      />

      <div className="rounded-2xl border border-line bg-surface px-5 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-ink">Prepare once, reuse everywhere</p>
            <p className="mt-1 max-w-2xl text-sm text-muted">
              Open any saved job to prepare its materials with one action. The studio is where
              you maintain the underlying profile, documents and research.
            </p>
          </div>
          <Link href="/pipeline" className="btn-secondary shrink-0 gap-1.5 text-sm">
            View applications <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {sections.map((section) => (
        <section key={section.title} className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold text-ink">{section.title}</h2>
            <p className="mt-1 text-sm text-muted">{section.description}</p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {section.modules.map((module) => {
              const Icon = module.icon;
              const locked = module.feature ? !entitlements.features[module.feature] : false;
              return (
                <Link
                  key={`${section.title}-${module.title}`}
                  href={module.href}
                  className="group flex min-w-0 flex-col rounded-2xl border border-line bg-surface p-5 transition-colors hover:border-line-strong hover:bg-surface-hover"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-sunken text-accent-text">
                      <Icon className="h-4 w-4" />
                    </span>
                    {locked ? (
                      <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                        Pro
                      </span>
                    ) : null}
                  </div>
                  <h3 className="mt-4 font-semibold text-ink">{module.title}</h3>
                  <p className="mt-1 flex-1 text-sm leading-6 text-muted">{module.description}</p>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
                    <span className="text-xs text-muted">{module.stat}</span>
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-accent-text">
                      {module.action}
                      <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
