import { cookies } from 'next/headers';

const PENDING_PUBLIC_JOB_COOKIE = 'pending_public_job_id';

export async function setPendingPublicJobId(jobId: string) {
  const store = await cookies();
  store.set(PENDING_PUBLIC_JOB_COOKIE, jobId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 30, // 30 minutes
  });
}

export async function getPendingPublicJobId() {
  const store = await cookies();
  return store.get(PENDING_PUBLIC_JOB_COOKIE)?.value ?? null;
}

export async function clearPendingPublicJobId() {
  const store = await cookies();
  store.delete(PENDING_PUBLIC_JOB_COOKIE);
}
