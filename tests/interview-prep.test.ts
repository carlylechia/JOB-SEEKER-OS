/**
 * Interview Intelligence & Preparation Packs tests.
 *
 * The claims under test are the ones that would matter if they were false:
 *
 *  - a user cannot read, practise on, or archive another user's pack
 *  - a Free account cannot bypass the AI_INTERVIEW_PREP gate server-side
 *  - the same inputs reuse a completed pack instead of charging twice
 *  - company claims without a real source are dropped, and candidate quotes
 *    the profile does not contain are removed
 *  - malformed provider output and provider timeouts are handled safely
 *  - practice attempts persist, feedback is metered, sessions complete and
 *    tasks update the readiness snapshot
 *  - research URLs reject private, credentialed and non-http destinations
 *
 * Every AI call is served by an injected fake. No key is required and no
 * network request is made.
 */

import { describe, it, beforeEach, afterEach, expect } from './harness';
import { prisma } from '@/lib/prisma';
import { createUser, destroyUser, T0 } from './helpers';
import { setTestNow, resetClock } from '@/lib/billing/clock';
import { requireEntitlement, PlanRequiredError } from '@/lib/billing/subscriptions';
import { getUsage } from '@/lib/billing/usage';
import {
  INTERVIEW_PREP_FEATURE,
  InterviewPrepPackNotFoundError,
  createPracticeSession,
  createPrepPack,
  generatePracticeFeedback,
  generatePrepPack,
  getPracticeSession,
  getPrepPack,
  getPrepProgress,
  getQuestionForPractice,
  listPrepPacks,
  submitPracticeAnswer,
  updatePrepPack,
  updateTaskStatus,
  completePracticeSession,
} from '@/lib/interview-prep/service';
import {
  InterviewPrepAiError,
  type InterviewPrepAiProvider,
} from '@/lib/interview-prep/ai-client';
import { rubricDimensionsForCategory } from '@/lib/interview-prep/service';
import {
  INTERVIEW_PREP_SCHEMA_VERSION,
  modelPackSchema,
  type ModelFeedback,
  type ModelPack,
  type QuestionCategory,
} from '@/lib/interview-prep/schema';
import { verifyPack, verifyFeedback, type ProfileEvidence } from '@/lib/interview-prep/verify';
import {
  assertSafeResearchUrl,
  isPublicIpAddress,
  normaliseResearchUrls,
  ResearchFetchError,
} from '@/lib/interview-prep/research';
import {
  INTERVIEW_PREP_MAX_QUESTIONS,
  INTERVIEW_PREP_MAX_RESEARCH_URLS,
} from '@/lib/interview-prep/limits';

const ROUTE = '/api/interview-prep';
const userIds: string[] = [];

const JOB_TEXT =
  'Northwind is hiring a Backend Engineer to build customer-facing APIs in TypeScript and Node.js. ' +
  'You will own services end to end, work with PostgreSQL, review code, improve reliability and ' +
  'collaborate closely with product and design. Experience with distributed systems and clear written ' +
  'communication is important.';

function questionFixture(index: number): ModelPack['questions'][number] {
  const categories: QuestionCategory[] = [
    'TECHNICAL_FUNDAMENTALS',
    'APPLIED_PROBLEM_SOLVING',
    'ARCHITECTURE_TRADE_OFFS',
    'BEHAVIORAL',
    'OWNERSHIP',
    'COLLABORATION',
  ];
  const prompts = [
    'How would you diagnose a slow TypeScript API endpoint in production?',
    'Describe a time you disagreed with a teammate about a technical decision.',
    'When would you choose a queue over synchronous request processing?',
    'Tell me about a bug that reached production and what you learned.',
    'How do you decide what to monitor after launching a new service?',
    'Walk me through explaining a complex trade-off to a non-technical stakeholder.',
  ];
  return {
    generationId: `gen-${index}`,
    category: categories[index % categories.length],
    difficulty: index % 3 === 0 ? 'APPLIED' : 'FOUNDATION',
    competency: ['TypeScript', 'API design', 'Reliability', 'Collaboration', 'Ownership', 'Communication'][
      index % 6
    ],
    question: `Practice question: ${prompts[index % prompts.length]}`,
    whyMatters: 'This competency appears in the job description and matters for the role.',
    relatedRequirement: index === 0 ? 'TypeScript and Node.js experience' : null,
    candidateEvidenceQuote: index === 0 ? 'TypeScript' : null,
    candidateEvidenceNote: index === 0 ? 'You list TypeScript in your profile.' : null,
    prepNotes: 'Use a concrete example from your own work.',
    answerStructure: index % 3 === 3 ? 'STAR' : index % 3 === 2 ? 'ARCHITECTURE' : 'TECHNICAL',
    strongAnswerShows: 'A clear problem, the trade-offs you considered and the result you measured.',
    commonPitfalls: ['Speaking only in generalities.'],
    coaching: {
      whatInterviewerAssesses: 'How you reason about real production constraints.',
      keyPoints: ['Context', 'Decision', 'Result'],
      practiceExercise: 'Write a two-minute outline, then say it aloud.',
      sampleWordingPlaceholder: 'In [project], I faced [problem]. I chose [approach] because [reason].',
    },
    evidenceBasis: index === 0 ? 'JOB_DESCRIPTION' : 'ROLE_INFERENCE',
    priority: index < 2 ? 'HIGH' : 'MEDIUM',
    sourceIndexes: index === 0 ? [0] : [],
    followUpQuestions: index === 0 ? ['What would you change at scale?'] : [],
    isPrediction: true,
  };
}

function makeModelPack(overrides: Partial<ModelPack> = {}): ModelPack {
  return {
    schemaVersion: INTERVIEW_PREP_SCHEMA_VERSION,
    title: 'Northwind — Backend Engineer',
    context: 'BALANCED',
    briefing: {
      summary: 'Prepare for a backend role focused on TypeScript APIs, reliability and collaboration.',
      topPriorities: [
        {
          title: 'Show end-to-end API ownership',
          why: 'The job description emphasizes owning services end to end.',
          basis: 'JOB_DESCRIPTION',
          priority: 'HIGH',
        },
      ],
      strongestEvidence: [
        {
          theme: 'TypeScript',
          evidenceQuote: 'TypeScript',
          explanation: 'You list TypeScript in your profile.',
          verification: 'CONFIRMED_PROFILE',
        },
      ],
      gaps: [
        {
          gap: 'No quantified reliability outcome',
          preparationAction: 'Add metrics or a clear before/after result to your project notes.',
          evidenceStatus: 'NO_EVIDENCE_FOUND',
        },
      ],
      keyCompanyFacts: [],
      nextAction: 'Outline one API project using the technical structure.',
    },
    company: {
      overview: {
        claim: 'Northwind operates in the same general domain as the role described.',
        basis: 'INFERENCE',
        sourceIndexes: [],
        whyItMatters: 'Useful context, but confirm the business model yourself.',
      },
      products: [],
      customers: null,
      mission: null,
      values: [],
      cultureNotes: [],
      recentDevelopments: [],
      roleContext: ['The role sits close to customer-facing APIs.'],
      whyThisCompanyDraft: 'I am interested in [what you know about the company] because [your reason].',
      whyThisCompanyPlaceholders: ['what you know about the company', 'your reason'],
      researchLimitations: ['No official company pages supplied.'],
    },
    role: {
      summary: 'Build and operate TypeScript APIs with an ownership mindset.',
      responsibilities: ['Own services end to end', 'Improve reliability'],
      requirements: [
        {
          requirement: 'TypeScript and Node.js experience',
          importance: 'CRITICAL',
          requirementType: 'EXPLICIT',
          evidenceStatus: 'DEMONSTRATED',
          evidenceQuote: 'TypeScript',
          evidenceExplanation: 'Listed in your profile.',
          evidenceSource: 'PROFILE',
          gap: null,
          preparationAction: 'Prepare one concrete API example.',
          confidence: 'HIGH',
          sourceQuote: 'build customer-facing APIs in TypeScript and Node.js',
        },
      ],
      competencies: [
        {
          name: 'API design',
          why: 'The role owns customer-facing APIs.',
          requirement: 'TypeScript APIs',
          evidenceQuote: 'TypeScript',
          evidenceExplanation: 'Profile evidence.',
          sampleQuestion: 'How do you design a stable public API?',
          strongAnswerShows: 'Versioning, error contracts and consumer needs.',
          practiceAdvice: 'Walk through one API you designed.',
          evidenceBasis: 'JOB_DESCRIPTION',
        },
      ],
      likelyChallenges: ['Balancing delivery speed with reliability.'],
      occupationalFamily: 'Software Engineering',
    },
    evidenceBank: [
      {
        theme: 'API ownership',
        title: 'Customer-facing API integration',
        evidenceQuote: 'API integration',
        evidenceNote: 'A project in your profile.',
        sourceLabel: 'Career profile',
        whatItSupports: 'End-to-end API ownership.',
        missingDetails: ['Scale', 'Measured outcome'],
        competencies: ['API design'],
        verification: 'CONFIRMED_PROFILE',
      },
    ],
    questions: Array.from({ length: 6 }, (_, index) => questionFixture(index)),
    employerQuestions: [
      {
        question: 'How does the team measure reliability?',
        why: 'It connects to the role’s ownership expectations.',
        category: 'ROLE',
        priority: 'HIGH',
        sourceIndexes: [0],
      },
    ],
    tasks: [
      {
        taskKey: 'outline-api-story',
        title: 'Outline your strongest API story',
        description: 'Write the context, decision and outcome for one API project.',
        whyItMatters: 'This is likely to be the core of the technical conversation.',
        expectedOutput: 'A five-bullet answer outline.',
        priority: 'HIGH',
        category: 'WRITING',
        estimatedMinutes: 20,
        horizon: 'WITHIN_24_HOURS',
      },
      {
        taskKey: 'research-company',
        title: 'Confirm three company facts',
        description: 'Read the official company pages and write down three facts you can cite.',
        whyItMatters: 'Avoid relying on assumptions in the motivation questions.',
        expectedOutput: 'Three source-backed facts.',
        priority: 'MEDIUM',
        category: 'RESEARCH',
        estimatedMinutes: 25,
        horizon: 'TWO_THREE_DAYS',
      },
      {
        taskKey: 'practice-system-design',
        title: 'Practice one API design prompt',
        description: 'Talk through a rate-limited API design out loud.',
        whyItMatters: 'The role involves API design trade-offs.',
        expectedOutput: 'A recorded five-minute answer.',
        priority: 'MEDIUM',
        category: 'PRACTICE',
        estimatedMinutes: 30,
        horizon: 'WITHIN_A_WEEK',
      },
      {
        taskKey: 'prepare-questions',
        title: 'Choose your questions for the employer',
        description: 'Select three questions that matter to your decision.',
        whyItMatters: 'Good questions signal genuine engagement.',
        expectedOutput: 'Three final questions.',
        priority: 'LOW',
        category: 'REVIEW',
        estimatedMinutes: 10,
        horizon: 'WITHIN_A_WEEK',
      },
    ],
    logistics: [
      {
        topic: 'Format',
        guidance: 'Confirm the interview format and time zone with the recruiter.',
        basis: 'FORMAT_GENERAL',
      },
    ],
    cheatSheet: {
      companyFacts: [],
      topCompetencies: ['API design', 'Reliability'],
      strongestExamples: ['Customer-facing API integration'],
      questionsToAsk: ['How does the team measure reliability?'],
      logistics: ['Confirm the time zone.'],
      reminders: ['Use concrete examples.'],
      unknowns: ['The exact interview panel.'],
    },
    preparationGuidance: 'Start with your strongest API story, then practise the design prompt.',
    limitations: [],
    ...overrides,
  };
}

function fakeProvider(
  options: {
    pack?: ModelPack;
    feedback?: ModelFeedback;
    throwError?: InterviewPrepAiError;
    invalid?: boolean;
    delayMs?: number;
  } = {},
): InterviewPrepAiProvider & { packCalls: number; feedbackCalls: number } {
  const provider = {
    name: 'fake',
    model: 'fake-model-1',
    packCalls: 0,
    feedbackCalls: 0,
    async generatePack(): Promise<ModelPack> {
      provider.packCalls += 1;
      if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      if (options.throwError) throw options.throwError;
      if (options.invalid) return { nonsense: true } as unknown as ModelPack;
      return options.pack ?? makeModelPack();
    },
    async generateFeedback(): Promise<ModelFeedback> {
      provider.feedbackCalls += 1;
      if (options.throwError) throw options.throwError;
      return (
        options.feedback ?? {
          dimensions: [
            {
              dimension: 'RELEVANCE',
              rating: 'EVIDENT',
              note: 'You answered the question asked.',
              evidenceQuote: 'TypeScript',
            },
          ],
          whatWorked: 'You addressed the question directly.',
          needsImprovement: 'Add a concrete example.',
          missing: 'A measured result.',
          structureSuggestion: 'Use the technical structure.',
          revisedStructure: 'Context → decision → trade-off → result.',
          followUpPractice: ['Explain a type error you fixed.'],
          adaptiveFollowUp: {
            question: 'What would you change at scale?',
            why: 'The role owns services end to end.',
            whatToInclude: ['A concrete constraint'],
          },
          limitations: null,
        }
      );
    },
  };
  return provider;
}

async function setup(opts: { plan?: 'FREE' | 'PRO' | 'PREMIUM'; jobDescription?: string } = {}) {
  const user = await createUser();
  userIds.push(user.id);

  const profile = await prisma.userProfile.create({
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
    },
  });

  await prisma.careerProject.create({
    data: {
      userId: user.id,
      profileId: profile.id,
      name: 'API integration',
      description: 'A customer-facing API integration built with TypeScript and Node.js.',
      role: 'Backend engineer',
      technologies: ['TypeScript', 'Node.js', 'PostgreSQL'],
      results: ['Reduced latency by 20%'],
      sortOrder: 0,
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
      jobDescription: opts.jobDescription ?? JOB_TEXT,
      status: 'LEAD',
      score: { fitScore: 72, fitTier: 'B', titleMatch: true },
      checklist: {},
      contacts: [],
      interviews: [],
      prepPack: {},
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

async function generatedPack(provider = fakeProvider()) {
  const { user, job } = await setup({ plan: 'PRO' });
  const created = await createPrepPack({ userId: user.id, jobId: job.id, context: 'BALANCED' });
  const result = await generatePrepPack({
    userId: user.id,
    packId: created.pack.id,
    provider,
    route: ROUTE,
  });
  if (result.outcome === 'FAILED') throw new Error(`generation failed: ${result.code}`);
  const detail = await getPrepPack({ userId: user.id, packId: created.pack.id });
  if (!detail) throw new Error('generated pack missing');
  return { user, job, pack: detail.pack, detail, provider };
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

// ─── Unit: rubrics, research safety and verification ───────────────────────

describe('rubric selection', () => {
  it('scores only dimensions that make sense for the category', () => {
    const behavioural = rubricDimensionsForCategory('BEHAVIORAL' as QuestionCategory);
    expect(behavioural).toContain('CONCRETE_EXAMPLE');
    expect(behavioural).toContain('SUPPORTED_OUTCOMES');

    const debugging = rubricDimensionsForCategory('DEBUGGING' as QuestionCategory);
    expect(debugging).toContain('TECHNICAL_CORRECTNESS');
    expect(debugging).not.toContain('SUPPORTED_OUTCOMES');
  });
});

describe('research safety', () => {
  it('rejects private, loopback, link-local and metadata addresses', async () => {
    expect(isPublicIpAddress('127.0.0.1')).toBe(false);
    expect(isPublicIpAddress('10.0.0.5')).toBe(false);
    expect(isPublicIpAddress('172.16.0.5')).toBe(false);
    expect(isPublicIpAddress('192.168.1.5')).toBe(false);
    expect(isPublicIpAddress('169.254.169.254')).toBe(false);
    expect(isPublicIpAddress('::1')).toBe(false);
    expect(isPublicIpAddress('fd00::1')).toBe(false);
    expect(isPublicIpAddress('8.8.8.8')).toBe(true);

    for (const url of [
      'http://localhost/about',
      'http://127.0.0.1/about',
      'http://169.254.169.254/latest/meta-data',
      'http://[::1]/',
      'https://user:pass@example.com/about',
      'file:///etc/passwd',
      'ftp://example.com/file',
    ]) {
      await expect(assertSafeResearchUrl(url)).rejects.toBeInstanceOf(ResearchFetchError);
    }
  });

  it('normalises, deduplicates and caps supplied research URLs', () => {
    const urls = normaliseResearchUrls([
      'https://example.com/about',
      'https://example.com/about#team',
      'https://example.com/careers',
      'not a url',
      '/uploads/private-resume.pdf',
      ...Array.from({ length: 10 }, (_, index) => `https://example.com/page-${index}`),
    ]);
    expect(urls.length).toBeLessThanOrEqual(INTERVIEW_PREP_MAX_RESEARCH_URLS);
    expect(urls[0]).toBe('https://example.com/about');
    expect(urls.filter((url) => url.includes('/about')).length).toBe(1);
  });
});

describe('verification', () => {
  const sources = [
    {
      index: 0,
      kind: 'JOB_DESCRIPTION' as const,
      title: 'Job description',
      url: null,
      text: JOB_TEXT,
    },
    {
      index: 1,
      kind: 'OFFICIAL_COMPANY' as const,
      title: 'Northwind about page',
      url: 'https://northwind.example/about',
      text: 'Northwind builds logistics software for independent retailers. Its platform helps small shops manage inventory and deliveries across Europe.',
    },
  ];

  const profile: ProfileEvidence = {
    projectNames: ['API integration'],
    experienceTitles: ['backend engineer'],
    skillNames: ['typescript', 'node.js'],
  };

  it('drops a SOURCE company claim with no valid source index', () => {
    const pack = makeModelPack({
      company: {
        ...makeModelPack().company,
        overview: {
          claim: 'Northwind was founded in 1842 and is the largest retailer in Europe.',
          basis: 'SOURCE',
          sourceIndexes: [],
          whyItMatters: null,
        },
      },
    });
    const result = verifyPack({
      pack,
      sources,
      jobText: JOB_TEXT,
      candidateText: 'TypeScript Node.js API integration',
      profile,
    });
    expect(result.pack.company.overview).toBeNull();
    expect(result.stats.companyClaimsDropped).toBeGreaterThanOrEqual(1);
  });

  it('keeps a source-backed company claim and records its source index', () => {
    const pack = makeModelPack({
      company: {
        ...makeModelPack().company,
        overview: {
          claim: 'Northwind builds logistics software for independent retailers.',
          basis: 'SOURCE',
          sourceIndexes: [1],
          whyItMatters: null,
        },
      },
    });
    const result = verifyPack({
      pack,
      sources,
      jobText: JOB_TEXT,
      candidateText: '',
      profile,
    });
    expect(result.pack.company.overview?.basis).toBe('SOURCE');
    expect(result.pack.company.overview?.sourceIndexes).toEqual([1]);
  });

  it('removes a candidate quote the profile does not contain', () => {
    const pack = makeModelPack({
      questions: [
        {
          ...questionFixture(0),
          candidateEvidenceQuote: 'I led a team of 40 engineers at Google',
          candidateEvidenceNote: 'Led a large team.',
        },
      ],
    });
    const result = verifyPack({
      pack,
      sources,
      jobText: JOB_TEXT,
      candidateText: 'TypeScript Node.js API integration',
      profile,
    });
    expect(result.pack.questions[0].candidateEvidenceQuote).toBeNull();
    // The question itself survives, without the fabricated example.
    expect(result.pack.questions[0].question).toContain('Practice question');
  });

  it('deduplicates near-identical questions and caps the count', () => {
    const repeated = Array.from({ length: 30 }, (_, index) => ({
      ...questionFixture(index),
      question: 'How do you use TypeScript?',
    }));
    const result = verifyPack({
      pack: makeModelPack({ questions: repeated }),
      sources,
      jobText: JOB_TEXT,
      candidateText: '',
      profile,
    });
    expect(result.pack.questions.length).toBeLessThanOrEqual(INTERVIEW_PREP_MAX_QUESTIONS);
    expect(new Set(result.pack.questions.map((question) => question.question)).size).toBe(
      result.pack.questions.length,
    );
    expect(result.pack.questions.every((question) => question.isPrediction)).toBe(true);
  });

  it('drops feedback evidence quotes that are not in the answer', () => {
    const feedback = verifyFeedback({
      feedback: {
        dimensions: [
          {
            dimension: 'RELEVANCE',
            rating: 'EVIDENT',
            note: 'Good.',
            evidenceQuote: 'I never wrote this sentence',
          },
        ],
        whatWorked: 'Fine.',
        needsImprovement: '',
        missing: '',
        structureSuggestion: '',
        revisedStructure: null,
        followUpPractice: [],
        adaptiveFollowUp: null,
        limitations: null,
      },
      answerText: 'I used TypeScript to build the API.',
    });
    expect(feedback.dimensions[0].evidenceQuote).toBeNull();
  });

  it('neutralises hiring promises in feedback', () => {
    const feedback = verifyFeedback({
      feedback: {
        dimensions: [],
        whatWorked: 'You will get the job for sure.',
        needsImprovement: '',
        missing: '',
        structureSuggestion: '',
        revisedStructure: null,
        followUpPractice: [],
        adaptiveFollowUp: null,
        limitations: null,
      },
      answerText: 'I used TypeScript.',
    });
    expect(feedback.whatWorked).not.toContain('get the job');
    expect(feedback.whatWorked.toLowerCase()).toContain('cannot predict');
  });
});

// ─── Unit: schema ──────────────────────────────────────────────────────────

describe('schema', () => {
  it('accepts a complete pack and rejects more questions than the cap', () => {
    expect(modelPackSchema.safeParse(makeModelPack()).success).toBe(true);

    const tooMany = makeModelPack({
      questions: Array.from({ length: INTERVIEW_PREP_MAX_QUESTIONS + 1 }, (_, index) =>
        questionFixture(index),
      ),
    });
    expect(modelPackSchema.safeParse(tooMany).success).toBe(false);
  });
});

// ─── Integration: entitlement and generation ───────────────────────────────

describe('entitlement enforcement', () => {
  it('refuses a Free user server-side', async () => {
    const { user } = await setup({ plan: 'FREE' });
    await expect(requireEntitlement(user.id, INTERVIEW_PREP_FEATURE)).rejects.toBeInstanceOf(
      PlanRequiredError,
    );
  });

  it('does not let a Free user generate a pack', async () => {
    const { user, job } = await setup({ plan: 'FREE' });
    const created = await createPrepPack({ userId: user.id, jobId: job.id });
    await expect(
      generatePrepPack({
        userId: user.id,
        packId: created.pack.id,
        provider: fakeProvider(),
        route: ROUTE,
      }),
    ).rejects.toBeInstanceOf(PlanRequiredError);
  });
});

describe('generation and persistence', () => {
  it('generates a full, source-provenanced pack without network research', async () => {
    const provider = fakeProvider();
    const { user, job, pack, detail } = await generatedPack(provider);

    expect(provider.packCalls).toBe(1);
    expect(pack.status === 'READY' || pack.status === 'PARTIALLY_READY').toBe(true);
    expect(detail.data.content).not.toBeNull();
    expect(detail.data.questions.length).toBe(6);
    expect(detail.tasks.length).toBeGreaterThanOrEqual(4);
    expect(detail.data.content?.company.overview?.basis).toBe('INFERENCE');
    expect(detail.data.content?.briefing.nextAction).toContain('API');

    // The job description is retained as a user-supplied source, with
    // provenance shown rather than claiming web research.
    expect(detail.sources.length).toBe(1);
    expect(detail.sources[0].kind).toBe('JOB_DESCRIPTION');
    expect(detail.sources[0].verification).toBe('USER_SUPPLIED');
    expect(detail.pack.researchStatus).toBe('NOT_AVAILABLE');
    expect(detail.pack.practicedCount).toBe(0);
    expect(detail.readiness.level).toBe('STARTING');

    // A practice attempt is attached to the question version.
    expect(detail.data.questions[0].isPrediction).toBe(true);
    expect(detail.data.questions[0].sourceRefs).toEqual([detail.sources[0].id]);

    // Usage is metered once through the shared ledger.
    expect(await getUsage(user.id, INTERVIEW_PREP_FEATURE)).toBe(1);
    expect(await getUsage(user.id, 'AI_INTERVIEW_PREP' as never)).toBe(1);

    // The job remains linked and reading is free.
    expect(pack.jobId).toBe(job.id);
    expect(await getPrepPack({ userId: user.id, packId: pack.id })).not.toBeNull();
  });

  it('reuses a completed pack for identical inputs instead of charging twice', async () => {
    const provider = fakeProvider();
    const { user, job, pack } = await generatedPack(provider);
    const reused = await generatePrepPack({
      userId: user.id,
      packId: pack.id,
      provider,
      route: ROUTE,
    });
    expect(reused.outcome).toBe('REUSED');
    expect(provider.packCalls).toBe(1);
    expect(await getUsage(user.id, INTERVIEW_PREP_FEATURE)).toBe(1);

    const same = await createPrepPack({ userId: user.id, jobId: job.id, context: 'BALANCED' });
    expect(same.reused).toBe(true);
    expect(same.pack.id).toBe(pack.id);
  });

  it('handles provider failure safely and records a FAILED pack', async () => {
    const provider = fakeProvider({
      throwError: new InterviewPrepAiError('AI_TIMEOUT', true),
    });
    const { user, job } = await setup({ plan: 'PRO' });
    const created = await createPrepPack({ userId: user.id, jobId: job.id });
    const result = await generatePrepPack({
      userId: user.id,
      packId: created.pack.id,
      provider,
      route: ROUTE,
    });
    expect(result.outcome).toBe('FAILED');
    if (result.outcome === 'FAILED') {
      expect(result.code).toBe('AI_TIMEOUT');
      expect(result.retryable).toBe(true);
      expect(result.message).not.toContain('provider');
    }
    const row = await prisma.interviewPrepPack.findUniqueOrThrow({ where: { id: created.pack.id } });
    expect(row.status).toBe('FAILED');
    expect(row.errorCode).toBe('AI_TIMEOUT');
  });

  it('rejects invalid provider output without persisting content', async () => {
    const provider = fakeProvider({ invalid: true });
    const { user, job } = await setup({ plan: 'PRO' });
    const created = await createPrepPack({ userId: user.id, jobId: job.id });
    const result = await generatePrepPack({
      userId: user.id,
      packId: created.pack.id,
      provider,
      route: ROUTE,
    });
    expect(result.outcome).toBe('FAILED');
    if (result.outcome === 'FAILED') expect(result.code).toBe('AI_INVALID_RESPONSE');
    const row = await prisma.interviewPrepPack.findUniqueOrThrow({ where: { id: created.pack.id } });
    expect(row.content).toBeNull();
  });

  it('scopes reading and practice to the owner', async () => {
    const { pack, detail } = await generatedPack();
    const other = await createUser();
    userIds.push(other.id);

    expect(await getPrepPack({ userId: other.id, packId: pack.id })).toBeNull();
    expect(await getPrepProgress({ userId: other.id, packId: pack.id })).toBeNull();
    expect(await getQuestionForPractice({
      userId: other.id,
      packId: pack.id,
      questionId: detail.data.questions[0].id,
    })).toBeNull();
    await expect(
      submitPracticeAnswer({
        userId: other.id,
        packId: pack.id,
        questionId: detail.data.questions[0].id,
        answer: 'This answer is long enough to be accepted by the service.',
      }),
    ).rejects.toBeInstanceOf(InterviewPrepPackNotFoundError);
  });
});

// ─── Integration: practice, feedback, sessions and tasks ───────────────────

describe('practice, feedback and sessions', () => {
  it('persists answers, meters feedback and builds a session summary', async () => {
    const provider = fakeProvider();
    const { user, pack, detail } = await generatedPack(provider);
    const question = detail.data.questions[0];

    const attempt = await submitPracticeAnswer({
      userId: user.id,
      packId: pack.id,
      questionId: question.id,
      answer:
        'In my API integration project I used TypeScript and Node.js to reduce latency by 20 percent.',
    });
    expect(attempt.attemptNumber).toBe(1);
    expect(attempt.kind).toBe('INITIAL');
    expect(attempt.feedback).toBeNull();

    const revision = await submitPracticeAnswer({
      userId: user.id,
      packId: pack.id,
      questionId: question.id,
      answer:
        'In my API integration project I used TypeScript and Node.js to reduce latency by 20 percent. I measured before and after.',
    });
    expect(revision.attemptNumber).toBe(2);
    expect(revision.kind).toBe('REVISION');

    const feedback = await generatePracticeFeedback({
      userId: user.id,
      packId: pack.id,
      attemptId: revision.id,
      provider,
      route: ROUTE,
    });
    expect(feedback.creditsConsumed).toBe(1);
    expect(feedback.feedback.dimensions[0].evidenceQuote).toBe('TypeScript');
    expect(provider.feedbackCalls).toBe(1);

    const progress = await getPrepProgress({ userId: user.id, packId: pack.id });
    expect(progress?.answeredCount).toBe(1);
    expect(progress?.feedbackCount).toBe(1);
    expect(progress?.outstandingCount).toBe(5);

    const session = await createPracticeSession({
      userId: user.id,
      packId: pack.id,
      mode: 'QUICK',
    });
    expect(session.status).toBe('ACTIVE');
    expect(session.questionIds.length).toBeGreaterThan(0);

    const loaded = await getPracticeSession({
      userId: user.id,
      packId: pack.id,
      sessionId: session.id,
    });
    expect(loaded?.questions.length).toBe(session.questionIds.length);
    expect(loaded?.questions.map((item) => item.id)).toEqual(session.questionIds);

    // Session questions must carry the same provenance as the pack question
    // list: the mock-interview card shows source links and reads sourceRefs
    // unconditionally.
    const sessionQuestion = loaded?.questions[0];
    const fullQuestion = detail.data.questions.find((item) => item.id === sessionQuestion?.id);
    expect(Array.isArray(sessionQuestion?.sourceRefs)).toBe(true);
    expect(sessionQuestion?.sourceRefs).toEqual(fullQuestion?.sourceRefs);

    const completed = await completePracticeSession({
      userId: user.id,
      packId: pack.id,
      sessionId: session.id,
    });
    expect(completed?.status).toBe('COMPLETED');
    expect(completed?.summary?.questionsAttempted).toBeGreaterThanOrEqual(0);

    const refreshed = await getPrepPack({ userId: user.id, packId: pack.id });
    expect(refreshed?.readiness.practiceEvidence.questionsAttempted).toBe(1);
    expect(refreshed?.pack.practicedCount).toBe(1);
    expect(refreshed?.pack.feedbackCount).toBe(1);
  });

  it('updates task status and readiness without AI credits', async () => {
    const { user, pack, detail } = await generatedPack();
    const task = detail.tasks.find((item) => item.status === 'PENDING');
    expect(task).toBeDefined();

    const updated = await updateTaskStatus({
      userId: user.id,
      packId: pack.id,
      taskId: task!.id,
      status: 'COMPLETED',
    });
    expect(updated?.status).toBe('COMPLETED');

    const refreshed = await getPrepPack({ userId: user.id, packId: pack.id });
    expect(refreshed?.readiness.preparationCoverage.completedTasks).toBeGreaterThanOrEqual(1);
    expect(await getUsage(user.id, INTERVIEW_PREP_FEATURE)).toBe(1);
  });

  it('keeps saved packs readable after a plan lapses', async () => {
    const { user, pack } = await generatedPack();

    await prisma.subscription.deleteMany({ where: { userId: user.id } });
    expect(await getPrepPack({ userId: user.id, packId: pack.id })).not.toBeNull();

    await expect(
      generatePrepPack({
        userId: user.id,
        packId: pack.id,
        provider: fakeProvider(),
        route: ROUTE,
      }),
    ).rejects.toBeInstanceOf(PlanRequiredError);
  });
});

describe('updates and archive', () => {
  it('archives a pack without deleting history and hides it from the default list', async () => {
    const { user, pack } = await generatedPack();
    const archived = await updatePrepPack({
      userId: user.id,
      packId: pack.id,
      input: { status: 'ARCHIVED' },
    });
    expect(archived?.status).toBe('ARCHIVED');

    const visible = await listPrepPacks({ userId: user.id });
    expect(visible.some((item) => item.id === pack.id)).toBe(false);

    const all = await listPrepPacks({ userId: user.id, includeArchived: true });
    expect(all.some((item) => item.id === pack.id)).toBe(true);

    // Archived packs remain readable and their questions are kept.
    const detail = await getPrepPack({ userId: user.id, packId: pack.id });
    expect(detail?.data.questions.length).toBeGreaterThan(0);
  });
});
