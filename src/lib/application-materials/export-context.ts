import { prisma } from '@/lib/prisma';
import { resumeContentSchema } from '@/lib/resume-builder/schema';
import { isPageSizeKey, type PageSizeKey } from '@/lib/resume-builder/templates';
import type { LetterApplicant } from './letter-layout';

export type MaterialExportContext = {
  applicant: LetterApplicant;
  company: string | null;
  jobTitle: string | null;
  pageSize: PageSizeKey;
};

/** Add only saved, owner-scoped details to application-material exports. */
export async function buildMaterialExportContext(params: {
  userId: string;
  resume: { userId: string; content: unknown; pageSize: string } | null;
  job: { userId: string; title: string; company: string } | null;
}): Promise<MaterialExportContext> {
  const [user, profile] = await Promise.all([
    prisma.user.findUnique({ where: { id: params.userId }, select: { name: true, email: true } }),
    prisma.userProfile.findUnique({
      where: { userId: params.userId },
      select: { phone: true, location: true, linkedinUrl: true, portfolioUrl: true, websiteUrl: true },
    }),
  ]);

  const source = params.resume?.userId === params.userId
    ? resumeContentSchema.safeParse(params.resume.content)
    : null;
  const basics = source?.success ? source.data.basics : null;
  const applicant: LetterApplicant = {
    name: basics?.fullName || user?.name || null,
    email: basics?.email || user?.email || null,
    phone: basics?.phone || profile?.phone || null,
    location: basics?.location || profile?.location || null,
    links: [
      basics?.linkedinUrl || profile?.linkedinUrl,
      basics?.portfolioUrl || profile?.portfolioUrl,
      basics?.websiteUrl || profile?.websiteUrl,
    ].filter((value): value is string => Boolean(value)),
  };
  return {
    applicant,
    company: params.job?.userId === params.userId ? params.job.company : null,
    jobTitle: params.job?.userId === params.userId ? params.job.title : null,
    pageSize: params.resume?.userId === params.userId && isPageSizeKey(params.resume.pageSize)
      ? params.resume.pageSize
      : 'A4',
  };
}
