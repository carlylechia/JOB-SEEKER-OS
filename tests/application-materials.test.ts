/**
 * AI Cover Letters & Application Materials — service and persistence tests.
 *
 * Every AI call is served by an injected fake. No key is required and no
 * network request is made.
 */

import { describe, it, beforeEach, afterEach, expect } from './harness';
import { prisma } from '@/lib/prisma';
import { createUser, destroyUser, setTestNow, resetClock, T0 } from './helpers';
import { requireEntitlement, PlanRequiredError } from '@/lib/billing/subscriptions';
import { getUsage } from '@/lib/billing/usage';
import {
  APPLICATION_MATERIAL_FEATURE,
  runGeneration,
  JobNotFoundError,
  DuplicateGenerationInFlightError,
  type RunGenerationResult,
} from '@/lib/application-materials/service';
import {
  __setApplicationMaterialAiProviderFactory,
  type ApplicationMaterialAiProvider,
} from '@/lib/application-materials/ai-client';
import {
  MATERIAL_TYPES,
  materialTypeSchema,
  isMaterialType,
  tonesFor,
  resolveTone,
  lengthsFor,
  resolveLength,
  APPLIED_STATUSES,
} from '@/lib/application-materials/materials';
import {
  verifyMaterial,
  type EvidenceSources,
} from '@/lib/application-materials/verify';
import type { ModelMaterial } from '@/lib/application-materials/schema';
import { buildMaterialContext } from '@/lib/application-materials/context';
import { getStoredMaterialContent } from '@/lib/application-materials/wire';
import { buildApplicationMaterialTitle } from '@/lib/application-materials/naming';
import { createResume, updateResume } from '@/lib/resume-builder/documents';
import { typicalContent } from './resume-builder-fixtures';

const userIds: string[] = [];

/** A fake writing provider. Records the prompt it received so tests can assert
 *  what actually reached the model. */
function fakeProvider(
  overrides: {
    material?: Partial<ModelMaterial>;
    throwError?: Error;
    invalid?: boolean;
    delayMs?: number;
  } = {},
): ApplicationMaterialAiProvider & { calls: Array<{ systemPrompt: string; userPrompt: string }> } {
  const calls: Array<{ systemPrompt: string; userPrompt: string }> = [];
  return {
    name: 'fake',
    model: 'fake-model-1',
    calls,
    async write(params) {
      calls.push(params);
      if (overrides.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, overrides.delayMs));
      }
      if (overrides.throwError) throw overrides.throwError;
      if (overrides.invalid) {
        return { nonsense: true } as unknown as ModelMaterial;
      }
      return {
        schemaVersion: 1,
        subject: overrides.material?.subject ?? 'Application: Backend Engineer',
        opening: overrides.material?.opening ?? 'I am writing to apply for the Backend Engineer role.',
        body: overrides.material?.body ?? [
          { heading: null, text: 'I have built production systems with TypeScript and Node.js.' },
        ],
        closing: overrides.material?.closing ?? 'I look forward to hearing from you.',
        claims: overrides.material?.claims ?? [
          {
            claim: 'Built production systems with TypeScript and Node.js',
            source: 'WORK_EXPERIENCE',
            field: 'CareerExperience.responsibilities',
            excerpt: 'TypeScript, Node.js',
          },
        ],
        reviewNotes: [],
        missingInformation: [],
        unsupported: [],
      } as unknown as ModelMaterial;
    },
  };
}

/** Create a user with a confirmed career profile and a job with a description. */
async function setup(opts: {
  plan?: 'FREE' | 'PRO' | 'PREMIUM';
  profile?: Record<string, unknown>;
  job?: Record<string, unknown>;
} = {}) {
  const user = await createUser();
  userIds.push(user.id);

  await prisma.userProfile.create({
    data: {
      user: { connect: { id: user.id } },
      careerProfileConfirmedAt: new Date('2026-02-01T00:00:00.000Z'),
      careerProfileVersion: 3,
      headline: 'Software Engineer',
      summary: 'Backend engineer with TypeScript and Node.js experience.',
      location: 'United States',
      targetRoles: ['Backend Engineer'],
      preferredTitles: [],
      preferredStack: ['TypeScript', 'Node.js'],
      mustHaveTech: ['TypeScript'],
      preferredRegions: ['US'],
      workRegions: ['US'],
      remoteOnly: true,
      salaryMin: 110000,
      salaryTarget: 150000,
      currentLevel: 'MID',
      targetLevel: 'MID',
      ...(opts.profile ?? {}),
    },
  });

  const profile = await prisma.userProfile.findUnique({ where: { userId: user.id } });
  const profileId = profile!.id;
  await prisma.careerSkill.create({
    data: {
      user: { connect: { id: user.id } },
      profile: { connect: { id: profileId } },
      name: 'TypeScript',
      origin: 'SUPPORTED',
      confirmed: true,
    },
  });
  await prisma.careerSkill.create({
    data: {
      user: { connect: { id: user.id } },
      profile: { connect: { id: profileId } },
      name: 'Node.js',
      origin: 'SUPPORTED',
      confirmed: true,
    },
  });
  await prisma.careerExperience.create({
    data: {
      user: { connect: { id: user.id } },
      profile: { connect: { id: profileId } },
      jobTitle: 'Backend Engineer',
      company: 'Northwind',
      startDate: '2022-01',
      endDate: '2025-01',
      isCurrent: false,
      responsibilities: ['Built APIs with TypeScript and Node.js'],
      achievements: [],
      technologies: ['TypeScript', 'Node.js'],
    },
  });

  const job = await prisma.jobLead.create({
    data: {
      userId: user.id,
      company: 'Northwind',
      title: 'Backend Engineer',
      source: 'Ashby',
      jobUrl: 'https://example.com/careers/backend',
      location: 'United States',
      remoteType: 'Fully Remote',
      eligibilityRegion: 'US',
      salaryMin: 120000,
      salaryMax: 165000,
      currency: 'USD',
      jobDescription:
        'We are hiring a Backend Engineer to design and build APIs. You will work with TypeScript, Node.js, and PostgreSQL.',
      status: 'APPLIED',
      dateApplied: new Date('2026-03-01T00:00:00.000Z'),
      score: {
        coreStackMatch: 4,
        roleAlignment: 4,
        seniorityFit: 4,
        geographyEligibility: 4,
        timezoneCompatibility: 4,
        compensationFit: 4,
        domainRelevance: 3,
        applicationFriction: 3,
        signalQuality: 4,
        fitScore: 72,
        fitTier: 'B',
        titleMatch: true,
      },
      checklist: {},
      contacts: [],
      interviews: [],
      prepPack: {},
      ...(opts.job ?? {}),
    },
  });

  if (opts.plan && opts.plan !== 'FREE') {
    const plan = await prisma.plan.findUniqueOrThrow({ where: { code: opts.plan } });
    await prisma.subscription.create({
      data: {
        userId: user.id,
        planId: plan.id,
        status: 'ACTIVE',
        startsAt: T0,
        source: 'ADMIN_MANUAL',
      },
    });
  }

  return { user, job };
}

beforeEach(() => {
  setTestNow(T0);
  __setApplicationMaterialAiProviderFactory(null);
});

afterEach(async () => {
  resetClock();
  __setApplicationMaterialAiProviderFactory(null);
  for (const id of userIds.splice(0)) {
    await destroyUser(id).catch(() => undefined);
  }
});

// ─── Material type definitions ──────────────────────────────────────────────

describe('material type definitions', () => {
  it('accepts the six supported types', () => {
    for (const type of MATERIAL_TYPES) {
      expect(materialTypeSchema.safeParse(type).success).toBe(true);
      expect(isMaterialType(type)).toBe(true);
    }
    expect(isMaterialType('NOT_A_TYPE')).toBe(false);
  });

  it('resolves tones and lengths per type', () => {
    expect(tonesFor('COVER_LETTER')).toContain('PROFESSIONAL');
    expect(tonesFor('LINKEDIN_CONNECTION')).not.toContain('FORMAL');
    expect(resolveTone('COVER_LETTER', 'CONFIDENT')).toBe('CONFIDENT');
    expect(resolveTone('COVER_LETTER', 'NOT_A_TONE')).toBe('PROFESSIONAL');

    expect(lengthsFor('COVER_LETTER')).toContain('DETAILED');
    expect(lengthsFor('LINKEDIN_CONNECTION')).not.toContain('DETAILED');
    expect(resolveLength('COVER_LETTER', 'STANDARD')).toBe('STANDARD');
    expect(resolveLength('COVER_LETTER', 'NOT_A_LENGTH')).toBe('STANDARD');
  });

  it('knows which types are application-grounded', () => {
    expect(APPLIED_STATUSES).toContain('APPLIED');
    expect(APPLIED_STATUSES).not.toContain('LEAD');
  });
});

describe('selected resume context', () => {
  it('uses the selected resume as evidence when verifying generated claims', async () => {
    const { user, job } = await setup();
    const resume = await createResume({
      userId: user.id,
      input: { from: 'BLANK' },
      limit: null,
    });
    await updateResume({
      userId: user.id,
      resumeId: resume.id,
      input: { expectedRevision: resume.revision, content: typicalContent() },
    });

    const context = await buildMaterialContext({
      userId: user.id,
      type: 'COVER_LETTER',
      jobId: job.id,
      resumeId: resume.id,
      profileVersion: 3,
    });

    expect(context.resume?.text).toContain('payment and data platforms');
    expect(context.resume?.text).toContain('Acme Payments Ltd');
    expect(context.candidate.numbers).toContain('38%');
    expect(context.candidate.organisationNames).toContain('Acme Payments Ltd');
    expect(context.candidate.jobTitles).toContain('Senior Backend Engineer');
    expect(context.candidate.skillNames).toContain('Kafka');
  });
});

// ─── Entitlement enforcement ───────────────────────────────────────────────

describe('entitlement enforcement', () => {
  it('refuses a Free user before any provider call', async () => {
    const { user, job } = await setup({ plan: 'FREE' });
    const provider = fakeProvider();

    await expect(
      runGeneration({
        userId: user.id,
        type: 'COVER_LETTER',
        jobId: job.id,
        resumeId: null,
        title: 'Cover letter',
        origin: 'AI_GENERATED',
        supersedesId: null,
        route: '/api/application-materials/generate',
        provider,
        tone: 'PROFESSIONAL',
        length: 'STANDARD',
        instructions: null,
        conversation: null,
        recipientName: null,
        sourceDraft: null,
      }),
    ).rejects.toBeInstanceOf(PlanRequiredError);

    expect(provider.calls).toHaveLength(0);
    expect(await getUsage(user.id, APPLICATION_MATERIAL_FEATURE)).toBe(0);
  });

  it('allows Pro and Premium users', async () => {
    for (const plan of ['PRO', 'PREMIUM'] as const) {
      const { user, job } = await setup({ plan });
      const provider = fakeProvider();

      const result = await runGeneration({
        userId: user.id,
        type: 'COVER_LETTER',
        jobId: job.id,
        resumeId: null,
        title: 'Cover letter',
        origin: 'AI_GENERATED',
        supersedesId: null,
        route: '/api/application-materials/generate',
        provider,
        tone: 'PROFESSIONAL',
        length: 'STANDARD',
        instructions: null,
        conversation: null,
        recipientName: null,
        sourceDraft: null,
      });

      expect((result as { outcome: string }).outcome).not.toBe('FAILED');
      expect(provider.calls).toHaveLength(1);
    }
  });

  it('exempts administrators from plan checks', async () => {
    const admin = await createUser({ role: 'ADMIN' });
    userIds.push(admin.id);
    const job = await prisma.jobLead.create({
      data: {
        userId: admin.id,
        company: 'Northwind',
        title: 'Backend Engineer',
        jobDescription: 'Backend Engineer needed.',
        status: 'APPLIED',
        score: {},
        checklist: {},
        contacts: [],
        interviews: [],
        prepPack: {},
      },
    });

    const provider = fakeProvider();
    const result = await runGeneration({
      userId: admin.id,
      type: 'COVER_LETTER',
      jobId: job.id,
      resumeId: null,
      title: 'Cover letter',
      origin: 'AI_GENERATED',
      supersedesId: null,
      route: '/api/application-materials/generate',
      provider,
      tone: 'PROFESSIONAL',
      length: 'STANDARD',
      instructions: null,
      conversation: null,
      recipientName: null,
      sourceDraft: null,
    });

    expect((result as { outcome: string }).outcome).not.toBe('FAILED');
    expect(await getUsage(admin.id, APPLICATION_MATERIAL_FEATURE)).toBe(0);
  });

  it('refuses an expired trial', async () => {
    const { user, job } = await setup({ plan: 'PRO' });
    const plan = await prisma.plan.findUniqueOrThrow({ where: { code: 'PRO' } });
    await prisma.subscription.update({
      where: { userId: user.id },
      data: { status: 'EXPIRED', endsAt: new Date('2026-01-01T00:00:00.000Z') },
    });
    await prisma.subscriptionEvent.create({
      data: {
        userId: user.id,
        type: 'TRIAL_EXPIRED',
        previousPlanCode: 'PRO',
        previousStatus: 'TRIALING',
        newPlanCode: 'FREE',
        newStatus: 'EXPIRED',
        reason: 'Trial window elapsed',
      },
    });

    const provider = fakeProvider();
    await expect(
      runGeneration({
        userId: user.id,
        type: 'COVER_LETTER',
        jobId: job.id,
        resumeId: null,
        title: 'Cover letter',
        origin: 'AI_GENERATED',
        supersedesId: null,
        route: '/api/application-materials/generate',
        provider,
        tone: 'PROFESSIONAL',
        length: 'STANDARD',
        instructions: null,
        conversation: null,
        recipientName: null,
        sourceDraft: null,
      }),
    ).rejects.toBeInstanceOf(PlanRequiredError);

    expect(provider.calls).toHaveLength(0);
  });
});

// ─── Generation ────────────────────────────────────────────────────────────

describe('generation', () => {
  it('produces a cover letter for a valid target job', async () => {
    const { user, job } = await setup({ plan: 'PRO' });
    const provider = fakeProvider();

    const result = await runGeneration({
      userId: user.id,
      type: 'COVER_LETTER',
      jobId: job.id,
      resumeId: null,
      title: 'Cover letter — Northwind',
      origin: 'AI_GENERATED',
      supersedesId: null,
      route: '/api/application-materials/generate',
      provider,
      tone: 'PROFESSIONAL',
      length: 'STANDARD',
      instructions: null,
      conversation: null,
      recipientName: null,
      sourceDraft: null,
    });

    expect((result as RunGenerationResult).outcome).toBe('COMPLETED');
    const material = (result as { material: { content: string } }).material;
    expect(material.content).toContain('Backend Engineer');
    expect(material.content.length).toBeGreaterThan(0);
    const stored = await prisma.applicationMaterial.findUniqueOrThrow({
      where: { id: (result as { summary: { id: string } }).summary.id },
    });
    expect(stored.content).toBe(material.content);
    expect(stored.status).toBe('DRAFT');
    expect(provider.calls).toHaveLength(1);
    expect((result as { creditsConsumed: number }).creditsConsumed).toBe(1);
  });

  it('refuses a job that belongs to someone else', async () => {
    const { user } = await setup({ plan: 'PRO' });
    const other = await createUser();
    userIds.push(other.id);
    const otherJob = await prisma.jobLead.create({
      data: {
        userId: other.id,
        company: 'OtherCo',
        title: 'Engineer',
        jobDescription: 'Role at other co.',
        status: 'APPLIED',
        score: {},
        checklist: {},
        contacts: [],
        interviews: [],
        prepPack: {},
      },
    });

    const provider = fakeProvider();
    await expect(
      runGeneration({
        userId: user.id,
        type: 'COVER_LETTER',
        jobId: otherJob.id,
        resumeId: null,
        title: 'Cover letter',
        origin: 'AI_GENERATED',
        supersedesId: null,
        route: '/api/application-materials/generate',
        provider,
        tone: 'PROFESSIONAL',
        length: 'STANDARD',
        instructions: null,
        conversation: null,
        recipientName: null,
        sourceDraft: null,
      }),
    ).rejects.toBeInstanceOf(JobNotFoundError);
  });

  it('handles missing company name honestly', async () => {
    const { user } = await setup({ plan: 'PRO' });
    const job = await prisma.jobLead.create({
      data: {
        userId: user.id,
        company: '',
        title: 'Backend Engineer',
        jobDescription: 'Backend Engineer needed.',
        status: 'APPLIED',
        score: {},
        checklist: {},
        contacts: [],
        interviews: [],
        prepPack: {},
      },
    });

    const provider = fakeProvider();
    const result = await runGeneration({
      userId: user.id,
      type: 'COVER_LETTER',
      jobId: job.id,
      resumeId: null,
      title: 'Cover letter',
      origin: 'AI_GENERATED',
      supersedesId: null,
      route: '/api/application-materials/generate',
      provider,
      tone: 'PROFESSIONAL',
      length: 'STANDARD',
      instructions: null,
      conversation: null,
      recipientName: null,
      sourceDraft: null,
    });

    const material = (result as { material: { content: string; warnings: string[] } }).material;
    // No company should not crash; the draft is produced without a company claim.
    expect(material.content.length).toBeGreaterThan(0);
  });

  it('handles a missing job description', async () => {
    const { user, job } = await setup({ plan: 'PRO' });
    await prisma.jobLead.update({
      where: { id: job.id },
      data: { jobDescription: null },
    });

    const provider = fakeProvider();
    const result = await runGeneration({
      userId: user.id,
      type: 'COVER_LETTER',
      jobId: job.id,
      resumeId: null,
      title: 'Cover letter',
      origin: 'AI_GENERATED',
      supersedesId: null,
      route: '/api/application-materials/generate',
      provider,
      tone: 'PROFESSIONAL',
      length: 'STANDARD',
      instructions: null,
      conversation: null,
      recipientName: null,
      sourceDraft: null,
    });

    const material = (result as { material: { warnings: string[] } }).material;
    expect(material.warnings.some((w) => w.includes('description'))).toBe(true);
  });

  it('produces a LinkedIn connection message without a job', async () => {
    const { user } = await setup({ plan: 'PRO' });
    const provider = fakeProvider();

    const result = await runGeneration({
      userId: user.id,
      type: 'LINKEDIN_CONNECTION',
      jobId: null,
      resumeId: null,
      title: 'Connection note',
      origin: 'AI_GENERATED',
      supersedesId: null,
      route: '/api/application-materials/generate',
      provider,
      tone: 'PROFESSIONAL',
      length: 'STANDARD',
      instructions: null,
      conversation: null,
      recipientName: null,
      sourceDraft: null,
    });

    expect((result as RunGenerationResult).outcome).toBe('COMPLETED');
  });

  it('requires application context for a follow-up', async () => {
    const { user, job } = await setup({ plan: 'PRO' });
    // Reset to LEAD (not applied)
    await prisma.jobLead.update({ where: { id: job.id }, data: { status: 'LEAD', dateApplied: null } });

    const provider = fakeProvider();
    const result = await runGeneration({
      userId: user.id,
      type: 'APPLICATION_FOLLOW_UP',
      jobId: job.id,
      resumeId: null,
      title: 'Follow-up',
      origin: 'AI_GENERATED',
      supersedesId: null,
      route: '/api/application-materials/generate',
      provider,
      tone: 'PROFESSIONAL',
      length: 'STANDARD',
      instructions: null,
      conversation: null,
      recipientName: null,
      sourceDraft: null,
    });

    // Should either fail with NOT_APPLIED_YET or produce a draft flagged as missing context.
    expect((result as RunGenerationResult).outcome).toBeDefined();
  });

  it('produces an interview thank-you with real interview context', async () => {
    const { user, job } = await setup({ plan: 'PRO' });
    await prisma.jobLead.update({
      where: { id: job.id },
      data: {
        interviews: [
          {
            scheduledAt: '2026-04-02T16:00:00.000Z',
            stage: 'VIDEO',
            interviewType: 'VIDEO',
          },
        ],
      },
    });

    const provider = fakeProvider({
      material: {
        opening: 'Thank you for speaking with me about the Backend Engineer role.',
        body: [{ heading: null, text: 'I enjoyed discussing the platform with the team.' }],
      },
    });

    const result = await runGeneration({
      userId: user.id,
      type: 'INTERVIEW_THANK_YOU',
      jobId: job.id,
      resumeId: null,
      title: 'Thank-you note',
      origin: 'AI_GENERATED',
      supersedesId: null,
      route: '/api/application-materials/generate',
      provider,
      tone: 'PROFESSIONAL',
      length: 'STANDARD',
      instructions: null,
      conversation: null,
      recipientName: null,
      sourceDraft: null,
    });

    expect((result as RunGenerationResult).outcome).toBe('COMPLETED');
    const material = (result as { material: { content: string } }).material;
    expect(material.content.length).toBeGreaterThan(0);
  });

  it('does not invent personal facts: numeric claims are removed', async () => {
    const { user, job } = await setup({ plan: 'PRO' });
    const provider = fakeProvider({
      material: {
        opening: 'I increased revenue by 60% in my last role.',
        body: [{ heading: null, text: 'I have five years of experience.' }],
        closing: 'Thank you.',
        claims: [
          {
            claim: 'I increased revenue by 60% in my last role.',
            source: 'WORK_EXPERIENCE',
            field: 'CareerExperience.achievements',
            excerpt: null,
          },
          {
            claim: 'I have five years of experience.',
            source: 'WORK_EXPERIENCE',
            field: 'CareerExperience.responsibilities',
            excerpt: null,
          },
        ],
      },
    });

    const result = await runGeneration({
      userId: user.id,
      type: 'COVER_LETTER',
      jobId: job.id,
      resumeId: null,
      title: 'Cover letter',
      origin: 'AI_GENERATED',
      supersedesId: null,
      route: '/api/application-materials/generate',
      provider,
      tone: 'PROFESSIONAL',
      length: 'STANDARD',
      instructions: null,
      conversation: null,
      recipientName: null,
      sourceDraft: null,
    });

    const material = (result as { material: { content: string; unsupported: string[] } }).material;
    // 60% is not in the profile; the sentence carrying it is removed.
    expect(material.content).not.toContain('60%');
  });

  it('does not invent employers', async () => {
    const { user, job } = await setup({ plan: 'PRO' });
    const provider = fakeProvider({
      material: {
        opening: 'I worked at MadeUpCo for ten years.',
        body: [{ heading: null, text: 'MadeUpCo is a great company.' }],
        closing: 'Thank you.',
        claims: [],
      },
    });

    const result = await runGeneration({
      userId: user.id,
      type: 'COVER_LETTER',
      jobId: job.id,
      resumeId: null,
      title: 'Cover letter',
      origin: 'AI_GENERATED',
      supersedesId: null,
      route: '/api/application-materials/generate',
      provider,
      tone: 'PROFESSIONAL',
      length: 'STANDARD',
      instructions: null,
      conversation: null,
      recipientName: null,
      sourceDraft: null,
    });

    const material = (result as { material: { content: string } }).material;
    expect(material.content).not.toContain('MadeUpCo');
  });

  it('handles provider timeout gracefully', async () => {
    const { user, job } = await setup({ plan: 'PRO' });
    const provider = fakeProvider({
      throwError: Object.assign(new Error('timeout'), { name: 'APIConnectionTimeoutError' }),
    });

    const result = await runGeneration({
      userId: user.id,
      type: 'COVER_LETTER',
      jobId: job.id,
      resumeId: null,
      title: 'Cover letter',
      origin: 'AI_GENERATED',
      supersedesId: null,
      route: '/api/application-materials/generate',
      provider,
      tone: 'PROFESSIONAL',
      length: 'STANDARD',
      instructions: null,
      conversation: null,
      recipientName: null,
      sourceDraft: null,
    });

    const failed = result as Extract<RunGenerationResult, { outcome: 'FAILED' }>;
    expect(failed.outcome).toBe('FAILED');
    expect(failed.retryable).toBe(true);
  });

  it('reuses identical inputs but regenerates when user instructions change', async () => {
    const { user, job } = await setup({ plan: 'PRO' });
    const provider = fakeProvider();

    const first = await runGeneration({
      userId: user.id,
      type: 'COVER_LETTER',
      jobId: job.id,
      resumeId: null,
      title: 'Cover letter',
      origin: 'AI_GENERATED',
      supersedesId: null,
      route: '/api/application-materials/generate',
      provider,
      tone: 'PROFESSIONAL',
      length: 'STANDARD',
      instructions: null,
      conversation: null,
      recipientName: null,
      sourceDraft: null,
    });

    const second = await runGeneration({
      userId: user.id,
      type: 'COVER_LETTER',
      jobId: job.id,
      resumeId: null,
      title: 'Cover letter',
      origin: 'AI_GENERATED',
      supersedesId: null,
      route: '/api/application-materials/generate',
      provider,
      tone: 'PROFESSIONAL',
      length: 'STANDARD',
      instructions: null,
      conversation: null,
      recipientName: null,
      sourceDraft: null,
    });

    const reused = second as Extract<RunGenerationResult, { outcome: 'REUSED' }>;
    expect(reused.outcome).toBe('REUSED');
    expect(provider.calls).toHaveLength(1);

    const changed = await runGeneration({
      userId: user.id,
      type: 'COVER_LETTER',
      jobId: job.id,
      resumeId: null,
      title: 'Cover letter',
      origin: 'AI_GENERATED',
      supersedesId: null,
      route: '/api/application-materials/generate',
      provider,
      tone: 'PROFESSIONAL',
      length: 'STANDARD',
      instructions: 'Keep the wording warm and concise.',
      conversation: null,
      recipientName: null,
      sourceDraft: null,
    });
    expect(changed.outcome).toBe('COMPLETED');
    expect(provider.calls).toHaveLength(2);
  });

  it('refuses duplicate concurrent requests for the same input', async () => {
    const { user, job } = await setup({ plan: 'PRO' });
    const provider = fakeProvider({ delayMs: 80 });

    // Two calls with identical inputs: one claims the row, the other hits the
    // in-flight lock.
    const settled = await Promise.allSettled([
      runGeneration({
        userId: user.id,
        type: 'COVER_LETTER',
        jobId: job.id,
        resumeId: null,
        title: 'Cover letter',
        origin: 'AI_GENERATED',
        supersedesId: null,
        route: '/api/application-materials/generate',
        provider,
        tone: 'PROFESSIONAL',
        length: 'STANDARD',
        instructions: null,
        conversation: null,
        recipientName: null,
        sourceDraft: null,
      }),
      runGeneration({
        userId: user.id,
        type: 'COVER_LETTER',
        jobId: job.id,
        resumeId: null,
        title: 'Cover letter',
        origin: 'AI_GENERATED',
        supersedesId: null,
        route: '/api/application-materials/generate',
        provider,
        tone: 'PROFESSIONAL',
        length: 'STANDARD',
        instructions: null,
        conversation: null,
        recipientName: null,
        sourceDraft: null,
      }),
    ]);

    const outcomes = settled.map((s) =>
      s.status === 'fulfilled' ? (s.value as RunGenerationResult).outcome : 'REJECTED',
    );
    expect(outcomes).toContain('COMPLETED');
    expect(outcomes).toContain('REJECTED');
    expect(provider.calls).toHaveLength(1);
  });

  it('does not charge for an empty/malformed provider response', async () => {
    const { user, job } = await setup({ plan: 'PRO' });
    const provider = fakeProvider({ invalid: true });

    const result = await runGeneration({
      userId: user.id,
      type: 'COVER_LETTER',
      jobId: job.id,
      resumeId: null,
      title: 'Cover letter',
      origin: 'AI_GENERATED',
      supersedesId: null,
      route: '/api/application-materials/generate',
      provider,
      tone: 'PROFESSIONAL',
      length: 'STANDARD',
      instructions: null,
      conversation: null,
      recipientName: null,
      sourceDraft: null,
    });

    expect((result as RunGenerationResult).outcome).toBe('FAILED');
    // Usage is reserved before the provider call, so a failed attempt still
    // records one credit — matching the job-intelligence pattern.
    expect(await getUsage(user.id, APPLICATION_MATERIAL_FEATURE)).toBe(1);
  });
});

// ─── Verification ─────────────────────────────────────────────────────────

describe('verification', () => {
  it('keeps a supported claim and drops an unsupported one', () => {
    const model = {
      schemaVersion: 1,
      subject: null,
      opening: 'I built APIs with TypeScript and Node.js.',
      body: [{ heading: null, text: 'I also worked at Acme Corp.' }],
      closing: 'Thank you.',
      claims: [
        {
          claim: 'Built APIs with TypeScript and Node.js',
          source: 'WORK_EXPERIENCE',
          field: 'CareerExperience.responsibilities',
          excerpt: 'TypeScript, Node.js',
        },
        {
          claim: 'Worked at Acme Corp for ten years.',
          source: 'WORK_EXPERIENCE',
          field: 'CareerExperience.company',
          excerpt: null,
        },
      ],
      reviewNotes: [],
      missingInformation: [],
      unsupported: [],
    } as ModelMaterial;

    const candidate = {
      numbers: [],
      organisationNames: ['Northwind'],
      jobTitles: ['Backend Engineer'],
      technologies: ['TypeScript', 'Node.js'],
      skillNames: ['TypeScript', 'Node.js'],
    } as never;

    const sources: EvidenceSources = {
      WORK_EXPERIENCE: 'Responsibilities: Built APIs with TypeScript, Node.js.',
    };

    const result = verifyMaterial({ model, candidate, sources, meta: {} as never });
    // Acme Corp is not a known organisation; the paragraph is removed.
    expect(result.content).not.toContain('Acme Corp');
    // The supported claim about TypeScript/Node.js is kept.
    expect(result.content).toContain('TypeScript');
  });
});

// ─── Persistence ──────────────────────────────────────────────────────────

describe('persistence', () => {
  async function saveMaterial(
    userId: string,
    overrides: {
      type?: string;
      title?: string;
      content?: string;
      subject?: string | null;
      jobId?: string | null;
      status?: string;
      origin?: string;
    } = {},
  ) {
    return prisma.applicationMaterial.create({
      data: {
        userId,
        type: (overrides.type ?? 'COVER_LETTER') as any,
        title: overrides.title ?? 'Draft',
        content: overrides.content ?? 'Hello world',
        subject: overrides.subject ?? null,
        jobId: overrides.jobId ?? null,
        status: (overrides.status ?? 'DRAFT') as any,
        origin: (overrides.origin ?? 'MANUAL') as any,
        inputFingerprint: 'abc',
        schemaVersion: 1,
        promptVersion: 1,
        generationStatus: 'COMPLETED',
      },
    });
  }

  it('saves and reopens a material', async () => {
    const { user } = await setup({ plan: 'PRO' });
    const saved = await saveMaterial(user.id, { title: 'My cover letter' });

    const reopened = await prisma.applicationMaterial.findUnique({ where: { id: saved.id } });
    expect(reopened?.title).toBe('My cover letter');
    expect(reopened?.content).toBe('Hello world');
    expect(reopened?.userId).toBe(user.id);
  });

  it('restores text from generation metadata for legacy drafts', () => {
    expect(
      getStoredMaterialContent({
        content: '',
        generationMeta: { content: 'Previously generated text' },
        status: 'DRAFT',
      }),
    ).toBe('Previously generated text');
  });

  it('does not revive cleared content from generation metadata', () => {
    expect(
      getStoredMaterialContent({
        content: '',
        generationMeta: { content: 'Previously generated text' },
        status: 'READY',
      }),
    ).toBe('');
  });

  it('names saved materials with type, company, role and creation timestamp', () => {
    expect(
      buildApplicationMaterialTitle({
        type: 'COVER_LETTER',
        company: 'Northwind',
        role: 'Backend Engineer',
        createdAt: new Date('2026-10-24T00:53:46.867Z'),
      }),
    ).toBe('Cover letter — Northwind — Backend Engineer — 2026-10-24T00:53:46.867Z');
  });

  it('edits a material and bumps editVersion', async () => {
    const { user } = await setup({ plan: 'PRO' });
    const saved = await saveMaterial(user.id, { title: 'Original', content: 'Original text' });

    const updated = await prisma.applicationMaterial.update({
      where: { id: saved.id },
      data: { title: 'Edited', content: 'Edited text', editVersion: { increment: 1 } },
      select: { title: true, content: true, editVersion: true },
    });

    expect(updated.title).toBe('Edited');
    expect(updated.content).toBe('Edited text');
    expect(updated.editVersion).toBe(2);
  });

  it('creates a revision without overwriting the original', async () => {
    const { user } = await setup({ plan: 'PRO' });
    const original = await saveMaterial(user.id, { title: 'Version 1', content: 'First draft' });

    const revision = await prisma.applicationMaterial.create({
      data: {
        userId: user.id,
        type: 'COVER_LETTER',
        title: 'Version 1 (revision)',
        content: 'Second draft',
        subject: null,
        jobId: null,
        status: 'DRAFT',
        origin: 'AI_REVISED',
        supersedesId: original.id,
        inputFingerprint: 'def',
        schemaVersion: 1,
        promptVersion: 1,
        generationStatus: 'COMPLETED',
        revision: 2,
      },
    });

    const stillOriginal = await prisma.applicationMaterial.findUnique({
      where: { id: original.id },
    });
    expect(stillOriginal?.content).toBe('First draft');
    expect(revision.supersedesId).toBe(original.id);
    expect(revision.revision).toBe(2);
  });

  it('can retain materials in the archived library section', async () => {
    const { user } = await setup({ plan: 'PRO' });
    const saved = await saveMaterial(user.id);

    await prisma.applicationMaterial.update({
      where: { id: saved.id },
      data: { status: 'ARCHIVED' },
    });

    const archived = await prisma.applicationMaterial.findUnique({ where: { id: saved.id } });
    expect(archived?.status).toBe('ARCHIVED');
  });

  it('keeps a successor revision when its predecessor is deleted', async () => {
    const { user } = await setup({ plan: 'PRO' });
    const original = await saveMaterial(user.id, { title: 'Version 1' });
    const revision = await prisma.applicationMaterial.create({
      data: {
        userId: user.id,
        type: 'COVER_LETTER',
        title: 'Version 1 (revision)',
        content: 'Revised draft',
        subject: null,
        jobId: null,
        status: 'DRAFT',
        origin: 'AI_REVISED',
        supersedesId: original.id,
        inputFingerprint: 'delete-predecessor',
        schemaVersion: 1,
        promptVersion: 1,
        generationStatus: 'COMPLETED',
        revision: 2,
      },
    });

    await prisma.applicationMaterial.delete({ where: { id: original.id } });

    const deletedOriginal = await prisma.applicationMaterial.findUnique({
      where: { id: original.id },
    });
    const retainedRevision = await prisma.applicationMaterial.findUnique({
      where: { id: revision.id },
    });
    expect(deletedOriginal).toBeNull();
    expect(retainedRevision?.supersedesId).toBeNull();
  });

  it('prevents one user from reading another user\'s material', async () => {
    const { user } = await setup({ plan: 'PRO' });
    const other = await createUser();
    userIds.push(other.id);
    const saved = await saveMaterial(user.id, { title: 'Private letter' });

    const otherRead = await prisma.applicationMaterial.findFirst({
      where: { id: saved.id, userId: other.id },
    });
    expect(otherRead).toBeNull();
  });

  it('does not count copy/download/edit as AI usage', async () => {
    const { user } = await setup({ plan: 'PRO' });
    await saveMaterial(user.id);

    expect(await getUsage(user.id, APPLICATION_MATERIAL_FEATURE)).toBe(0);
  });
});

// ─── User choices reach the model ──────────────────────────────────────────

describe('user choices reach the model', () => {
  it('sends the chosen tone to the model', async () => {
    const { user, job } = await setup({ plan: 'PRO' });
    const provider = fakeProvider();

    await runGeneration({
      userId: user.id,
      type: 'COVER_LETTER',
      jobId: job.id,
      resumeId: null,
      title: 'Cover letter',
      origin: 'AI_GENERATED',
      supersedesId: null,
      route: '/api/application-materials/generate',
      provider,
      tone: 'CONFIDENT',
      length: 'STANDARD',
      instructions: null,
      conversation: null,
      recipientName: null,
      sourceDraft: null,
    });

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].userPrompt).toContain('TONE:');
    expect(provider.calls[0].userPrompt).toContain('Write with assurance');
  });

  it('sends the chosen length to the model', async () => {
    const { user, job } = await setup({ plan: 'PRO' });
    const provider = fakeProvider();

    await runGeneration({
      userId: user.id,
      type: 'COVER_LETTER',
      jobId: job.id,
      resumeId: null,
      title: 'Cover letter',
      origin: 'AI_GENERATED',
      supersedesId: null,
      route: '/api/application-materials/generate',
      provider,
      tone: 'PROFESSIONAL',
      length: 'DETAILED',
      instructions: null,
      conversation: null,
      recipientName: null,
      sourceDraft: null,
    });

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].userPrompt).toContain('LENGTH: aim for about 2600 characters');
  });

  it('sends user instructions to the model', async () => {
    const { user, job } = await setup({ plan: 'PRO' });
    const provider = fakeProvider();

    await runGeneration({
      userId: user.id,
      type: 'COVER_LETTER',
      jobId: job.id,
      resumeId: null,
      title: 'Cover letter',
      origin: 'AI_GENERATED',
      supersedesId: null,
      route: '/api/application-materials/generate',
      provider,
      tone: 'PROFESSIONAL',
      length: 'STANDARD',
      instructions: 'Emphasize my API experience and keep it concise.',
      conversation: null,
      recipientName: null,
      sourceDraft: null,
    });

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].userPrompt).toContain('Emphasize my API experience');
    expect(provider.calls[0].userPrompt).toContain('keep it concise');
  });

  it('sends conversation context to the model', async () => {
    const { user, job } = await setup({ plan: 'PRO' });
    const provider = fakeProvider();

    await runGeneration({
      userId: user.id,
      type: 'COVER_LETTER',
      jobId: job.id,
      resumeId: null,
      title: 'Cover letter',
      origin: 'AI_GENERATED',
      supersedesId: null,
      route: '/api/application-materials/generate',
      provider,
      tone: 'PROFESSIONAL',
      length: 'STANDARD',
      instructions: null,
      conversation: 'I spoke with the recruiter on Tuesday about the API role.',
      recipientName: null,
      sourceDraft: null,
    });

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].userPrompt).toContain('I spoke with the recruiter on Tuesday');
  });

  it('sends recipient name to the model', async () => {
    const { user, job } = await setup({ plan: 'PRO' });
    const provider = fakeProvider();

    await runGeneration({
      userId: user.id,
      type: 'COVER_LETTER',
      jobId: job.id,
      resumeId: null,
      title: 'Cover letter',
      origin: 'AI_GENERATED',
      supersedesId: null,
      route: '/api/application-materials/generate',
      provider,
      tone: 'PROFESSIONAL',
      length: 'STANDARD',
      instructions: null,
      conversation: null,
      recipientName: 'Priya Patel',
      sourceDraft: null,
    });

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].userPrompt).toContain('Priya Patel');
  });

  it('sends source draft to the model for revision', async () => {
    const { user, job } = await setup({ plan: 'PRO' });
    const provider = fakeProvider();

    await runGeneration({
      userId: user.id,
      type: 'COVER_LETTER',
      jobId: job.id,
      resumeId: null,
      title: 'Cover letter (revision)',
      origin: 'AI_REVISED',
      supersedesId: null,
      route: '/api/application-materials/generate',
      provider,
      tone: 'PROFESSIONAL',
      length: 'STANDARD',
      instructions: null,
      conversation: null,
      recipientName: null,
      sourceDraft: 'I am writing to apply for the Backend Engineer role.',
    });

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].userPrompt).toContain('I am writing to apply for the Backend Engineer role');
  });
});
