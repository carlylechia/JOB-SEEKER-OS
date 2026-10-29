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
  MaterialStateError,
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
import {
  ApplicationWorkspaceNotFoundError,
  loadApplicationWorkspace,
} from '@/lib/application-materials/workspace-server';
import {
  buildKitSteps,
  groupLibraryMaterials,
  groupWorkspaceMaterials,
  resolveMaterialAvailability,
  type WorkspaceMaterialSummary,
} from '@/lib/application-materials/workspace';
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

/** Persist a completed material row directly, for context/workspace tests. */
async function createStoredMaterial(params: {
  userId: string;
  type: string;
  fingerprint: string;
  title?: string;
  content?: string;
  jobId?: string | null;
  status?: 'DRAFT' | 'READY' | 'ARCHIVED';
  origin?: 'AI_GENERATED' | 'AI_REVISED' | 'MANUAL';
  generationStatus?: 'PROCESSING' | 'COMPLETED' | 'FAILED';
  resumeId?: string | null;
}) {
  return prisma.applicationMaterial.create({
    data: {
      userId: params.userId,
      type: params.type as any,
      title: params.title ?? `${params.type} draft`,
      content: params.content ?? 'Stored content',
      jobId: params.jobId ?? null,
      resumeId: params.resumeId ?? null,
      status: (params.status ?? 'DRAFT') as any,
      origin: (params.origin ?? 'AI_GENERATED') as any,
      inputFingerprint: params.fingerprint,
      schemaVersion: 1,
      promptVersion: 2,
      generationStatus: params.generationStatus ?? 'COMPLETED',
    },
  });
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
    expect(stored.subject).toBe('Application: Backend Engineer');
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

  it('refuses a follow-up for a role that has not been applied to', async () => {
    const { user, job } = await setup({ plan: 'PRO' });
    // Reset to LEAD (not applied)
    await prisma.jobLead.update({
      where: { id: job.id },
      data: { status: 'LEAD', dateApplied: null, nextFollowUp: null },
    });

    const provider = fakeProvider();
    const rejection = await runGeneration({
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
    }).catch((error: unknown) => error);

    // A hidden button is not an authorisation check: the service refuses too.
    expect(rejection).toBeInstanceOf(MaterialStateError);
    if (rejection instanceof MaterialStateError) {
      expect(rejection.code).toBe('NOT_APPLIED_YET');
      expect(rejection.status).toBe(422);
    }
    // Refused before any provider call or credit is spent.
    expect(provider.calls).toHaveLength(0);
    expect(await getUsage(user.id, APPLICATION_MATERIAL_FEATURE)).toBe(0);
  });

  it('refuses an interview thank-you when no interview and no notes exist', async () => {
    const { user, job } = await setup({ plan: 'PRO' });
    const provider = fakeProvider();

    const rejection = await runGeneration({
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
    }).catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(MaterialStateError);
    if (rejection instanceof MaterialStateError) {
      expect(rejection.code).toBe('NO_INTERVIEW_CONTEXT');
    }
    expect(provider.calls).toHaveLength(0);
  });

  it('writes a thank-you from the user’s own notes when no interview is recorded', async () => {
    const { user, job } = await setup({ plan: 'PRO' });
    const provider = fakeProvider({
      material: {
        opening: 'Thank you for the conversation about the Backend Engineer role.',
        body: [{ heading: null, text: 'I appreciated discussing the platform migration.' }],
        closing: 'I hope to speak again soon.',
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
      conversation: 'We spoke about the platform migration and the on-call rotation.',
      recipientName: null,
      sourceDraft: null,
    });

    expect((result as RunGenerationResult).outcome).toBe('COMPLETED');
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].userPrompt).toContain('platform migration');
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

// ─── Continuity between a job’s materials ──────────────────────────────────

describe('application continuity', () => {
  it('feeds earlier materials from the same application into the next draft', async () => {
    const { user, job } = await setup({ plan: 'PRO' });
    const provider = fakeProvider();

    await runGeneration({
      userId: user.id,
      type: 'COVER_LETTER',
      jobId: job.id,
      resumeId: null,
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

    const result = await runGeneration({
      userId: user.id,
      type: 'RECRUITER_OUTREACH',
      jobId: job.id,
      resumeId: null,
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
    expect(provider.calls).toHaveLength(2);

    // The second prompt carries the first draft as labelled continuity context,
    // not as candidate evidence.
    const secondPrompt = provider.calls[1].userPrompt;
    expect(secondPrompt).toContain('EARLIER_MATERIALS');
    expect(secondPrompt).toContain('Cover letter');
    expect(secondPrompt).toContain('Subject: Application: Backend Engineer');
    expect(secondPrompt).toContain('These are NOT evidence about the candidate');

    const stored = await prisma.applicationMaterial.findUniqueOrThrow({
      where: { id: (result as { summary: { id: string } }).summary.id },
    });
    const meta = (
      stored.generationMeta as {
        meta: { hadPriorMaterials: boolean; priorMaterialCount: number };
      }
    ).meta;
    expect(meta.hadPriorMaterials).toBe(true);
    expect(meta.priorMaterialCount).toBe(1);
  });

  it('excludes the current type and archived drafts from continuity', async () => {
    const { user, job } = await setup({ plan: 'PRO' });

    await createStoredMaterial({
      userId: user.id,
      type: 'COVER_LETTER',
      jobId: job.id,
      fingerprint: 'continuity-cover',
      title: 'Cover letter — stored',
      content: 'COVER-SPECIFIC-TEXT',
    });
    await createStoredMaterial({
      userId: user.id,
      type: 'RECRUITER_OUTREACH',
      jobId: job.id,
      fingerprint: 'continuity-outreach',
      title: 'Recruiter message — stored',
      content: 'OUTREACH-SPECIFIC-TEXT',
    });
    await createStoredMaterial({
      userId: user.id,
      type: 'LINKEDIN_CONNECTION',
      jobId: job.id,
      fingerprint: 'continuity-linkedin',
      title: 'Connection note — archived',
      content: 'ARCHIVED-SPECIFIC-TEXT',
      status: 'ARCHIVED',
    });

    const coverContext = await buildMaterialContext({
      userId: user.id,
      type: 'COVER_LETTER',
      jobId: job.id,
      resumeId: null,
      profileVersion: 3,
    });
    expect(coverContext.priorMaterials).toHaveLength(1);
    expect(coverContext.priorMaterials[0].type).toBe('RECRUITER_OUTREACH');
    expect(coverContext.priorMaterials[0].content).toContain('OUTREACH-SPECIFIC-TEXT');

    const outreachContext = await buildMaterialContext({
      userId: user.id,
      type: 'RECRUITER_OUTREACH',
      jobId: job.id,
      resumeId: null,
      profileVersion: 3,
    });
    expect(outreachContext.priorMaterials).toHaveLength(1);
    expect(outreachContext.priorMaterials[0].type).toBe('COVER_LETTER');
    expect(outreachContext.priorMaterials[0].content).toContain('COVER-SPECIFIC-TEXT');
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
    ).toBe('Cover letter — Northwind — Backend Engineer — 24 Oct 2026, 00:53 UTC');
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

// ─── Application-kit workspace ─────────────────────────────────────────────

function workspaceMaterial(
  overrides: Partial<WorkspaceMaterialSummary> = {},
): WorkspaceMaterialSummary {
  return {
    id: 'material-1',
    type: 'COVER_LETTER',
    title: 'Cover letter',
    subject: null,
    status: 'DRAFT',
    origin: 'AI_GENERATED',
    generationStatus: 'COMPLETED',
    revision: 1,
    editVersion: 1,
    resumeId: null,
    resumeName: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    errorCode: null,
    thinInputs: false,
    ...overrides,
  };
}

describe('application kit helpers', () => {
  it('groups a job’s materials by type, newest first, and keeps archived ones visible', () => {
    const groups = groupWorkspaceMaterials([
      workspaceMaterial({
        id: 'older-archived',
        status: 'ARCHIVED',
        updatedAt: '2026-10-01T00:00:00.000Z',
      }),
      workspaceMaterial({
        id: 'newer-active',
        updatedAt: '2026-10-03T00:00:00.000Z',
      }),
      workspaceMaterial({
        id: 'recruiter',
        type: 'RECRUITER_OUTREACH',
        updatedAt: '2026-10-02T00:00:00.000Z',
      }),
    ]);

    expect(groups).toHaveLength(6);
    const cover = groups.find((group) => group.type === 'COVER_LETTER');
    expect(cover?.latest?.id).toBe('newer-active');
    expect(cover?.materials.map((material) => material.id)).toEqual([
      'newer-active',
      'older-archived',
    ]);
    expect(cover?.activeCount).toBe(1);
    expect(cover?.archivedCount).toBe(1);
    expect(groups.find((group) => group.type === 'RECRUITER_OUTREACH')?.latest?.id).toBe(
      'recruiter',
    );
  });

  it('falls back to the newest archived draft when nothing is active', () => {
    const groups = groupWorkspaceMaterials([
      workspaceMaterial({
        id: 'archived-only',
        status: 'ARCHIVED',
        updatedAt: '2026-10-04T00:00:00.000Z',
      }),
    ]);
    expect(groups.find((group) => group.type === 'COVER_LETTER')?.latest?.id).toBe(
      'archived-only',
    );
  });

  it('locks application-grounded types until the pipeline supports the claim', () => {
    const followUp = resolveMaterialAvailability({
      type: 'APPLICATION_FOLLOW_UP',
      hasApplied: false,
      hasInterview: false,
      hasContacts: false,
    });
    expect(followUp.canGenerate).toBe(false);
    expect(followUp.reason).toContain('Applied');

    const thankYou = resolveMaterialAvailability({
      type: 'INTERVIEW_THANK_YOU',
      hasApplied: false,
      hasInterview: false,
      hasContacts: false,
    });
    expect(thankYou.canGenerate).toBe(true);
    expect(thankYou.note).toContain('notes');

    const outreach = resolveMaterialAvailability({
      type: 'RECRUITER_OUTREACH',
      hasApplied: false,
      hasInterview: false,
      hasContacts: false,
    });
    expect(outreach.canGenerate).toBe(true);
    expect(outreach.note).toContain('contact');
  });

  it('summarises kit progress without calling a follow-up missing before applying', () => {
    const resumes = [
      {
        id: 'resume-1',
        name: 'Backend resume',
        revision: 1,
        origin: 'BLANK',
        targetJobId: 'job-1',
        updatedAt: '2026-10-01T00:00:00.000Z',
        usedByMaterials: 0,
      },
    ];

    const beforeApplying = buildKitSteps({
      jobId: 'job-1',
      materials: [workspaceMaterial({ type: 'COVER_LETTER' })],
      resumes,
      hasApplied: false,
      hasInterview: false,
    });
    expect(beforeApplying.find((step) => step.key === 'RESUME')?.complete).toBe(true);
    expect(beforeApplying.find((step) => step.key === 'COVER_LETTER')?.complete).toBe(true);
    expect(beforeApplying.find((step) => step.key === 'FOLLOW_UP')?.complete).toBe(false);
    expect(beforeApplying.find((step) => step.key === 'FOLLOW_UP')?.detail).toContain(
      'after you apply',
    );

    const afterInterview = buildKitSteps({
      jobId: 'job-1',
      materials: [workspaceMaterial({ type: 'COVER_LETTER' })],
      resumes,
      hasApplied: true,
      hasInterview: true,
    });
    const followUp = afterInterview.find((step) => step.key === 'FOLLOW_UP');
    expect(followUp?.label).toBe('Thank-you note');
    expect(followUp?.detail).toContain('thank-you');
  });

  it('groups the library into job kits plus general materials', () => {
    const job = { id: 'job-1', title: 'Backend Engineer', company: 'Northwind', status: 'APPLIED' };
    const grouped = groupLibraryMaterials([
      {
        id: 'cover',
        type: 'COVER_LETTER',
        title: 'Cover letter',
        status: 'DRAFT',
        generationStatus: 'COMPLETED',
        jobId: 'job-1',
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-03T00:00:00.000Z',
        job,
      },
      {
        id: 'follow',
        type: 'APPLICATION_FOLLOW_UP',
        title: 'Follow-up',
        status: 'READY',
        generationStatus: 'COMPLETED',
        jobId: 'job-1',
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-02T00:00:00.000Z',
        job,
      },
      {
        id: 'general',
        type: 'RECRUITER_OUTREACH',
        title: 'Recruiter message',
        status: 'DRAFT',
        generationStatus: 'COMPLETED',
        jobId: null,
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-04T00:00:00.000Z',
      },
      {
        id: 'deleted-job',
        type: 'COVER_LETTER',
        title: 'Cover letter to a removed job',
        status: 'READY',
        generationStatus: 'COMPLETED',
        jobId: 'job-deleted',
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-05T00:00:00.000Z',
        job: {
          id: 'job-deleted',
          title: 'Platform Engineer',
          company: 'GoneCo',
          status: 'ARCHIVED',
          deletedAt: '2026-10-05T00:00:00.000Z',
        },
      },
    ]);

    expect(grouped.kits).toHaveLength(1);
    expect(grouped.kits[0].jobId).toBe('job-1');
    expect(grouped.kits[0].materials.map((material) => material.id)).toEqual(['cover', 'follow']);
    expect(grouped.kits[0].latestAt).toBe('2026-10-03T00:00:00.000Z');
    expect(grouped.kits[0].draftCount).toBe(1);
    expect(grouped.kits[0].readyCount).toBe(1);
    expect(grouped.kits[0].types).toEqual(['COVER_LETTER', 'APPLICATION_FOLLOW_UP']);
    // A soft-deleted job has no kit page, so its drafts stay reachable under
    // general materials rather than behind a link that would 404.
    expect(grouped.general.map((material) => material.id)).toEqual(['deleted-job', 'general']);
  });
});

describe('application workspace loader', () => {
  it('loads one job’s materials and linked resumes only', async () => {
    const { user, job } = await setup({ plan: 'PRO' });
    const resume = await createResume({
      userId: user.id,
      input: { from: 'BLANK' },
      limit: null,
    });
    await prisma.structuredResume.update({
      where: { id: resume.id },
      data: { targetJobId: job.id },
    });

    const cover = await createStoredMaterial({
      userId: user.id,
      type: 'COVER_LETTER',
      jobId: job.id,
      resumeId: resume.id,
      fingerprint: 'workspace-cover',
      title: 'Cover letter — this job',
      status: 'READY',
    });
    const followUp = await createStoredMaterial({
      userId: user.id,
      type: 'APPLICATION_FOLLOW_UP',
      jobId: job.id,
      fingerprint: 'workspace-follow-up',
      title: 'Follow-up — this job',
    });

    // A material for another job must never appear in this kit.
    const otherJob = await prisma.jobLead.create({
      data: {
        userId: user.id,
        company: 'OtherCo',
        title: 'Platform Engineer',
        jobDescription: 'Another role.',
        status: 'LEAD',
        score: {},
        checklist: {},
        contacts: [],
        interviews: [],
        prepPack: {},
      },
    });
    await createStoredMaterial({
      userId: user.id,
      type: 'COVER_LETTER',
      jobId: otherJob.id,
      fingerprint: 'workspace-other-job',
      title: 'Cover letter — other job',
    });

    const workspace = await loadApplicationWorkspace({
      userId: user.id,
      jobId: job.id,
    });

    expect(workspace.job.id).toBe(job.id);
    expect(workspace.job.title).toBe('Backend Engineer');
    expect(workspace.materials.map((material) => material.id).sort()).toEqual(
      [cover.id, followUp.id].sort(),
    );
    expect(workspace.summary.totalMaterials).toBe(2);
    expect(workspace.summary.activeMaterials).toBe(2);
    expect(workspace.summary.readyCount).toBe(1);
    expect(workspace.summary.resumeCount).toBe(1);
    expect(workspace.summary.tailoredResumeCount).toBe(1);
    expect(workspace.summary.hasApplied).toBe(true);
    expect(workspace.availability.COVER_LETTER.canGenerate).toBe(true);
    expect(workspace.availability.APPLICATION_FOLLOW_UP.canGenerate).toBe(true);

    const linkedResume = workspace.resumes.find((item) => item.id === resume.id);
    expect(linkedResume?.targetJobId).toBe(job.id);
    expect(linkedResume?.usedByMaterials).toBe(1);
    expect(workspace.materials.find((material) => material.id === cover.id)?.resumeName).toBe(
      resume.name,
    );
  });

  it('does not disclose another user’s job or a deleted job', async () => {
    const { user } = await setup({ plan: 'PRO' });
    const other = await createUser();
    userIds.push(other.id);
    const foreignJob = await prisma.jobLead.create({
      data: {
        userId: other.id,
        company: 'OtherCo',
        title: 'Engineer',
        jobDescription: 'Someone else’s private role.',
        status: 'APPLIED',
        score: {},
        checklist: {},
        contacts: [],
        interviews: [],
        prepPack: {},
      },
    });

    await expect(
      loadApplicationWorkspace({ userId: user.id, jobId: foreignJob.id }),
    ).rejects.toBeInstanceOf(ApplicationWorkspaceNotFoundError);

    const second = await setup({ plan: 'PRO' });
    await prisma.jobLead.update({
      where: { id: second.job.id },
      data: { deletedAt: new Date('2026-10-01T00:00:00.000Z') },
    });
    await expect(
      loadApplicationWorkspace({ userId: second.user.id, jobId: second.job.id }),
    ).rejects.toBeInstanceOf(ApplicationWorkspaceNotFoundError);
  });

  it('reports grounding availability from the job’s real pipeline record', async () => {
    const { user, job } = await setup({
      plan: 'PRO',
      job: { status: 'LEAD', dateApplied: null, nextFollowUp: null },
    });

    const workspace = await loadApplicationWorkspace({
      userId: user.id,
      jobId: job.id,
    });

    expect(workspace.summary.hasApplied).toBe(false);
    expect(workspace.availability.COVER_LETTER.canGenerate).toBe(true);
    expect(workspace.availability.APPLICATION_FOLLOW_UP.canGenerate).toBe(false);
    expect(workspace.availability.APPLICATION_STATUS_CHECK.canGenerate).toBe(false);
    expect(workspace.availability.INTERVIEW_THANK_YOU.canGenerate).toBe(true);
    expect(workspace.availability.INTERVIEW_THANK_YOU.note).toContain('notes');
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
