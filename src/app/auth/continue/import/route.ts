import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { clearPendingPublicJobId, getPendingPublicJobId } from "@/lib/pending-public-job";
import { clonePublicJobForUser } from "@/lib/public-jobs";
import { logImportantError, logImportantInfo } from "@/lib/observability";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const paramJobId = url.searchParams.get("jobId");
  const cookieJobId = await getPendingPublicJobId();
  const sourceJobId = paramJobId ?? cookieJobId;

  if (!sourceJobId) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  let targetJobId: string | null = null;
  let importError: unknown = null;

  try {
    targetJobId = await clonePublicJobForUser(sourceJobId, session.user.id);
  } catch (error) {
    importError = error;
  }

  // Cookie writes are allowed in Route Handlers
  await clearPendingPublicJobId();

  if (importError || !targetJobId) {
    await logImportantError({
      event: "pending_public_job_import_failed",
      userId: session.user.id,
      jobId: sourceJobId,
      route: "/auth/continue/import",
      error: importError,
    });
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  await logImportantInfo({
    event: "pending_public_job_imported",
    userId: session.user.id,
    jobId: targetJobId,
    route: "/auth/continue/import",
    context: { sourceJobId },
  });

  return NextResponse.redirect(new URL(`/jobs/${targetJobId}`, request.url));
}
