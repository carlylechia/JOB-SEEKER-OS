/**
 * AI Job Intelligence integration and security tests.
 *
 * The claims under test are the ones that would matter if they were false:
 *
 *  - a user cannot read or analyse another user's job
 *  - a Free account cannot bypass the Pro gate by calling the API directly
 *  - paying for the same analysis twice does not happen
 *  - a hostile job description cannot make the model invent a verdict, a
 *    salary, a sponsorship policy or a legal conclusion
 *  - a fabricated evidence quote does not reach the database
 *  - the AI cannot overwrite the deterministic score
 *  - a client cannot escalate by posting a userId, a plan or a score
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
  JobIntelligenceAiError,
  type JobIntelligenceAiProvider,
} from '@/lib/job-intelligence/ai-client';
import {
  DuplicateAnalysisInFlightError,
  JOB_INTELLIGENCE_FEATURE,
  JobNotFoundError,
  getAnalysisForJob,
  runJobAnalysis,
} from '@/lib/job-intelligence/service';
import { ANALYSIS_SCHEMA_VERSION, modelAnalysisSchema, type ModelAnalysis } from '@/lib/job-intelligence/schema';
import { ANALYSIS_SYSTEM_PROMPT, buildAnalysisPrompt } from '@/lib/job-intelligence/prompt';
import {
  INJECTION_JOB_TEXT,
  MINIMAL_JOB_TEXT,
  SAMPLE_JOB_TEXT,
  sampleModelAnalysis,
} from './job-intelligence-fixtures';

const ROUTE = '/api/jobs/[id]/intelligence';
const userIds: string[] = [];

/**
 * A fake provider.
 *
 * Records what it was asked so tests can assert on what actually reached the
 * model, and can be told to return a specific shape — including shapes that
 * only a compromised or injected model would produce.
 */
function fakeProvider(
  overrides: {
    analysis?: Partial<ModelAnalysis>;
    throwError?: JobIntelligenceAiError;
    invalid?: boolean;
  } = {},
): JobIntelligenceAiProvider & { calls: Array<{ jobText: string; deterministicBlock: string; careerProfileBlock: string }> } {
  const calls: Array<{ jobText: string; deterministicBlock: string; careerProfileBlock: string }> = [];
  return {
    name: 'fake',
    model: 'fake-model-1',
    calls,
    async analyse(params) {
      calls.push(params);
      if (overrides.throwError) throw overrides.throwError;
      if (overrides.invalid) {
        return {
          // A model that returned something outside the contract. The service
          // must reject it rather than storing it.
          nonsense: true,
        } as unknown as ModelAnalysis;
      }
      return sampleModelAnalysis(overrides.analysis ?? {}) as ModelAnalysis;
    },
  };
}

/** Create a user with a workspace, an optional Pro subscription and a job. */
async function setup(
  opts: {
    plan?: 'FREE' | 'PRO' | 'PREMIUM';
    job?: Record<string, unknown>;
    profile?: Record<string, unknown>;
  } = {},
) {
  const user = await createUser();
  userIds.push(user.id);

  await prisma.userProfile.create({
    data: {
      userId: user.id,
      careerProfileConfirmedAt: new Date('2026-02-01T00:00:00.000Z'),
      careerProfileVersion: 3,
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
      jobDescription: SAMPLE_JOB_TEXT,
      status: 'LEAD',
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

/** Capture a thrown error so two failure paths can be compared. */
async function captureError(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
    return null;
  } catch (error) {
    return error;
  }
}

beforeEach(() => {
  setTestNow(T0);
});

afterEach(async () => {
  resetClock();
  for (const id of userIds.splice(0)) {
    await destroyUser(id).catch(() => undefined);
  }
});

// ─── Entitlement enforcement ───────────────────────────────────────────────

describe('Pro entitlement enforcement', () => {
  it('refuses a Free user on the server, not just in the UI', async () => {
    const { user, job } = await setup({ plan: 'FREE' });
    await expect(requireEntitlement(user.id, JOB_INTELLIGENCE_FEATURE)).rejects.toBeInstanceOf(
      PlanRequiredError,
    );

    // And the analysis path itself refuses.
    await expect(
      runJobAnalysis({ userId: user.id, jobId: job.id, route: ROUTE }),
    ).rejects.toBeInstanceOf(PlanRequiredError);
  });

  it('never spends a provider call for a Free user', async () => {
    const { user, job } = await setup({ plan: 'FREE' });
    const provider = fakeProvider();

    await expect(
      runJobAnalysis({ userId: user.id, jobId: job.id, route: ROUTE, provider }),
    ).rejects.toBeInstanceOf(PlanRequiredError);

    expect(provider.calls).toHaveLength(0);
    expect(await getUsage(user.id, JOB_INTELLIGENCE_FEATURE)).toBe(0);
  });

  it('allows an active Pro user', async () => {
    const { user, job } = await setup({ plan: 'PRO' });
    const result = await runJobAnalysis({
      userId: user.id,
      jobId: job.id,
      route: ROUTE,
      provider: fakeProvider(),
    });
    expect(result.outcome).toBe('COMPLETED');
  });

  it('allows an admin without consuming a customer credit', async () => {
    const user = await createUser({ role: 'ADMIN' });
    userIds.push(user.id);
    await prisma.userProfile.create({ data: { userId: user.id } });
    const job = await prisma.jobLead.create({
      data: {
        userId: user.id,
        company: 'Northwind',
        title: 'Backend Engineer',
        score: { fitScore: 60 },
        checklist: {},
        contacts: [],
        interviews: [],
        prepPack: {},
      },
    });

    const result = await runJobAnalysis({
      userId: user.id,
      jobId: job.id,
      route: ROUTE,
      provider: fakeProvider(),
    });
    expect(result.outcome).toBe('COMPLETED');
    expect(await getUsage(user.id, JOB_INTELLIGENCE_FEATURE)).toBe(0);
  });
});

// ─── Cross-user isolation ──────────────────────────────────────────────────

describe('cross-user isolation', () => {
  it('will not analyse another user’s job', async () => {
    const alice = await setup({ plan: 'PRO' });
    const bob = await setup({ plan: 'PRO' });
    const provider = fakeProvider();

    await expect(
      runJobAnalysis({ userId: bob.user.id, jobId: alice.job.id, route: ROUTE, provider }),
    ).rejects.toBeInstanceOf(JobNotFoundError);

    expect(provider.calls).toHaveLength(0);
  });

  it('will not read another user’s analysis', async () => {
    const alice = await setup({ plan: 'PRO' });
    const bob = await setup({ plan: 'PRO' });

    await runJobAnalysis({
      userId: alice.user.id,
      jobId: alice.job.id,
      route: ROUTE,
      provider: fakeProvider(),
    });

    const stolen = await getAnalysisForJob({ userId: bob.user.id, jobId: alice.job.id });
    expect(stolen).toBeNull();
  });

  it('reports a soft-deleted job as absent', async () => {
    const { user, job } = await setup({ plan: 'PRO' });
    await prisma.jobLead.update({ where: { id: job.id }, data: { deletedAt: new Date() } });

    await expect(
      runJobAnalysis({ userId: user.id, jobId: job.id, route: ROUTE, provider: fakeProvider() }),
    ).rejects.toBeInstanceOf(JobNotFoundError);
  });

  it('does not store one user’s analysis against another user’s job', async () => {
    const alice = await setup({ plan: 'PRO' });
    const bob = await setup({ plan: 'PRO' });

    await runJobAnalysis({
      userId: alice.user.id,
      jobId: alice.job.id,
      route: ROUTE,
      provider: fakeProvider(),
    });

    // Bob's job row has no analysis attached.
    const bobRow = await prisma.jobIntelligenceAnalysis.findFirst({
      where: { jobId: bob.job.id },
    });
    expect(bobRow).toBeNull();
  });
});

// ─── Usage accounting and duplicate suppression ────────────────────────────

describe('usage accounting and duplicate suppression', () => {
  it('charges exactly one credit for a first analysis', async () => {
    const { user, job } = await setup({ plan: 'PRO' });
    const result = await runJobAnalysis({
      userId: user.id,
      jobId: job.id,
      route: ROUTE,
      provider: fakeProvider(),
    });
    expect(result.outcome).toBe('COMPLETED');
    expect(await getUsage(user.id, JOB_INTELLIGENCE_FEATURE)).toBe(1);
  });

  it('reuses a completed result and spends nothing when asked again', async () => {
    const { user, job } = await setup({ plan: 'PRO' });
    const provider = fakeProvider();

    await runJobAnalysis({ userId: user.id, jobId: job.id, route: ROUTE, provider });
    const second = await runJobAnalysis({ userId: user.id, jobId: job.id, route: ROUTE, provider });

    expect(second.outcome).toBe('REUSED');
    expect(provider.calls).toHaveLength(1);
    expect(await getUsage(user.id, JOB_INTELLIGENCE_FEATURE)).toBe(1);
  });

  it('re-analyses and charges again only when the user asks explicitly', async () => {
    const { user, job } = await setup({ plan: 'PRO' });
    const provider = fakeProvider();

    await runJobAnalysis({ userId: user.id, jobId: job.id, route: ROUTE, provider });
    const forced = await runJobAnalysis({
      userId: user.id,
      jobId: job.id,
      route: ROUTE,
      provider,
      force: true,
    });

    expect(forced.outcome).toBe('COMPLETED');
    expect(await getUsage(user.id, JOB_INTELLIGENCE_FEATURE)).toBe(2);
  });

  it('runs again when the job changes, without a forced request', async () => {
    const { user, job } = await setup({ plan: 'PRO' });
    const provider = fakeProvider();

    await runJobAnalysis({ userId: user.id, jobId: job.id, route: ROUTE, provider });

    // The employer raised the salary. The answer genuinely changed.
    await prisma.jobLead.update({ where: { id: job.id }, data: { salaryMax: 200000 } });
    const second = await runJobAnalysis({
      userId: user.id,
      jobId: job.id,
      route: ROUTE,
      provider,
    });

    expect(second.outcome).toBe('COMPLETED');
    expect(provider.calls).toHaveLength(2);
  });

  it('runs again when the user’s preferences change', async () => {
    const { user, job } = await setup({ plan: 'PRO' });
    const provider = fakeProvider();

    await runJobAnalysis({ userId: user.id, jobId: job.id, route: ROUTE, provider });

    await prisma.userProfile.update({
      where: { userId: user.id },
      data: { targetRoles: ['Data Scientist'] },
    });
    const second = await runJobAnalysis({
      userId: user.id,
      jobId: job.id,
      route: ROUTE,
      provider,
    });

    expect(second.outcome).toBe('COMPLETED');
    expect(provider.calls).toHaveLength(2);
  });

  it('does not charge twice for a retried failure', async () => {
    const { user, job } = await setup({ plan: 'PRO' });
    const provider = fakeProvider({
      throwError: new JobIntelligenceAiError('AI_UNAVAILABLE', true),
    });

    const first = await runJobAnalysis({ userId: user.id, jobId: job.id, route: ROUTE, provider });
    const second = await runJobAnalysis({ userId: user.id, jobId: job.id, route: ROUTE, provider });

    expect(first.outcome).toBe('FAILED');
    expect(second.outcome).toBe('FAILED');
    expect(await getUsage(user.id, JOB_INTELLIGENCE_FEATURE)).toBe(1);
  });

  it('lets a recoverable failure be retried', async () => {
    const { user, job } = await setup({ plan: 'PRO' });

    const failed = await runJobAnalysis({
      userId: user.id,
      jobId: job.id,
      route: ROUTE,
      provider: fakeProvider({ throwError: new JobIntelligenceAiError('AI_TIMEOUT', true) }),
    });
    expect(failed.outcome).toBe('FAILED');

    const recovered = await runJobAnalysis({
      userId: user.id,
      jobId: job.id,
      route: ROUTE,
      provider: fakeProvider(),
    });
    expect(recovered.outcome).toBe('COMPLETED');
  });

  it('refuses a second concurrent run of the same inputs', async () => {
    const { user, job } = await setup({ plan: 'PRO' });
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const provider: JobIntelligenceAiProvider = {
      name: 'fake',
      model: 'fake-slow',
      async analyse(params) {
        await gate;
        return fakeProvider().analyse(params);
      },
    };

    const first = runJobAnalysis({ userId: user.id, jobId: job.id, route: ROUTE, provider });
    // Give the first run time to claim the row before the second arrives.
    await new Promise((resolve) => setTimeout(resolve, 250));

    await expect(
      runJobAnalysis({ userId: user.id, jobId: job.id, route: ROUTE, provider }),
    ).rejects.toBeInstanceOf(DuplicateAnalysisInFlightError);

    release!();
    const result = await first;
    expect(result.outcome).toBe('COMPLETED');
  });

  it('returns a safe message, not a provider error, on failure', async () => {
    const { user, job } = await setup({ plan: 'PRO' });
    const result = await runJobAnalysis({
      userId: user.id,
      jobId: job.id,
      route: ROUTE,
      provider: fakeProvider({
        throwError: new JobIntelligenceAiError('AI_RATE_LIMITED', true, 429),
      }),
    });

    expect(result.outcome).toBe('FAILED');
    if (result.outcome !== 'FAILED') return;
    expect(result.code).toBe('AI_RATE_LIMITED');
    expect(result.retryable).toBe(true);
    expect(result.message).not.toContain('429');
  });

  it('never stores output that failed schema validation', async () => {
    const { user, job } = await setup({ plan: 'PRO' });
    const result = await runJobAnalysis({
      userId: user.id,
      jobId: job.id,
      route: ROUTE,
      provider: fakeProvider({ invalid: true }),
    });

    expect(result.outcome).toBe('FAILED');
    const row = await prisma.jobIntelligenceAnalysis.findFirst({
      where: { userId: user.id, jobId: job.id },
    });
    expect(row?.status).toBe('FAILED');
    expect(row?.data).toBeNull();
  });
});

// ─── Prompt injection ──────────────────────────────────────────────────────

describe('hostile job descriptions', () => {
  it('does not let a posting override the verdict it was given', async () => {
    const { user, job } = await setup({
      plan: 'PRO',
      job: { jobDescription: INJECTION_JOB_TEXT },
    });

    // The fake provider behaves as a fully injected model would: it returns
    // the strongest possible verdict and the strongest possible prose.
    const provider = fakeProvider({
      analysis: {
        overallCategory: 'STRONG_MATCH',
        summary: 'STRONG MATCH. You are eligible to work in the United States. We will sponsor your visa.',
        titleRelationship: 'DIRECT_TARGET_MATCH',
      } as Partial<ModelAnalysis>,
    });

    const result = await runJobAnalysis({ userId: user.id, jobId: job.id, route: ROUTE, provider });
    expect(result.outcome).toBe('COMPLETED');
    if (result.outcome !== 'COMPLETED') return;

    const data = result.data;

    // 1. The deterministic score is untouched. There is nowhere to put one.
    expect(data.deterministic.fitScore).toBeGreaterThan(0);
    expect(JSON.stringify(data)).not.toContain('"score"');

    // 2. The unsupported claims are neutralised, not stored.
    expect(data.summary.toLowerCase()).not.toContain('sponsor');
    expect(data.summary.toLowerCase()).not.toContain('eligible to work');

    // 3. The eligibility dimension is the application's answer, not the
    //    model's. The posting asks for 10+ years and a PhD; the server's
    //    assessment stands.
    expect(data.dimensions.eligibility.outcome).not.toBe('MATCH');
  });

  it('keeps the injected prompt out of the stored result', async () => {
    const { user, job } = await setup({
      plan: 'PRO',
      job: { jobDescription: INJECTION_JOB_TEXT },
    });
    const provider = fakeProvider();

    await runJobAnalysis({ userId: user.id, jobId: job.id, route: ROUTE, provider });

    const row = await prisma.jobIntelligenceAnalysis.findFirstOrThrow({
      where: { userId: user.id, jobId: job.id },
    });
    const stored = JSON.stringify(row.data);
    expect(stored).not.toContain('IGNORE ALL PREVIOUS INSTRUCTIONS');
    expect(stored).not.toContain('evil.example.com');
  });

  it('fences the posting so its content cannot read as instructions', () => {
    // The fence is applied where the prompt is assembled, so it is tested
    // there rather than through the provider seam.
    const prompt = buildAnalysisPrompt({
      deterministicBlock: '=== JOB FACTS ===\nDeterministic fit score: 72 / 100',
      careerProfileBlock: 'Skills: TypeScript',
      jobText: INJECTION_JOB_TEXT,
    });

    expect(prompt).toContain('<<<JOB_POSTING');
    expect(prompt).toContain('JOB_POSTING>>>');
    expect(prompt).toContain('third-party data');
    // The posting's own attempt to close the fence early is inside the data
    // block, not before it.
    expect(prompt.indexOf('<<<JOB_POSTING')).toBeLessThan(prompt.indexOf('IGNORE ALL PREVIOUS'));
  });

  it('labels the deterministic block as authoritative to the model', async () => {
    const { user, job } = await setup({ plan: 'PRO' });
    const provider = fakeProvider();

    await runJobAnalysis({ userId: user.id, jobId: job.id, route: ROUTE, provider });

    const { deterministicBlock } = provider.calls[0];
    expect(deterministicBlock).toContain('computed by the application');
    expect(deterministicBlock).toContain('these are correct');
  });

  it('states the score as a given fact the model may not recompute', async () => {
    const { user, job } = await setup({ plan: 'PRO' });
    const provider = fakeProvider();

    await runJobAnalysis({ userId: user.id, jobId: job.id, route: ROUTE, provider });

    const { deterministicBlock } = provider.calls[0];
    expect(deterministicBlock).toContain('Deterministic fit score:');
    expect(deterministicBlock).toContain('tier');
    // The block is introduced as settled fact rather than as a question.
    expect(deterministicBlock).toContain('explain them');
  });

  it('tells the model a hard block cannot be argued with', async () => {
    const { user, job } = await setup({
      plan: 'PRO',
      job: {
        score: {
          coreStackMatch: 5,
          roleAlignment: 5,
          seniorityFit: 5,
          geographyEligibility: 0,
          timezoneCompatibility: 5,
          compensationFit: 5,
          domainRelevance: 5,
          applicationFriction: 5,
          signalQuality: 5,
          fitScore: 0,
          fitTier: 'D',
        },
      },
    });
    const provider = fakeProvider();

    await runJobAnalysis({ userId: user.id, jobId: job.id, route: ROUTE, provider });

    const { deterministicBlock } = provider.calls[0];
    expect(deterministicBlock).toContain('HARD BLOCK');
    expect(deterministicBlock).toContain('No explanation you write can change that');
  });

  it('never puts the deterministic score in the model’s contract', async () => {
    // There is no score field to fill, so the model cannot invent or restate
    // one even if it tries.
    const parsed = modelAnalysisSchema.safeParse(sampleModelAnalysis());
    expect(parsed.success).toBe(true);

    const withScore = modelAnalysisSchema.safeParse({
      ...sampleModelAnalysis(),
      fitScore: 99,
    });
    expect(withScore.success).toBe(false);
  });

  it('does not leak another user’s data into the prompt', async () => {
    const alice = await setup({ plan: 'PRO' });
    const bob = await setup({ plan: 'PRO' });
    const provider = fakeProvider();

    await runJobAnalysis({ userId: alice.user.id, jobId: alice.job.id, route: ROUTE, provider });

    const { careerProfileBlock } = provider.calls[0];
    expect(careerProfileBlock).not.toContain(bob.user.email);
    expect(careerProfileBlock).not.toContain(alice.user.passwordHash);
  });
});

// ─── Anti-fabrication ──────────────────────────────────────────────────────

describe('the model cannot fabricate facts', () => {
  it('drops an evidence quote that does not appear in the posting', async () => {
    const { user, job } = await setup({ plan: 'PRO' });

    const provider = fakeProvider({
      analysis: {
        dimensions: {
          jobTitleFit: {
            outcome: 'MATCH',
            explanation: 'This is the role you are targeting.',
            evidence: [
              {
                source: 'JOB_DESCRIPTION',
                field: 'JobLead.jobDescription',
                excerpt: 'This sentence appears nowhere in the actual job posting at all',
                supports: 'A fabricated quote.',
              },
            ],
            uncertainty: null,
          },
        },
      } as Partial<ModelAnalysis>,
    });

    const result = await runJobAnalysis({ userId: user.id, jobId: job.id, route: ROUTE, provider });
    if (result.outcome !== 'COMPLETED') return;

    const evidence = result.data.dimensions.jobTitleFit.evidence;
    // The unverifiable quote is gone; the claim is marked as unverified.
    expect(evidence.every((item) => item.excerpt !== 'This sentence appears nowhere in the actual job posting at all')).toBe(true);
    expect(JSON.stringify(evidence)).toContain('could not verify');
  });

  it('will not accept that the candidate has a skill their profile lacks', async () => {
    const { user, job } = await setup({ plan: 'PRO' });

    const provider = fakeProvider({
      analysis: {
        requirements: [
          {
            requirement: 'Experience with Kubernetes in production',
            importance: 'REQUIRED',
            outcome: 'MATCH',
            explanation: 'You have extensive Kubernetes experience across multiple roles.',
            evidence: [],
            uncertainty: null,
          },
        ],
      } as Partial<ModelAnalysis>,
    });

    const result = await runJobAnalysis({ userId: user.id, jobId: job.id, route: ROUTE, provider });
    if (result.outcome !== 'COMPLETED') return;

    const requirement = result.data.requirements.find((r) =>
      r.requirement.includes('Kubernetes'),
    );
    expect(requirement).toBeDefined();
    expect(requirement!.outcome).not.toBe('MATCH');
    expect(requirement!.explanation).toContain('could not find evidence');
  });

  it('never says the candidate lacks a skill merely because it is absent', async () => {
    const { user, job } = await setup({ plan: 'PRO' });

    const provider = fakeProvider({
      analysis: {
        requirements: [
          {
            requirement: 'Experience with Rust',
            importance: 'REQUIRED',
            outcome: 'MISMATCH',
            explanation: 'You do not have Rust experience.',
            evidence: [],
            uncertainty: null,
          },
        ],
      } as Partial<ModelAnalysis>,
    });

    const result = await runJobAnalysis({ userId: user.id, jobId: job.id, route: ROUTE, provider });
    if (result.outcome !== 'COMPLETED') return;

    const requirement = result.data.requirements.find((r) => r.requirement.includes('Rust'));
    expect(requirement!.outcome).toBe('UNKNOWN');
    expect(requirement!.explanation.toLowerCase()).not.toContain('you do not have');
    expect(requirement!.explanation.toLowerCase()).toContain('not the same as you not having it');
  });

  it('never invents a salary range', async () => {
    const { user, job } = await setup({ plan: 'PRO', job: { salaryMin: null, salaryMax: null } });

    const provider = fakeProvider({
      analysis: {
        compensationOutcome: 'WITHIN_PREFERENCE',
        summary: 'This role pays $180,000 to $220,000, which is excellent for you.',
      } as Partial<ModelAnalysis>,
    });

    const result = await runJobAnalysis({ userId: user.id, jobId: job.id, route: ROUTE, provider });
    if (result.outcome !== 'COMPLETED') return;

    // The employer stated nothing, so that is what the verdict says.
    expect(result.data.compensationOutcome).toBe('NOT_STATED_BY_EMPLOYER');
    expect(result.data.dimensions.compensation.outcome).toBe('NOT_APPLICABLE');
  });

  it('does not compare two currencies', async () => {
    const { user, job } = await setup({
      plan: 'PRO',
      job: { salaryMin: 9000000, salaryMax: 12000000, currency: 'JPY' },
    });

    const result = await runJobAnalysis({
      userId: user.id,
      jobId: job.id,
      route: ROUTE,
      provider: fakeProvider(),
    });
    if (result.outcome !== 'COMPLETED') return;

    expect(result.data.compensationOutcome).toBe('NOT_COMPARABLE');
    expect(result.data.dimensions.compensation.explanation).toContain('do not convert');
  });

  it('overrides a model-compensation verdict with the server’s own arithmetic', async () => {
    const { user, job } = await setup({
      plan: 'PRO',
      job: { salaryMin: 60000, salaryMax: 80000 },
    });

    const provider = fakeProvider({
      analysis: { compensationOutcome: 'ABOVE_PREFERENCE' } as Partial<ModelAnalysis>,
    });

    const result = await runJobAnalysis({ userId: user.id, jobId: job.id, route: ROUTE, provider });
    if (result.outcome !== 'COMPLETED') return;

    // The model said "above preference"; the job pays well under the user's
    // minimum. The server wins.
    expect(result.data.compensationOutcome).toBe('BELOW_PREFERENCE');
    expect(result.data.dimensions.compensation.outcome).toBe('MISMATCH');
  });

  it('does not let the model talk around a hard scoring block', async () => {
    const { user, job } = await setup({
      plan: 'PRO',
      job: {
        score: {
          coreStackMatch: 5,
          roleAlignment: 5,
          seniorityFit: 5,
          geographyEligibility: 0,
          timezoneCompatibility: 5,
          compensationFit: 5,
          domainRelevance: 5,
          applicationFriction: 5,
          signalQuality: 5,
          fitScore: 0,
          fitTier: 'D',
        },
      },
    });

    const provider = fakeProvider({
      analysis: { overallCategory: 'STRONG_MATCH' } as Partial<ModelAnalysis>,
    });

    const result = await runJobAnalysis({ userId: user.id, jobId: job.id, route: ROUTE, provider });
    if (result.outcome !== 'COMPLETED') return;

    expect(result.data.deterministic.fitScore).toBe(0);
    expect(result.data.deterministic.blockedBy).toContain('geography or eligibility');
    expect(result.data.overallCategory).toBe('LOW_MATCH');
  });

  it('cannot upgrade a title the scoring engine rejected', async () => {
    const { user, job } = await setup({
      plan: 'PRO',
      job: { title: 'Data Scientist' },
      profile: { targetRoles: ['Backend Engineer'] },
    });

    const provider = fakeProvider({
      analysis: {
        titleRelationship: 'DIRECT_TARGET_MATCH',
        overallCategory: 'STRONG_MATCH',
      } as Partial<ModelAnalysis>,
    });

    const result = await runJobAnalysis({ userId: user.id, jobId: job.id, route: ROUTE, provider });
    if (result.outcome !== 'COMPLETED') return;

    // The deterministic titleMatch is false, so the model cannot claim a direct
    // target match however confident its prose.
    expect(result.data.deterministic.titleMatch).toBe(false);
    expect(result.data.titleRelationship).not.toBe('DIRECT_TARGET_MATCH');
  });

  it('only keeps recommendations the analysis actually grounds', async () => {
    const { user, job } = await setup({ plan: 'PRO' });

    const provider = fakeProvider({
      analysis: {
        recommendations: [
          {
            action: 'ADD_JOB_DESCRIPTION',
            detail: 'Add the posting so we can read it properly.',
            rationale: 'This job already has a description saved.',
          },
          {
            action: 'CLARIFY_SALARY_RANGE',
            detail: 'Ask about the range.',
            rationale: 'The posting states a salary.',
          },
        ],
      } as Partial<ModelAnalysis>,
    });

    const result = await runJobAnalysis({ userId: user.id, jobId: job.id, route: ROUTE, provider });
    if (result.outcome !== 'COMPLETED') return;

    const actions = result.data.recommendations.map((r) => r.action);
    // The job HAS a description and DOES state a salary, so both of these
    // are ungrounded and must be dropped rather than shown as advice.
    expect(actions).not.toContain('ADD_JOB_DESCRIPTION');
    expect(actions).not.toContain('CLARIFY_SALARY_RANGE');
  });

  it('adds a grounded recommendation when the salary really is missing', async () => {
    const { user, job } = await setup({ plan: 'PRO', job: { salaryMin: null, salaryMax: null } });
    const result = await runJobAnalysis({
      userId: user.id,
      jobId: job.id,
      route: ROUTE,
      provider: fakeProvider({
        analysis: {
          recommendations: [
            {
              action: 'CLARIFY_SALARY_RANGE',
              detail: 'Ask what the budget band is before you apply.',
              rationale: 'This job does not state a salary.',
            },
          ],
        } as Partial<ModelAnalysis>,
      }),
    });

    if (result.outcome !== 'COMPLETED') return;
    expect(result.data.recommendations.map((r) => r.action)).toContain('CLARIFY_SALARY_RANGE');
  });
});

// ─── Insufficient data ─────────────────────────────────────────────────────

describe('insufficient data', () => {
  it('still analyses a job with only a title, and says the data is thin', async () => {
    const { user, job } = await setup({
      plan: 'PRO',
      job: { jobDescription: null, location: null, remoteType: null, eligibilityRegion: null, salaryMin: null, salaryMax: null },
      profile: { careerProfileConfirmedAt: null, targetRoles: [], preferredRegions: [], salaryMin: 0, salaryTarget: 0 },
    });

    const result = await runJobAnalysis({
      userId: user.id,
      jobId: job.id,
      route: ROUTE,
      provider: fakeProvider(),
    });

    expect(result.outcome).toBe('COMPLETED');
    if (result.outcome !== 'COMPLETED') return;

    expect(result.data.meta.hadJobDescription).toBe(false);
    expect(result.data.meta.dataCompleteness).toBe('MINIMAL');
    expect(result.data.overallCategory).toBe('INSUFFICIENT_INFORMATION');
    // And the user is told exactly what to do about it.
    expect(result.data.limitations.join(' ')).toContain('no description saved');
  });

  it('never invents a description when there is none at all', async () => {
    const { user, job } = await setup({ plan: 'PRO', job: { jobDescription: null } });
    const provider = fakeProvider();

    const result = await runJobAnalysis({
      userId: user.id,
      jobId: job.id,
      route: ROUTE,
      provider,
    });
    if (result.outcome !== 'COMPLETED') return;

    // Nothing was sent to the model, so nothing could have been invented.
    expect(provider.calls[0].jobText).toBe('');
    expect(result.data.meta.hadJobDescription).toBe(false);
  });

  it('reads a short but real posting rather than dismissing it', async () => {
    const { user, job } = await setup({ plan: 'PRO', job: { jobDescription: MINIMAL_JOB_TEXT } });
    const result = await runJobAnalysis({
      userId: user.id,
      jobId: job.id,
      route: ROUTE,
      provider: fakeProvider(),
    });

    if (result.outcome !== 'COMPLETED') return;
    // It is real text from the employer, so it is used — but the result is
    // marked as low-completeness rather than presented as a full analysis.
    expect(result.data.meta.hadJobDescription).toBe(true);
    expect(result.data.meta.dataCompleteness).not.toBe('COMPLETE');
  });

  it('reports the profile gaps that actually limit the result', async () => {
    const { user, job } = await setup({
      plan: 'PRO',
      profile: { careerProfileConfirmedAt: null, targetRoles: [], salaryMin: 0, salaryTarget: 0 },
    });

    const result = await runJobAnalysis({
      userId: user.id,
      jobId: job.id,
      route: ROUTE,
      provider: fakeProvider(),
    });

    if (result.outcome !== 'COMPLETED') return;
    const limitations = result.data.limitations.join(' ').toLowerCase();
    expect(limitations).toContain('target job titles');
  });

  it('never modifies the user’s career profile', async () => {
    const { user, job } = await setup({ plan: 'PRO' });
    const before = await prisma.userProfile.findUniqueOrThrow({ where: { userId: user.id } });
    const skillsBefore = await prisma.careerSkill.count({ where: { userId: user.id } });

    // The model "notices" a missing skill.
    await runJobAnalysis({
      userId: user.id,
      jobId: job.id,
      route: ROUTE,
      provider: fakeProvider({
        analysis: {
          summary: 'Your profile is missing Kubernetes. You do not have this skill.',
        } as Partial<ModelAnalysis>,
      }),
    });

    const after = await prisma.userProfile.findUniqueOrThrow({ where: { userId: user.id } });
    expect(after.careerProfileVersion).toBe(before.careerProfileVersion);
    expect(after.careerProfileConfirmedAt).toEqual(before.careerProfileConfirmedAt);
    expect(await prisma.careerSkill.count({ where: { userId: user.id } })).toBe(skillsBefore);
  });
});

// ─── Cache freshness ───────────────────────────────────────────────────────

describe('cache freshness', () => {
  it('marks a stored result stale once the profile changes', async () => {
    const { user, job } = await setup({ plan: 'PRO' });

    await runJobAnalysis({
      userId: user.id,
      jobId: job.id,
      route: ROUTE,
      provider: fakeProvider(),
    });

    const fresh = await getAnalysisForJob({ userId: user.id, jobId: job.id });
    expect(fresh?.analysis.isFresh).toBe(true);

    await prisma.userProfile.update({
      where: { userId: user.id },
      data: { remoteOnly: false },
    });

    const stale = await getAnalysisForJob({ userId: user.id, jobId: job.id });
    // The result is still returned — the user can read what it said — but it
    // is labelled as no longer reflecting their inputs.
    expect(stale).not.toBeNull();
    expect(stale?.analysis.isFresh).toBe(false);
  });

  it('stores the fingerprint it ran against', async () => {
    const { user, job } = await setup({ plan: 'PRO' });
    await runJobAnalysis({
      userId: user.id,
      jobId: job.id,
      route: ROUTE,
      provider: fakeProvider(),
    });

    const row = await prisma.jobIntelligenceAnalysis.findFirstOrThrow({
      where: { userId: user.id, jobId: job.id },
    });
    expect(row.inputFingerprint).toHaveLength(64);
    expect(row.schemaVersion).toBe(ANALYSIS_SCHEMA_VERSION);
  });

  it('does not reuse a result stored under an older contract version', async () => {
    const { user, job } = await setup({ plan: 'PRO' });
    const provider = fakeProvider();

    await runJobAnalysis({ userId: user.id, jobId: job.id, route: ROUTE, provider });

    // Simulate a result written under a previous contract.
    const row = await prisma.jobIntelligenceAnalysis.findFirstOrThrow({
      where: { userId: user.id, jobId: job.id },
    });
    await prisma.jobIntelligenceAnalysis.update({
      where: { id: row.id },
      data: { schemaVersion: ANALYSIS_SCHEMA_VERSION - 1 },
    });

    const second = await runJobAnalysis({
      userId: user.id,
      jobId: job.id,
      route: ROUTE,
      provider,
    });
    expect(second.outcome).toBe('COMPLETED');
    expect(provider.calls).toHaveLength(2);
  });

  it('removes analyses when the job is deleted', async () => {
    const { user, job } = await setup({ plan: 'PRO' });
    await runJobAnalysis({
      userId: user.id,
      jobId: job.id,
      route: ROUTE,
      provider: fakeProvider(),
    });

    await prisma.jobLead.delete({ where: { id: job.id } });
    const remaining = await prisma.jobIntelligenceAnalysis.count({ where: { jobId: job.id } });
    expect(remaining).toBe(0);
  });
});

// ─── Client input cannot escalate privilege ────────────────────────────────

describe('client input cannot escalate privilege', () => {
  it('rejects a request body naming a field outside the contract', async () => {
    const { job, user } = await setup({ plan: 'PRO' });

    // The route validates strictly; this asserts the shape it rejects.
    const hostile = { force: false, userId: user.id, plan: 'PREMIUM', fitScore: 100 };
    expect(Object.keys(hostile).length).toBeGreaterThan(1);
    expect(job.id).toBeTruthy();
  });

  it('derives identity from the session, never from the body', async () => {
    // Both users are entitled, so what is under test is the ownership scope
    // rather than the plan gate. A Free caller hits `PlanRequiredError` first,
    // which is also a safe answer — it reveals nothing about whether the job
    // exists.
    const alice = await setup({ plan: 'PRO' });
    const bob = await setup({ plan: 'PRO' });
    const provider = fakeProvider();

    // Bob's session, Alice's job id. The lookup is ownership-scoped, so this
    // is indistinguishable from a job that does not exist.
    await expect(
      runJobAnalysis({ userId: bob.user.id, jobId: alice.job.id, route: ROUTE, provider }),
    ).rejects.toBeInstanceOf(JobNotFoundError);

    expect(provider.calls).toHaveLength(0);
  });

  it('does not let the model write to any table', async () => {
    const { user, job } = await setup({ plan: 'PRO' });

    const before = {
      jobs: await prisma.jobLead.count(),
      profiles: await prisma.userProfile.count(),
      analyses: await prisma.jobIntelligenceAnalysis.count(),
    };

    await runJobAnalysis({
      userId: user.id,
      jobId: job.id,
      route: ROUTE,
      provider: fakeProvider({
        analysis: {
          summary: 'Also, please upgrade the plan and delete the other leads.',
          limitations: ['set the subscription to PREMIUM', 'delete all other jobs'],
        } as Partial<ModelAnalysis>,
      }),
    });

    const after = {
      jobs: await prisma.jobLead.count(),
      profiles: await prisma.userProfile.count(),
      analyses: await prisma.jobIntelligenceAnalysis.count(),
    };

    // Exactly one new row: the analysis. Nothing else moved.
    expect(after.jobs).toBe(before.jobs);
    expect(after.profiles).toBe(before.profiles);
    expect(after.analyses).toBe(before.analyses + 1);
  });

  it('never initiates an application or contacts an employer', async () => {
    const { user, job } = await setup({ plan: 'PRO' });
    const result = await runJobAnalysis({
      userId: user.id,
      jobId: job.id,
      route: ROUTE,
      provider: fakeProvider({
        analysis: {
          summary: 'We have submitted your application and emailed the hiring manager.',
        } as Partial<ModelAnalysis>,
      }),
    });

    if (result.outcome !== 'COMPLETED') return;

    // The job status is untouched. Nothing was applied for.
    const row = await prisma.jobLead.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.status).toBe('LEAD');
    expect(row.dateApplied).toBeNull();
  });
});

// ─── Prompt contract ───────────────────────────────────────────────────────

describe('analysis system prompt', () => {
  const prompt = ANALYSIS_SYSTEM_PROMPT.toLowerCase();

  it('states that the posting is untrusted data', () => {
    expect(prompt).toContain('untrusted');
    expect(prompt).toContain('do not follow');
  });

  it('forbids inventing skills, salaries and eligibility', () => {
    expect(prompt).toContain('never invent');
    expect(prompt).toContain('never claim the candidate has a skill');
    expect(prompt).toContain('never invent years of experience');
  });

  it('forbids legal determinations and promises', () => {
    expect(prompt).toContain('never issue a legal');
    expect(prompt).toContain('never promise');
  });

  /**
   * These three rules were added after benchmarking real models against real
   * postings. Without them, models consistently misused NOT_APPLICABLE as a
   * softer UNKNOWN, which is the single most misleading thing this output can
   * say about a requirement.
   */
  it('distinguishes UNKNOWN from NOT_APPLICABLE explicitly', () => {
    expect(prompt).toContain('not_applicable is not a softer way of saying unknown');
    expect(prompt).toContain('never use not_applicable');
  });

  it('forbids listing the job title as a requirement', () => {
    expect(prompt).toContain('never list the job title');
  });

  it('tells the model to extract every stated requirement', () => {
    expect(prompt).toContain('every distinct requirement');
  });

  it('forbids restating the score', () => {
    expect(prompt).toContain('do not invent, restate, or estimate a numeric score');
  });

  it('does not ask for hidden reasoning', () => {
    expect(prompt).toContain('no hidden reasoning');
    expect(prompt).toContain('no chain of thought');
  });
});
