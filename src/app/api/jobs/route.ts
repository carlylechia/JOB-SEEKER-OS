import { auth } from "@/auth";
import {
  buildStoredJobPayload,
  getUserPreferences,
  mapDbJob,
} from "@/lib/db-helpers";
import { handleOptions } from "@/lib/cors";
import { prisma } from "@/lib/prisma";
import { jobPayloadSchema } from "@/lib/job-schema";
import { applyRateLimit, getRequestIp } from "@/lib/rate-limit";
import { jsonError, jsonOk } from "@/lib/api";
import { logImportantError, logImportantInfo } from "@/lib/observability";

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id)
    return jsonError("Unauthorized", 401, undefined, request);

  const rate = applyRateLimit(
    `jobs:list:${session.user.id}:${getRequestIp(request)}`,
    60,
    60_000,
  );
  if (!rate.ok) return jsonError("Too many requests", 429, undefined, request);

  const jobs = await prisma.jobLead.findMany({
    where: { userId: session.user.id },
    orderBy: [{ updatedAt: "desc" }, { dateFound: "desc" }],
  });
  return jsonOk({ jobs: jobs.map(mapDbJob) }, request);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id)
    return jsonError("Unauthorized", 401, undefined, request);

  const rate = applyRateLimit(
    `jobs:create:${session.user.id}:${getRequestIp(request)}`,
    20,
    60_000,
  );
  if (!rate.ok) return jsonError("Too many requests", 429, undefined, request);

  try {
    const body = await request.json();
    const parsed = jobPayloadSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(
        "Invalid job payload",
        422,
        parsed.error.issues.map((issue) => issue.message),
        request,
      );
    }

    const preferences = await getUserPreferences(session.user.id);
    const job = buildStoredJobPayload(parsed.data as any, preferences);

    const created = await prisma.jobLead.create({
      data: {
        userId: session.user.id,
        company: job.company,
        title: job.title,
        source: job.source,
        jobUrl: job.jobUrl || null,
        location: job.location,
        remoteType: job.remoteType,
        timezoneRequirement: job.timezoneRequirement,
        eligibilityRegion: job.eligibilityRegion,
        salaryMin: job.salaryMin ?? null,
        salaryMax: job.salaryMax ?? null,
        currency: job.currency,
        notes: job.notes,
        status: job.status,
        dateFound: new Date(job.dateFound),
        dateApplied: job.dateApplied ? new Date(job.dateApplied) : null,
        nextFollowUp: job.nextFollowUp ? new Date(job.nextFollowUp) : null,
        priorityFlag: job.priorityFlag,
        score: job.score,
        checklist: job.checklist,
        contacts: job.contacts,
        interviews: job.interviews,
        prepPack: job.prepPack,
      },
    });

    await logImportantInfo({
      event: "job_created",
      userId: session.user.id,
      jobId: created.id,
      route: "/api/jobs",
      context: { company: created.company, title: created.title },
    });
    return jsonOk({ job: mapDbJob(created) }, request, { status: 201 });
  } catch (error) {
    await logImportantError({
      event: "job_create_failed",
      userId: session.user.id,
      route: "/api/jobs",
      error,
      context: {
        method: "POST",
      },
    });
  }
}
