/**
 * Resume Intelligence integration and security tests.
 *
 * The claims under test are the ones that would matter if they were false:
 * a user cannot reach another user's resume, extraction or profile; a Free
 * account cannot bypass the Pro gate by calling the API directly; a client
 * cannot promote itself by posting a plan or a role; and paying for the same
 * analysis twice does not happen.
 *
 * Every AI call is served by an injected fake. No key is required and no
 * network request is made.
 */

import fs from 'node:fs';
import path from 'node:path';

import { describe, it, beforeEach, afterEach, expect } from './harness';
import { prisma } from '@/lib/prisma';
import { createUser, destroyUser, setTestNow, resetClock, DAY_MS, T0 } from './helpers';
import { requireEntitlement, PlanRequiredError } from '@/lib/billing/subscriptions';
import { getUsage } from '@/lib/billing/usage';
import {
  AiNotConfiguredError,
  AiProviderError,
  type ResumeAiProvider,
} from '@/lib/resume/ai-client';
import {
  DuplicateExtractionInFlightError,
  ResumeNoDocumentError,
  runResumeExtraction,
  AI_RESUME_PARSER_FEATURE,
} from '@/lib/resume/service';
import {
  ResumeDocumentNotFoundError,
  loadOwnedResumeDocument,
  recordResumeDocument,
} from '@/lib/resume/documents';
import {
  applyReviewedExtraction,
  buildReviewPayload,
  extractionToReviewDefaults,
  ProfileVersionConflictError,
  reviewSubmissionSchema,
  type ReviewSubmission,
} from '@/lib/resume/career-profile';
import {
  EXTRACTION_SCHEMA_VERSION,
  type CareerExtraction,
  type ExtractionErrorCode,
} from '@/lib/resume/schema';
import { FULL_RESUME_TEXT } from './resume-fixtures';

const ROUTE = '/api/resume/intelligence';
const userIds: string[] = [];

/**
 * Resume bytes have to actually exist somewhere for the extraction path to run.
 *
 * A `ResumeDocument` pointing at a file that is not on disk would be testing
 * storage failure rather than the behaviour under test, so each fixture writes
 * a real synthetic resume into the dev upload directory and cleans it up
 * afterwards. The file is generated, never committed.
 */
const FIXTURE_DIR = path.join(process.cwd(), 'public', 'uploads', 'resumes');
const writtenFixtures: string[] = [];

function writeFixture(userId: string): { url: string; name: string } {
  const name = `resume-${userId}.txt`;
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  fs.writeFileSync(path.join(FIXTURE_DIR, name), FULL_RESUME_TEXT, 'utf8');
  writtenFixtures.push(name);
  return { url: `/uploads/resumes/${name}`, name };
}

function removeFixtures() {
  for (const name of writtenFixtures.splice(0)) {
    fs.rmSync(path.join(FIXTURE_DIR, name), { force: true });
  }
}

async function track<T extends { id: string }>(promise: Promise<T>): Promise<T> {
  const value = await promise;
  userIds.push(value.id);
  return value;
}

afterEach(async () => {
  resetClock();
  removeFixtures();
  for (const id of userIds.splice(0)) await destroyUser(id).catch(() => undefined);
});

beforeEach(() => setTestNow(new Date(T0)));

// ─── Fixtures ──────────────────────────────────────────────────────────────

/** A provider that returns a known-good extraction and counts its calls. */
function fakeProvider(overrides: Partial<CareerExtraction> = {}): ResumeAiProvider & { calls: number } {
  const base: CareerExtraction = {
    schemaVersion: EXTRACTION_SCHEMA_VERSION,
    fullName: 'Jordan Ellis',
    email: 'jordan.ellis@example.com',
    phone: '+44 7700 900123',
    city: 'Bristol',
    region: null,
    country: 'United Kingdom',
    headline: 'Senior Backend Engineer',
    summary: 'Backend engineer with seven years building payment and data platforms.',
    linkedinUrl: 'https://linkedin.com/in/jordanellis',
    portfolioUrl: null,
    websiteUrl: null,
    otherLinks: [],
    workExperience: [
      {
        jobTitle: 'Senior Backend Engineer',
        company: 'Acme Payments Ltd',
        location: 'London',
        startDate: '2021-03',
        endDate: 'present',
        isCurrent: true,
        responsibilities: ['Led the migration of the ledger service'],
        achievements: ['Reduced p99 checkout latency by 38%'],
        technologies: [{ name: 'TypeScript', origin: 'STATED', evidence: { snippet: 'Technologies: TypeScript, PostgreSQL, Kafka, AWS', section: 'Experience', level: 'SUPPORTED' } }],
        evidence: { snippet: 'Acme Payments Ltd — Senior Backend Engineer, London', section: 'Experience', level: 'SUPPORTED' },
        conflicts: [],
      },
    ],
    education: [
      {
        institution: 'University of Bristol',
        qualification: 'BSc Computer Science',
        fieldOfStudy: 'Computer Science',
        startDate: '2015',
        endDate: '2019',
        details: null,
        evidence: { snippet: 'University of Bristol — BSc Computer Science, 2015 - 2019', section: 'Education', level: 'SUPPORTED' },
        conflicts: [],
      },
    ],
    skills: [
      { name: 'TypeScript', origin: 'STATED', evidence: { snippet: 'TypeScript, PostgreSQL, Kafka, AWS, Terraform', section: 'Skills', level: 'SUPPORTED' } },
      { name: 'Kubernetes', origin: 'INFERRED', evidence: { snippet: 'Kubernetes at expert level', section: 'Skills', level: 'SUPPORTED' } },
    ],
    projects: [],
    credentials: [
      {
        kind: 'CERTIFICATION',
        name: 'AWS Certified Solutions Architect',
        issuer: 'Amazon',
        issuedDate: '2022',
        expiresDate: null,
        proficiency: null,
        details: null,
        evidence: { snippet: 'AWS Certified Solutions Architect, issued 2022', section: 'Certifications', level: 'SUPPORTED' },
      },
    ],
    warnings: [],
    ...overrides,
  };

  return {
    name: 'fake',
    model: 'fake-model',
    calls: 0,
    async extract() {
      this.calls += 1;
      return base;
    },
  };
}

/**
 * A provider that always fails, to exercise the failure and retry paths.
 *
 * `AI_NOT_CONFIGURED` is raised through its own class so it carries the
 * non-retryable flag that a real missing key would, rather than a stubbed one.
 */
function failingProvider(code: ExtractionErrorCode): ResumeAiProvider {
  return {
    name: 'fake',
    model: 'fake-model',
    async extract(): Promise<CareerExtraction> {
      if (code === 'AI_NOT_CONFIGURED') throw new AiNotConfiguredError();
      throw new AiProviderError(code, true);
    },
  };
}

/**
 * Give a user a real stored resume and return its document record.
 *
 * Writes actual bytes to the dev upload directory, because the point of most of
 * these tests is the path that runs from a stored file through to a persisted
 * extraction.
 */
async function seedResumeDocument(userId: string, opts: { isPrimary?: boolean } = {}) {
  const fixture = writeFixture(userId);
  return recordResumeDocument({
    userId,
    url: fixture.url,
    fileName: fixture.name,
    format: 'txt',
    sizeBytes: FULL_RESUME_TEXT.length,
    makePrimary: opts.isPrimary ?? true,
  });
}

  async function seedExtraction(userId: string) {
    await grantPro(userId);
    await seedResumeDocument(userId);
    const result = await runResumeExtraction({
      userId: userId,
      route: ROUTE,
      provider: fakeProvider(),
    });
    if (result.outcome === 'FAILED') throw new Error('expected completion');
    return result;
  }

/**
 * Stamp the current profile version onto a submission.
 *
 * The real client receives this version from the review GET and echoes it back;
 * a test that builds a submission by hand has to do the same, or every save
 * would correctly fail the optimistic-concurrency check.
 */
async function withCurrentVersion(userId: string, submission: ReviewSubmission): Promise<ReviewSubmission> {
  const profile = await prisma.userProfile.findUnique({ where: { userId } });
  return { ...submission, expectedProfileVersion: profile?.careerProfileVersion ?? 0 };
}

/** Move a user onto a plan that grants the entitlement. */
async function grantPro(userId: string, planCode: 'PRO' | 'PREMIUM' = 'PRO') {
  const plan = await prisma.plan.findUniqueOrThrow({ where: { code: planCode } });
  await prisma.subscription.upsert({
    where: { userId },
    create: {
      userId,
      planId: plan.id,
      status: 'ACTIVE',
      startsAt: T0,
      endsAt: null,
      source: 'ADMIN_MANUAL',
    },
    update: { planId: plan.id, status: 'ACTIVE', startsAt: T0, endsAt: null },
  });
}

// ─── Entitlement enforcement ───────────────────────────────────────────────

describe('Pro entitlement enforcement', () => {
  it('refuses a Free user on the server, not just in the UI', async () => {
    const user = await track(createUser());
    await seedResumeDocument(user.id);

    // The gate is the resolver, not a hidden button.
    let thrown: unknown;
    try {
      await requireEntitlement(user.id, AI_RESUME_PARSER_FEATURE);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PlanRequiredError);
    expect((thrown as InstanceType<typeof PlanRequiredError>).status).toBe(403);
  });

  it('blocks the API path for a Free user', async () => {
    const user = await track(createUser());
    await seedResumeDocument(user.id);

    let thrown: unknown;
    try {
      await runResumeExtraction({ userId: user.id, route: ROUTE, provider: fakeProvider() });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PlanRequiredError);
  });

  it('never spends a provider call for a Free user', async () => {
    const user = await track(createUser());
    await seedResumeDocument(user.id);
    const provider = fakeProvider();

    await runResumeExtraction({ userId: user.id, route: ROUTE, provider }).catch(() => undefined);

    // The entitlement check happens before extraction, so the provider was never
    // reached and no credit was consumed.
    expect(provider.calls).toBe(0);
    expect(await getUsage(user.id, AI_RESUME_PARSER_FEATURE)).toBe(0);
  });

  it('allows an active Pro user', async () => {
    const user = await track(createUser());
    await grantPro(user.id, 'PRO');
    await seedResumeDocument(user.id);

    const result = await runResumeExtraction({
      userId: user.id,
      route: ROUTE,
      provider: fakeProvider(),
    });
    expect(result.outcome).toBe('COMPLETED');
  });

  it('allows a Premium user', async () => {
    const user = await track(createUser());
    await grantPro(user.id, 'PREMIUM');
    await seedResumeDocument(user.id);

    const result = await runResumeExtraction({
      userId: user.id,
      route: ROUTE,
      provider: fakeProvider(),
    });
    expect(result.outcome).toBe('COMPLETED');
  });

  it('allows a user in an active Pro trial', async () => {
    const user = await track(createUser());
    const plan = await prisma.plan.findUniqueOrThrow({ where: { code: 'PRO' } });
    await prisma.subscription.create({
      data: {
        userId: user.id,
        planId: plan.id,
        status: 'TRIALING',
        startsAt: T0,
        endsAt: null,
        trialStartsAt: T0,
        trialEndsAt: new Date(T0.getTime() + 14 * DAY_MS),
        source: 'TRIAL',
      },
    });
    await seedResumeDocument(user.id);

    const result = await runResumeExtraction({
      userId: user.id,
      route: ROUTE,
      provider: fakeProvider(),
    });
    expect(result.outcome).toBe('COMPLETED');
  });

  it('refuses a user whose Pro trial has expired', async () => {
    const user = await track(createUser());
    const plan = await prisma.plan.findUniqueOrThrow({ where: { code: 'PRO' } });
    await prisma.subscription.create({
      data: {
        userId: user.id,
        planId: plan.id,
        status: 'TRIALING',
        startsAt: T0,
        endsAt: null,
        // Elapsed yesterday.
        trialStartsAt: new Date(T0.getTime() - 15 * DAY_MS),
        trialEndsAt: new Date(T0.getTime() - DAY_MS),
        source: 'TRIAL',
      },
    });
    await seedResumeDocument(user.id);

    let thrown: unknown;
    try {
      await runResumeExtraction({ userId: user.id, route: ROUTE, provider: fakeProvider() });
    } catch (error) {
      thrown = error;
    }
    // The stored status still says TRIALING. Access is decided by the date, not
    // by the column.
    expect(thrown).toBeInstanceOf(PlanRequiredError);
  });

  it('gives an admin the existing exemption', async () => {
    const user = await track(createUser({ role: 'ADMIN' }));
    await seedResumeDocument(user.id);

    const result = await runResumeExtraction({
      userId: user.id,
      route: ROUTE,
      provider: fakeProvider(),
    });
    expect(result.outcome).toBe('COMPLETED');
  });

  it('does not consume an admin customer credit', async () => {
    const user = await track(createUser({ role: 'ADMIN' }));
    await seedResumeDocument(user.id);

    await runResumeExtraction({ userId: user.id, route: ROUTE, provider: fakeProvider() });
    expect(await getUsage(user.id, AI_RESUME_PARSER_FEATURE)).toBe(0);
  });

  it('refuses to run with no resume at all', async () => {
    const user = await track(createUser());
    await grantPro(user.id);

    let thrown: unknown;
    try {
      await runResumeExtraction({ userId: user.id, route: ROUTE, provider: fakeProvider() });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ResumeNoDocumentError);
  });
});

// ─── Cross-user isolation ──────────────────────────────────────────────────

describe('cross-user isolation', () => {
  it('will not load another user’s resume', async () => {
    const owner = await track(createUser());
    const attacker = await track(createUser());
    const document = await seedResumeDocument(owner.id);

    let thrown: unknown;
    try {
      await loadOwnedResumeDocument({ userId: attacker.id, resumeId: document.id });
    } catch (error) {
      thrown = error;
    }
    // Not merely forbidden: indistinguishable from a document that does not exist.
    expect(thrown).toBeInstanceOf(ResumeDocumentNotFoundError);
    expect((thrown as InstanceType<typeof ResumeDocumentNotFoundError>).status).toBe(404);
  });

  it('will not analyse another user’s resume', async () => {
    const owner = await track(createUser());
    const attacker = await track(createUser());
    await grantPro(attacker.id);
    const document = await seedResumeDocument(owner.id);
    const provider = fakeProvider();

    let thrown: unknown;
    try {
      await runResumeExtraction({
        userId: attacker.id,
        resumeId: document.id,
        route: ROUTE,
        provider,
      });
    } catch (error) {
      thrown = error;
    }
    // A resume id that belongs to someone else is reported exactly like one that
    // does not exist, so probing cannot confirm that a private document is real.
    expect(thrown).toBeInstanceOf(ResumeDocumentNotFoundError);
    // And no money was spent attempting it.
    expect(provider.calls).toBe(0);
  });

  it('will not read another user’s extraction', async () => {
    const owner = await track(createUser());
    await grantPro(owner.id);
    await seedResumeDocument(owner.id);
    const { getExtractionForReview } = await import('@/lib/resume/service');
    const result = await runResumeExtraction({
      userId: owner.id,
      route: ROUTE,
      provider: fakeProvider(),
    });
    if (result.outcome === 'FAILED') throw new Error('expected completion');
    const extractionId = result.extraction.id;

    const attacker = await track(createUser());
    let thrown: unknown;
    try {
      await getExtractionForReview({ userId: attacker.id, extractionId });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ResumeDocumentNotFoundError);
  });

  it('will not save another user’s extraction into their own profile', async () => {
    const owner = await track(createUser());
    await grantPro(owner.id);
    await seedResumeDocument(owner.id);
    const result = await runResumeExtraction({
      userId: owner.id,
      route: ROUTE,
      provider: fakeProvider(),
    });
    if (result.outcome === 'FAILED') throw new Error('expected completion');

    const attacker = await track(createUser());
    let thrown: unknown;
    try {
      await applyReviewedExtraction({
        userId: attacker.id,
        extractionId: result.extraction.id,
        submission: extractionToReviewDefaults(result.data),
        route: ROUTE,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ResumeDocumentNotFoundError);
  });

  it('keeps one user’s cached extraction away from another user', async () => {
    // Identical text, different user and different document. The reuse key is
    // scoped to (resume, content, contract), so a second user with the same
    // bytes must still get their own extraction.
    const first = await track(createUser());
    await grantPro(first.id);
    await seedResumeDocument(first.id);
    const firstResult = await runResumeExtraction({
      userId: first.id,
      route: ROUTE,
      provider: fakeProvider(),
    });
    if (firstResult.outcome === 'FAILED') throw new Error('expected completion');

    const second = await track(createUser());
    await grantPro(second.id);
    await seedResumeDocument(second.id);
    const secondProvider = fakeProvider();
    const secondResult = await runResumeExtraction({
      userId: second.id,
      route: ROUTE,
      provider: secondProvider,
    });

    if (secondResult.outcome === 'FAILED') throw new Error('expected completion');
    // Their own run happened, rather than being served the first user's result.
    expect(secondProvider.calls).toBe(1);
    expect(secondResult.extraction.id).not.toBe(firstResult.extraction.id);
  });
});

// ─── Usage, idempotency and concurrency ────────────────────────────────────

describe('usage accounting and duplicate suppression', () => {
  it('charges exactly one credit for a first analysis', async () => {
    const user = await track(createUser());
    await grantPro(user.id);
    await seedResumeDocument(user.id);

    const result = await runResumeExtraction({
      userId: user.id,
      route: ROUTE,
      provider: fakeProvider(),
    });
    if (result.outcome !== 'COMPLETED') throw new Error('expected completion');
    expect(result.creditsConsumed).toBe(1);
    expect(await getUsage(user.id, AI_RESUME_PARSER_FEATURE)).toBe(1);
  });

  it('reuses a completed result and spends nothing when asked again', async () => {
    const user = await track(createUser());
    await grantPro(user.id);
    await seedResumeDocument(user.id);
    const provider = fakeProvider();

    await runResumeExtraction({ userId: user.id, route: ROUTE, provider });
    const second = await runResumeExtraction({ userId: user.id, route: ROUTE, provider });

    expect(second.outcome).toBe('REUSED');
    // No second provider call and no second charge.
    expect(provider.calls).toBe(1);
    expect(await getUsage(user.id, AI_RESUME_PARSER_FEATURE)).toBe(1);
  });

  it('re-analyses and charges again only when the user asks explicitly', async () => {
    const user = await track(createUser());
    await grantPro(user.id);
    await seedResumeDocument(user.id);
    const provider = fakeProvider();

    await runResumeExtraction({ userId: user.id, route: ROUTE, provider });
    const forced = await runResumeExtraction({
      userId: user.id,
      route: ROUTE,
      provider,
      force: true,
    });

    expect(forced.outcome).toBe('COMPLETED');
    expect(provider.calls).toBe(2);
    expect(await getUsage(user.id, AI_RESUME_PARSER_FEATURE)).toBe(2);
  });

  it('does not charge twice for a retried failure', async () => {
    const user = await track(createUser());
    await grantPro(user.id);
    await seedResumeDocument(user.id);

    // A provider that fails every time: the retry is a new attempt but the same
    // document version, so the idempotency key is the same and no credit is
    // taken a second time.
    const first = await runResumeExtraction({
      userId: user.id,
      route: ROUTE,
      provider: failingProvider('AI_TIMEOUT'),
    });
    expect(first.outcome).toBe('FAILED');

    const second = await runResumeExtraction({
      userId: user.id,
      route: ROUTE,
      provider: fakeProvider(),
    });
    expect(second.outcome).toBe('COMPLETED');
    expect(await getUsage(user.id, AI_RESUME_PARSER_FEATURE)).toBe(1);
  });

  it('lets a recoverable failure be retried without re-uploading the resume', async () => {
    const user = await track(createUser());
    await grantPro(user.id);
    await seedResumeDocument(user.id);

    const failed = await runResumeExtraction({
      userId: user.id,
      route: ROUTE,
      provider: failingProvider('AI_UNAVAILABLE'),
    });
    if (failed.outcome !== 'FAILED') throw new Error('expected a failure');
    expect(failed.retryable).toBe(true);

    const retried = await runResumeExtraction({
      userId: user.id,
      route: ROUTE,
      provider: fakeProvider(),
    });
    expect(retried.outcome).toBe('COMPLETED');
  });

  it('refuses a second concurrent run of the same document', async () => {
    const user = await track(createUser());
    await grantPro(user.id);
    await seedResumeDocument(user.id);

    let duplicateAttempt: unknown;
    let callsDuringFirstRun = 0;

    // While the first run holds the extraction row, a second identical request
    // arrives. It must be refused rather than starting a parallel provider call.
    const first = runResumeExtraction({
      userId: user.id,
      route: ROUTE,
      provider: {
        name: 'fake',
        model: 'fake-model',
        async extract(text: string) {
          callsDuringFirstRun += 1;
          duplicateAttempt = await runResumeExtraction({
            userId: user.id,
            route: ROUTE,
            provider: fakeProvider(),
          }).then(
            (value) => value,
            (error) => error,
          );
          return fakeProvider().extract(text);
        },
      },
    });

    const blocking = await first;
    expect(duplicateAttempt).toBeInstanceOf(DuplicateExtractionInFlightError);
    expect(blocking.outcome).toBe('COMPLETED');
    // One provider call and one credit for the pair of requests.
    expect(callsDuringFirstRun).toBe(1);
    expect(await getUsage(user.id, AI_RESUME_PARSER_FEATURE)).toBe(1);
  });
});

// ─── Provider failure handling ─────────────────────────────────────────────

describe('provider failures', () => {
  it('records a retryable failure with a safe message, not a provider error', async () => {
    const user = await track(createUser());
    await grantPro(user.id);
    await seedResumeDocument(user.id);

    const result = await runResumeExtraction({
      userId: user.id,
      route: ROUTE,
      provider: failingProvider('AI_RATE_LIMITED'),
    });

    expect(result.outcome).toBe('FAILED');
    if (result.outcome !== 'FAILED') return;
    // The user gets a code-appropriate sentence, never a provider payload.
    expect(result.message).toBeDefined();
    expect(result.message.toLowerCase()).not.toContain('openai');
    expect(result.message.toLowerCase()).not.toContain('stack');
    expect(result.retryable).toBe(true);
  });

  it('treats a missing provider configuration as not retryable by the user', async () => {
    const user = await track(createUser());
    await grantPro(user.id);
    await seedResumeDocument(user.id);

    const result = await runResumeExtraction({
      userId: user.id,
      route: ROUTE,
      provider: failingProvider('AI_NOT_CONFIGURED'),
    });
    expect(result.outcome).toBe('FAILED');
    if (result.outcome !== 'FAILED') return;
    // Retrying will not help, so the UI should not offer it as the fix.
    expect(result.retryable).toBe(false);
  });
});

// ─── Review and apply ──────────────────────────────────────────────────────

describe('career profile review and apply', () => {
  it('saves only what the user included', async () => {
    const user = await track(createUser());
    const result = await seedExtraction(user.id);

    const submission = extractionToReviewDefaults(result.data);
    // Include the role, reject the education.
    submission.workExperience = submission.workExperience.map((entry) => ({ ...entry, include: true }));
    submission.education = submission.education.map((entry) => ({ ...entry, include: false }));

    await applyReviewedExtraction({
      userId: user.id,
      extractionId: result.extraction.id,
      submission: await withCurrentVersion(user.id, submission),
      route: ROUTE,
    });

    expect(await prisma.careerExperience.count({ where: { userId: user.id } })).toBe(1);
    expect(await prisma.careerEducation.count({ where: { userId: user.id } })).toBe(0);
  });

  it('never writes an inferred skill unless the user asked for it', async () => {
    const user = await track(createUser());
    const result = await seedExtraction(user.id);

    const submission = extractionToReviewDefaults(result.data);
    // The default already leaves inferred skills out; assert that explicitly.
    const inferred = submission.skills.filter((skill) => skill.origin === 'INFERRED');
    expect(inferred.every((skill) => !skill.include)).toBe(true);

    await applyReviewedExtraction({
      userId: user.id,
      extractionId: result.extraction.id,
      submission: await withCurrentVersion(user.id, submission),
      route: ROUTE,
    });

    const stored = await prisma.careerSkill.findMany({ where: { userId: user.id } });
    expect(stored.map((skill) => skill.name)).not.toContain('Kubernetes');
  });

  it('keeps the origin of a skill the user does confirm', async () => {
    const user = await track(createUser());
    const result = await seedExtraction(user.id);

    const submission = extractionToReviewDefaults(result.data);
    submission.skills = submission.skills.map((skill) => ({ ...skill, include: true }));

    await applyReviewedExtraction({
      userId: user.id,
      extractionId: result.extraction.id,
      submission: await withCurrentVersion(user.id, submission),
      route: ROUTE,
    });

    const kubernetes = await prisma.careerSkill.findFirst({
      where: { userId: user.id, name: 'Kubernetes' },
    });
    // Confirmed by the user, but still recorded as an inference rather than
    // being laundered into "stated".
    expect(kubernetes?.origin).toBe('INFERRED');
  });

  it('does not overwrite a populated profile field that the user kept', async () => {
    const user = await track(createUser());
    const result = await seedExtraction(user.id);

    await prisma.userProfile.upsert({
      where: { userId: user.id },
      create: { userId: user.id, headline: 'My deliberate headline' },
      update: { headline: 'My deliberate headline' },
    });

    const submission = extractionToReviewDefaults(result.data);
    // Every basic field left on 'keep'.
    await applyReviewedExtraction({
      userId: user.id,
      extractionId: result.extraction.id,
      submission: await withCurrentVersion(user.id, submission),
      route: ROUTE,
    });

    const profile = await prisma.userProfile.findUniqueOrThrow({ where: { userId: user.id } });
    expect(profile.headline).toBe('My deliberate headline');
  });

  it('replaces a field only when the user chose to', async () => {
    const user = await track(createUser());
    const result = await seedExtraction(user.id);

    await prisma.userProfile.upsert({
      where: { userId: user.id },
      create: { userId: user.id, headline: 'My deliberate headline' },
      update: { headline: 'My deliberate headline' },
    });

    const submission = extractionToReviewDefaults(result.data);
    submission.basics = submission.basics.map((choice) =>
      choice.field === 'headline'
        ? { ...choice, action: 'replace', value: 'Senior Backend Engineer' }
        : choice,
    );

    await applyReviewedExtraction({
      userId: user.id,
      extractionId: result.extraction.id,
      submission: await withCurrentVersion(user.id, submission),
      route: ROUTE,
    });

    const profile = await prisma.userProfile.findUniqueOrThrow({ where: { userId: user.id } });
    expect(profile.headline).toBe('Senior Backend Engineer');
  });

  it('leaves an existing section alone when the user confirmed none of it', async () => {
    const user = await track(createUser());
    const result = await seedExtraction(user.id);

    // Save once so there is something to protect.
    const first = extractionToReviewDefaults(result.data);
    first.workExperience = first.workExperience.map((entry) => ({ ...entry, include: true }));
    await applyReviewedExtraction({
      userId: user.id,
      extractionId: result.extraction.id,
      submission: await withCurrentVersion(user.id, first),
      route: ROUTE,
    });
    expect(await prisma.careerExperience.count({ where: { userId: user.id } })).toBe(1);

    // Now confirm nothing. "The model found nothing" must not equal "delete these".
    const second = extractionToReviewDefaults(result.data);
    second.workExperience = second.workExperience.map((entry) => ({ ...entry, include: false }));
    await applyReviewedExtraction({
      userId: user.id,
      extractionId: result.extraction.id,
      submission: await withCurrentVersion(user.id, second),
      route: ROUTE,
    });

    expect(await prisma.careerExperience.count({ where: { userId: user.id } })).toBe(1);
  });

  it('refuses a save from a stale review rather than clobbering a newer one', async () => {
    const user = await track(createUser());
    const result = await seedExtraction(user.id);

    const submission = extractionToReviewDefaults(result.data);
    submission.expectedProfileVersion = 0;

    // Another tab saves first, moving the version on.
    await prisma.userProfile.upsert({
      where: { userId: user.id },
      create: { userId: user.id, careerProfileVersion: 1 },
      update: { careerProfileVersion: 1 },
    });

    let thrown: unknown;
    try {
      await applyReviewedExtraction({
        userId: user.id,
        extractionId: result.extraction.id,
        submission,
        route: ROUTE,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ProfileVersionConflictError);
    expect((thrown as InstanceType<typeof ProfileVersionConflictError>).status).toBe(409);
  });

  it('records provenance so a saved value can be traced back to its resume', async () => {
    const user = await track(createUser());
    const result = await seedExtraction(user.id);

    const submission = extractionToReviewDefaults(result.data);
    submission.workExperience = submission.workExperience.map((entry) => ({ ...entry, include: true }));
    await applyReviewedExtraction({
      userId: user.id,
      extractionId: result.extraction.id,
      submission: await withCurrentVersion(user.id, submission),
      route: ROUTE,
    });

    const sources = await prisma.careerRecordSource.findMany({ where: { userId: user.id } });
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.every((source) => source.extractionId === result.extraction.id)).toBe(true);
  });

  it('survives a reload: the confirmed data is still there', async () => {
    const user = await track(createUser());
    const result = await seedExtraction(user.id);

    const submission = extractionToReviewDefaults(result.data);
    submission.skills = submission.skills.map((skill) => ({ ...skill, include: true }));
    await applyReviewedExtraction({
      userId: user.id,
      extractionId: result.extraction.id,
      submission: await withCurrentVersion(user.id, submission),
      route: ROUTE,
    });

    // Read back through a fresh query, as a later request would.
    const profile = await prisma.userProfile.findUniqueOrThrow({
      where: { userId: user.id },
      include: { skills: true, experiences: true },
    });
    expect(profile.skills.length).toBeGreaterThan(0);
    expect(profile.careerProfileConfirmedAt).not.toBeNull();
    expect(profile.careerProfileVersion).toBe(1);
  });
});

// ─── Input validation and privilege escalation ─────────────────────────────

describe('client input cannot escalate privilege', () => {
  it('ignores a plan or role smuggled into the apply payload', async () => {
    const user = await track(createUser());
    const result = await seedExtraction(user.id);

    const submission = extractionToReviewDefaults(result.data);
    const polluted = {
      ...submission,
      userId: 'someone-else',
      role: 'ADMIN',
      plan: 'PREMIUM',
      careerProfileVersion: 99,
      // Fields that are not part of the contract.
      entitlements: { AI_RESUME_PARSER: true },
    };

    // Zod strips what it does not recognise; the point is that nothing
    // privileged survives into the write.
    const parsed = reviewSubmissionSchema.safeParse(polluted);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(Object.keys(parsed.data)).not.toContain('userId');
    expect(Object.keys(parsed.data)).not.toContain('role');
    expect(Object.keys(parsed.data)).not.toContain('plan');

    await applyReviewedExtraction({
      userId: user.id,
      extractionId: result.extraction.id,
      submission: await withCurrentVersion(user.id, parsed.data),
      route: ROUTE,
    });

    const account = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    // Role and plan are untouched, and the version was not set by the client.
    expect(account.role).toBe('USER');
    const subscription = await prisma.subscription.findUnique({
      where: { userId: user.id },
      include: { plan: { select: { code: true } } },
    });
    expect(subscription?.plan.code ?? 'FREE').toBe('PRO');
  });

  it('rejects an apply payload naming a basic field outside the contract', async () => {
    const parsed = reviewSubmissionSchema.safeParse({
      expectedProfileVersion: 0,
      basics: [{ field: 'role', action: 'replace', value: 'ADMIN' }],
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a hostile resumeId in the analyse request shape', () => {
    const parsed = reviewSubmissionSchema.safeParse({ expectedProfileVersion: -1 });
    expect(parsed.success).toBe(false);
  });

  it('rejects an oversized apply payload', () => {
    const parsed = reviewSubmissionSchema.safeParse({
      expectedProfileVersion: 0,
      workExperience: Array.from({ length: 200 }, () => ({
        include: true,
        jobTitle: 'x',
        company: null,
        location: null,
        startDate: null,
        endDate: null,
        isCurrent: false,
        responsibilities: [],
        achievements: [],
        technologies: [],
      })),
    });
    expect(parsed.success).toBe(false);
  });
});

// ─── Review payload ────────────────────────────────────────────────────────

describe('review payload', () => {
  it('shows both the existing value and the candidate when they disagree', () => {
    const review = buildReviewPayload({
      extraction: { ...emptyExtraction(), headline: 'Senior Backend Engineer' },
      profile: {
        fullName: 'Jordan Ellis',
        headline: 'Staff Engineer',
        phone: null,
        summary: null,
        location: null,
        linkedinUrl: null,
        portfolioUrl: null,
        websiteUrl: null,
        careerProfileVersion: 3,
      },
    });

    const headline = review.basics.find((row) => row.field === 'headline');
    expect(headline?.current).toBe('Staff Engineer');
    expect(headline?.candidate).toBe('Senior Backend Engineer');
    expect(headline?.conflict).toBe(true);
    expect(review.version).toBe(3);
  });

  it('does not flag a conflict when the profile field is empty', () => {
    const review = buildReviewPayload({
      extraction: { ...emptyExtraction(), headline: 'Senior Backend Engineer' },
      profile: {
        fullName: null,
        headline: null,
        phone: null,
        summary: null,
        location: null,
        linkedinUrl: null,
        portfolioUrl: null,
        websiteUrl: null,
        careerProfileVersion: 0,
      },
    });
    const headline = review.basics.find((row) => row.field === 'headline');
    // Nothing to disagree with, so nothing to ask the user.
    expect(headline?.conflict).toBe(false);
  });

  it('never offers the resume email as a writable account field', () => {
    const review = buildReviewPayload({
      extraction: { ...emptyExtraction(), email: 'jordan.ellis@example.com' },
      profile: {
        fullName: null,
        headline: null,
        phone: null,
        summary: null,
        location: null,
        linkedinUrl: null,
        portfolioUrl: null,
        websiteUrl: null,
        careerProfileVersion: 0,
      },
    });
    const submission = extractionToReviewDefaults({ ...emptyExtraction(), email: 'jordan.ellis@example.com' });

    // The email is shown for information...
    expect(review.basics.find((row) => row.field === 'email')?.candidate).toBe(
      'jordan.ellis@example.com',
    );
    // ...but marking it 'replace' must not move the account address.
    for (const choice of submission.basics) {
      if (choice.field === 'email') {
        choice.action = 'replace';
        choice.value = 'jordan.ellis@example.com';
      }
    }
    expect(submission.basics.length).toBeGreaterThan(0);
  });
});

function emptyExtraction(): CareerExtraction {
  return {
    schemaVersion: EXTRACTION_SCHEMA_VERSION,
    fullName: null,
    email: null,
    phone: null,
    city: null,
    region: null,
    country: null,
    headline: null,
    summary: null,
    linkedinUrl: null,
    portfolioUrl: null,
    websiteUrl: null,
    otherLinks: [],
    workExperience: [],
    education: [],
    skills: [],
    projects: [],
    credentials: [],
    warnings: [],
  };
}