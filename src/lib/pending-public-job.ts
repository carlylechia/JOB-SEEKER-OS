import { cookies } from "next/headers";

const PENDING_PUBLIC_JOB_COOKIE = "pending_public_job_id";

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

export async function setPendingPublicJobId(jobId: string) {
  const store = await cookies();

  store.set(PENDING_PUBLIC_JOB_COOKIE, jobId, {
    ...COOKIE_OPTIONS,
    maxAge: 60 * 30, // 30 minutes
  });
}

export async function getPendingPublicJobId() {
  const store = await cookies();
  return store.get(PENDING_PUBLIC_JOB_COOKIE)?.value ?? null;
}

export async function clearPendingPublicJobId() {
  const store = await cookies();

  // ✅ Proper deletion (overwrite with expired cookie)
  store.set(PENDING_PUBLIC_JOB_COOKIE, "", {
    ...COOKIE_OPTIONS,
    maxAge: 0,
  });
}
