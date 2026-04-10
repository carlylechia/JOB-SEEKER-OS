import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { logImportantError, logImportantInfo } from "@/lib/observability";
import { setPendingPublicJobId } from "@/lib/pending-public-job";
import { clonePublicJobForUser } from "@/lib/public-jobs";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const session = await auth();

  try {
    // NOT AUTHENTICATED → store intent in cookie + redirect to login
    if (!session?.user?.id) {
      await setPendingPublicJobId(id);

      return NextResponse.redirect(
        new URL(
          `/login?callbackUrl=${encodeURIComponent(`/auth/continue/import?jobId=${id}`)}`,
          request.url
        )
      );
    }

    const jobId = await clonePublicJobForUser(id, session.user.id);

    await logImportantInfo({
      event: "public_job_saved_to_workspace",
      userId: session.user.id,
      jobId,
      route: `/api/public-jobs/${id}/save`,
      context: { sourceJobId: id },
    });

    return NextResponse.json({ ok: true, jobId });
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
      { status: 500 }
    );
  }
}
