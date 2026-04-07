import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  clearPendingPublicJobId,
  getPendingPublicJobId,
} from "@/lib/pending-public-job";
import { logImportantError, logImportantInfo } from "@/lib/observability";
import { buildStoredJobPayload, getUserPreferences } from "@/lib/db-helpers";

type Props = {
  searchParams: Promise<{ jobId?: string }>;
};

export default async function ImportPendingPublicJobPage({
  searchParams,
}: Props) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const params = await searchParams;
  const cookieJobId = await getPendingPublicJobId();
  const sourceJobId = params.jobId ?? cookieJobId;

  if (!sourceJobId) {
    redirect("/dashboard");
  }

  try {
    const sourceJob = await prisma.jobLead.findFirst({
      where: { id: sourceJobId },
    });

    if (!sourceJob) {
      await clearPendingPublicJobId();
      redirect("/jobs-public");
    }
    const preferences = await getUserPreferences(session.user.id);
    const jobPayload = buildStoredJobPayload(
      {
        company: sourceJob.company,
        title: sourceJob.title,
        source: sourceJob.source,
        jobUrl: sourceJob.jobUrl,
        location: sourceJob.location,
        remoteType: sourceJob.remoteType,
        timezoneRequirement: sourceJob.timezoneRequirement,
        eligibilityRegion: sourceJob.eligibilityRegion,
        salaryMin: sourceJob.salaryMin,
        salaryMax: sourceJob.salaryMax,
        currency: sourceJob.currency,
        notes: sourceJob.notes,
        dateFound: new Date().toISOString().slice(0, 10),
      },
      preferences,
    );

    const cloned = await prisma.jobLead.create({
      data: {
        userId: session.user.id,
        ...jobPayload, // ✅ includes score, checklist, etc
      },
    });

    await clearPendingPublicJobId();

    await logImportantInfo({
      event: "pending_public_job_imported",
      userId: session.user.id,
      jobId: cloned.id,
      route: "/auth/continue/import",
      context: { sourceJobId },
    });

    redirect(`/jobs/${cloned.id}`);
  } catch (error) {
    await logImportantError({
      event: "pending_public_job_import_failed",
      userId: session.user.id,
      jobId: sourceJobId,
      route: "/auth/continue/import",
      error,
    });

    await clearPendingPublicJobId();
    redirect("/dashboard");
  }
}
