import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/authz';
import { applyRateLimit, getRequestIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';

// Allowlist of privacy-conscious event names. Keep this small and intentional.
const EVENT_NAMES = [
  'signup_completed',
  'onboarding_started',
  'onboarding_completed',
  'resume_added',
  'career_profile_completed',
  'job_discovery_viewed',
  'job_saved',
  'job_imported',
  'application_status_changed',
  'application_material_created',
  'interview_prep_started',
  'interview_prep_completed',
  'career_queue_action_completed',
  'weekly_review_completed',
  'upgrade_requested',
  'plan_changed',
  'trial_started',
  'trial_expired',
] as const;

const trackSchema = z.object({
  name: z.enum(EVENT_NAMES),
  // Free-form but bounded and shallow. No resume/cover-letter contents.
  properties: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
});

export async function POST(request: NextRequest) {
  const ip = getRequestIp(request);
  const rl = applyRateLimit(`analytics:${ip}`, 60, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = trackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid event' }, { status: 400 });
  }

  const user = await getCurrentUser();
  const { name, properties } = parsed.data;

  // Bound payload size / cardinality.
  const safeProps: Record<string, string | number | boolean | null> = {};
  if (properties) {
    for (const [k, v] of Object.entries(properties).slice(0, 20)) {
      if (typeof k === 'string' && k.length <= 64) {
        safeProps[k.slice(0, 64)] = v;
      }
    }
  }

  try {
    await prisma.productEvent.create({
      data: {
        userId: user?.id ?? null,
        name,
        properties: Object.keys(safeProps).length ? safeProps : undefined,
      },
    });
  } catch {
    // Analytics must never break core flows.
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true });
}

export async function GET(request: NextRequest) {
  const admin = await (async () => {
    const u = await getCurrentUser();
    return u?.role === 'ADMIN' ? u : null;
  })();
  if (!admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const rows = await prisma.productEvent.groupBy({
    by: ['name'],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
    orderBy: { _count: { name: 'desc' } },
  });

  return NextResponse.json({
    windowDays: 30,
    events: rows.map((r) => ({ name: r.name, count: r._count._all })),
  });
}
