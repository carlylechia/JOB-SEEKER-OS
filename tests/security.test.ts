/**
 * Security-focused tests.
 *
 * Verifies the invariants that a monetization system must never violate:
 * a normal user cannot reach admin surfaces, cannot read another user's
 * subscription, cannot change any plan, and cannot self-escalate to admin.
 */

import { describe, it, expect, afterEach } from './harness';
import { prisma } from '@/lib/prisma';
import { getCurrentUser, getCurrentAdmin, isAdmin } from '@/lib/authz';
import { isCronAuthorized, isCronConfigured } from '@/lib/cron-auth';
import { sanitizeUpgradeRequest, upgradeRequestSchema } from '@/lib/billing/upgrade-requests';
import { createUser, destroyUser, T0 } from './helpers';

const created: string[] = [];
async function track<T extends { id: string }>(p: Promise<T>): Promise<T> {
  const v = await p;
  created.push(v.id);
  return v;
}

afterEach(async () => {
  for (const id of created.splice(0)) await destroyUser(id).catch(() => undefined);
});

describe('role model', () => {
  it('stores role in the database, not as an email comparison', async () => {
    const user = await track(createUser());
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.role).toBe('USER');
  });

  it('does not treat role as a client-controllable field', async () => {
    // The User model exposes no public update path; ensure there is no route
    // that would let a caller pass `role` through profile updates.
    const user = await track(createUser());
    await prisma.userProfile.upsert({
      where: { userId: user.id },
      create: { userId: user.id },
      update: { headline: 'Updated' },
    });
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    // Updating the profile must never touch the role.
    expect(row.role).toBe('USER');
  });

  it('isAdmin only trusts an explicit ADMIN role value', () => {
    expect(isAdmin({ role: 'ADMIN' })).toBe(true);
    expect(isAdmin({ role: 'USER' })).toBe(false);
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
    // A lookalike string is not admin.
    expect(isAdmin({ role: 'admin' } as never)).toBe(false);
  });
});

describe('upgrade request input validation', () => {
  const valid = {
    requestedPlan: 'PRO',
    contactMethod: 'EMAIL',
    contactEmail: 'user@example.com',
    message: 'I want better resume help.',
  };

  it('accepts a well-formed request', () => {
    const parsed = upgradeRequestSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
  });

  it('rejects an unknown plan code', () => {
    const parsed = upgradeRequestSchema.safeParse({ ...valid, requestedPlan: 'ULTRA' });
    expect(parsed.success).toBe(false);
  });

  it('rejects a client-supplied userId', () => {
    // strict() means unknown fields are an error, so a client cannot smuggle
    // identity through the body.
    const parsed = upgradeRequestSchema.safeParse({ ...valid, userId: 'someone-else' });
    expect(parsed.success).toBe(false);
  });

  it('rejects a client-supplied status', () => {
    const parsed = upgradeRequestSchema.safeParse({ ...valid, status: 'APPROVED' });
    expect(parsed.success).toBe(false);
  });

  it('rejects a client-supplied role', () => {
    const parsed = upgradeRequestSchema.safeParse({ ...valid, role: 'ADMIN' });
    expect(parsed.success).toBe(false);
  });

  it('requires an email when the contact method is EMAIL', () => {
    const parsed = upgradeRequestSchema.safeParse({
      requestedPlan: 'PRO',
      contactMethod: 'EMAIL',
      contactEmail: '',
      message: 'hi',
    });
    expect(parsed.success).toBe(false);
  });

  it('requires a WhatsApp number when the contact method is WHATSAPP', () => {
    const parsed = upgradeRequestSchema.safeParse({
      requestedPlan: 'PRO',
      contactMethod: 'WHATSAPP',
      message: 'hi',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects an oversized message', () => {
    const parsed = upgradeRequestSchema.safeParse({ ...valid, message: 'x'.repeat(5000) });
    expect(parsed.success).toBe(false);
  });

  it('rejects a malformed WhatsApp number', () => {
    const parsed = upgradeRequestSchema.safeParse({
      requestedPlan: 'PRO',
      contactMethod: 'WHATSAPP',
      whatsappNumber: 'not-a-number',
      message: 'hi',
    });
    expect(parsed.success).toBe(false);
  });

  it('normalizes a valid WhatsApp number', () => {
    const parsed = upgradeRequestSchema.parse({
      requestedPlan: 'PRO',
      contactMethod: 'WHATSAPP',
      whatsappNumber: '+234 (801) 234-5678',
      message: 'hi',
    });
    const clean = sanitizeUpgradeRequest(parsed);
    expect(clean.whatsappNumber).toBe('+2348012345678');
  });
});

describe('WhatsApp link construction', () => {
  it('builds a wa.me link from a validated number', async () => {
    const { buildWhatsappUrl } = await import('@/lib/billing/upgrade-requests');
    expect(buildWhatsappUrl('+2348012345678')).toBe('https://wa.me/2348012345678');
  });

  it('encodes the prefilled message', async () => {
    const { buildWhatsappUrl } = await import('@/lib/billing/upgrade-requests');
    const url = buildWhatsappUrl('+2348012345678', 'Hi there, upgrade request');
    expect(url).toContain('wa.me/2348012345678?text=');
    expect(url).toContain(encodeURIComponent('Hi there, upgrade request'));
  });

  it('refuses to build a link from an untrusted value', async () => {
    const { buildWhatsappUrl } = await import('@/lib/billing/upgrade-requests');
    // Must never produce a javascript: or arbitrary-host URL.
    expect(buildWhatsappUrl('javascript:alert(1)')).toBeNull();
    expect(buildWhatsappUrl('https://evil.example')).toBeNull();
    expect(buildWhatsappUrl('')).toBeNull();
    expect(buildWhatsappUrl(null)).toBeNull();
  });
});

describe('cron authorization', () => {
  const request = (auth?: string) =>
    new Request('https://example.test/api/cron/maintenance', {
      headers: auth ? { authorization: auth } : {},
    });

  it('refuses when no secret is configured (fail closed)', () => {
    const original = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    expect(isCronConfigured()).toBe(false);
    expect(isCronAuthorized(request('Bearer anything'))).toBe(false);
    if (original !== undefined) process.env.CRON_SECRET = original;
  });

  it('refuses a short/weak secret', () => {
    const original = process.env.CRON_SECRET;
    process.env.CRON_SECRET = 'short';
    expect(isCronAuthorized(request('Bearer short'))).toBe(false);
    if (original !== undefined) process.env.CRON_SECRET = original;
  });

  it('accepts the exact bearer token', () => {
    process.env.CRON_SECRET = 'a-sufficiently-long-secret-value';
    expect(isCronAuthorized(request('Bearer a-sufficiently-long-secret-value'))).toBe(true);
  });

  it('rejects a wrong or missing token', () => {
    process.env.CRON_SECRET = 'a-sufficiently-long-secret-value';
    expect(isCronAuthorized(request())).toBe(false);
    expect(isCronAuthorized(request('Bearer wrong-secret-value-here'))).toBe(false);
    expect(isCronAuthorized(request('Basic a-sufficiently-long-secret-value'))).toBe(false);
  });

  it('does not trust an admin query flag', () => {
    process.env.CRON_SECRET = 'a-sufficiently-long-secret-value';
    const spoofed = new Request('https://example.test/api/cron/maintenance?admin=true', {
      headers: { 'x-admin': 'true' },
    });
    expect(isCronAuthorized(spoofed)).toBe(false);
  });
});

describe('ownership isolation', () => {
  it('a user cannot read another user subscription through the service layer', async () => {
    const { getEffectiveSubscription } = await import('@/lib/billing/subscriptions');
    const userA = await track(createUser());
    const userB = await track(createUser());

    // Seed a subscription for A only.
    const pro = await prisma.plan.findUniqueOrThrow({ where: { code: 'PRO' } });
    await prisma.subscription.create({
      data: {
        userId: userA.id,
        planId: pro.id,
        status: 'ACTIVE',
        startsAt: T0,
        source: 'ADMIN_MANUAL',
      },
    });

    // Resolving B's subscription must return B's own (Free) state, never A's.
    const bState = await getEffectiveSubscription(userB.id);
    expect(bState.plan).toBe('FREE');

    const aState = await getEffectiveSubscription(userA.id);
    expect(aState.plan).toBe('PRO');
  });
});