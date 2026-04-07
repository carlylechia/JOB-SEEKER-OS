import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logImportantError, logImportantInfo } from "@/lib/observability";
import { setPendingPublicJobId } from "@/lib/pending-public-job";
import { buildStoredJobPayload, getUserPreferences } from "@/lib/db-helpers";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const session = await auth();

  try {
    if (!session?.user?.id) {
      await setPendingPublicJobId(id);
      return NextResponse.redirect(
        new URL("/login?callbackUrl=/auth/continue", request.url),
      );
    }

    const sourceJob = await prisma.jobLead.findFirst({
      where: { id },
    });

    if (!sourceJob) {
      return NextResponse.json(
        { error: "Public job not found" },
        { status: 404 },
      );
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

    await logImportantInfo({
      event: "public_job_saved_to_workspace",
      userId: session.user.id,
      jobId: cloned.id,
      route: `/api/public-jobs/${id}/save`,
      context: {
        sourceJobId: id,
      },
    });

    return NextResponse.json({ ok: true, jobId: cloned.id });
  } catch (error) {
    await logImportantError({
      event: "public_job_save_failed",
      userId: session?.user?.id,
      jobId: id,
      route: `/api/public-jobs/${id}/save`,
      error,
    });

    return NextResponse.json(
      { error: "Unable to save public job" },
      { status: 500 },
    );
  }
}
