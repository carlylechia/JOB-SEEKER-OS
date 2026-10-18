/**
 * Resume documents: validation, ownership, versioning and career-profile import.
 *
 * These are the tests that would catch a builder quietly losing someone's work:
 * ownership boundaries, optimistic concurrency, independent duplicates, and the
 * rule that editing a resume never writes to the career profile.
 */

import { describe, it, expect, beforeEach, afterEach } from './harness';
import { prisma } from '@/lib/prisma';
import {
  ResumeLimitExceededError,
  ResumeRevisionConflictError,
  StructuredResumeNotFoundError,
  TargetJobNotFoundError,
  careerProfileSummary,
  createResume,
  deleteResume,
  duplicateResume,
  getResume,
  listResumes,
  listTargetableJobs,
  resumeFromCareerProfile,
  updateResume,
} from '@/lib/resume-builder/documents';
import {
  RESUME_MAX_EXPERIENCES,
  createResumeSchema,
  dateSortKey,
  emptyResumeContent,
  normalizeResumeDate,
  resumeContentSchema,
  updateResumeSchema,
  type ResumeContent,
} from '@/lib/resume-builder/schema';
import { createUser, destroyUser, DAY_MS, T0 } from './helpers';
import { minimalContent, typicalContent, unicodeContent } from './resume-builder-fixtures';
import { randomUUID } from 'node:crypto';

const created: string[] = [];
async function track<T extends { id: string }>(p: Promise<T>): Promise<T> {
  const v = await p;
  created.push(v.id);
  return v;
}

afterEach(async () => {
  for (const id of created.splice(0)) await destroyUser(id).catch(() => undefined);
});

// ─── Schema and validation ──────────────────────────────────────────────────

describe('the structured resume schema', () => {
  it('accepts an empty document', () => {
    const content = emptyResumeContent();
    expect(content.experiences).toHaveLength(0);
    expect(content.basics.fullName).toBeNull();
    expect(content.summary).toBeNull();
  });

  it('accepts a typical resume', () => {
    const content = typicalContent();
    expect(content.experiences).toHaveLength(2);
    expect(content.experiences[0].isCurrent).toBe(true);
  });

  it('accepts unicode content without mangling it', () => {
    const content = unicodeContent();
    expect(content.basics.fullName).toBe('José Müller-Þórsdóttir');
    expect(content.summary).toContain('日本語');
  });

  it('treats a blank string as absent rather than as content', () => {
    const parsed = resumeContentSchema.parse({ basics: { fullName: '   ', email: '' } });
    expect(parsed.basics.fullName).toBeNull();
    expect(parsed.basics.email).toBeNull();
  });

  it('rejects an unknown top-level field', () => {
    const result = resumeContentSchema.safeParse({
      basics: {},
      userId: 'someone-else',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown field inside an experience', () => {
    const result = resumeContentSchema.safeParse({
      experiences: [{ id: 'a', salary: '100000' }],
    });
    expect(result.success).toBe(false);
  });

  it('refuses a current role that also has an end date', () => {
    const result = resumeContentSchema.safeParse({
      experiences: [
        { id: 'a', isCurrent: true, startDate: '2020-01', endDate: '2021-01' },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('refuses an end date before the start date', () => {
    const result = resumeContentSchema.safeParse({
      experiences: [
        { id: 'a', isCurrent: false, startDate: '2021-01', endDate: '2020-01' },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('refuses the same date problem in education', () => {
    const result = resumeContentSchema.safeParse({
      education: [{ id: 'a', startDate: '2021-01', endDate: '2020-01' }],
    });
    expect(result.success).toBe(false);
  });

  it('refuses an unreadable date rather than guessing one', () => {
    const result = resumeContentSchema.safeParse({
      experiences: [{ id: 'a', startDate: 'sometime last year' }],
    });
    expect(result.success).toBe(false);
  });

  it('refuses a javascript URL', () => {
    const result = resumeContentSchema.safeParse({
      basics: { websiteUrl: 'javascript:alert(1)' },
    });
    expect(result.success).toBe(false);
  });

  it('refuses a data URL', () => {
    const result = resumeContentSchema.safeParse({
      basics: { portfolioUrl: 'data:text/html,<script>alert(1)</script>' },
    });
    expect(result.success).toBe(false);
  });

  it('upgrades a bare host to https', () => {
    const parsed = resumeContentSchema.parse({ basics: { linkedinUrl: 'linkedin.com/in/jordan' } });
    expect(parsed.basics.linkedinUrl).toBe('https://linkedin.com/in/jordan');
  });

  it('rejects text beyond the schema cap', () => {
    const result = resumeContentSchema.safeParse({ summary: 'x'.repeat(5000) });
    expect(result.success).toBe(false);
  });

  it('drops blank and duplicate bullets', () => {
    const parsed = resumeContentSchema.parse({
      experiences: [
        {
          id: 'a',
          responsibilities: ['Kept one.', '   ', 'kept one.', 'Kept two.'],
        },
      ],
    });
    expect(parsed.experiences[0].responsibilities).toHaveLength(2);
    expect(parsed.experiences[0].responsibilities[0]).toBe('Kept one.');
  });

  it('rejects more experiences than the cap allows', () => {
    const experiences = Array.from({ length: RESUME_MAX_EXPERIENCES + 1 }, (_, index) => ({
      id: `e${index}`,
      jobTitle: `Role ${index}`,
    }));
    const result = resumeContentSchema.safeParse({ experiences });
    expect(result.success).toBe(false);
  });

  it('refuses an AI-sourced entry origin, because no such entry may exist', () => {
    const result = resumeContentSchema.safeParse({
      experiences: [{ id: 'a', origin: 'AI' }],
    });
    expect(result.success).toBe(false);
  });

  it('normalises dates from the formats people actually type', () => {
    expect(normalizeResumeDate('2021-03')).toBe('2021-03');
    expect(normalizeResumeDate('Mar 2021')).toBe('2021-03');
    expect(normalizeResumeDate('March 2021')).toBe('2021-03');
    expect(normalizeResumeDate('2021/3')).toBe('2021-03');
    expect(normalizeResumeDate('')).toBeNull();
    expect(normalizeResumeDate('whenever')).toBeNull();
    expect(normalizeResumeDate('2021-13')).toBeNull();
  });

  it('sorts dates chronologically', () => {
    expect(dateSortKey('2021-03')! > dateSortKey('2020-12')!).toBe(true);
    expect(dateSortKey(null)).toBeNull();
  });
});

// ─── Request contracts ──────────────────────────────────────────────────────

describe('request validation', () => {
  it('refuses a create payload carrying a userId', () => {
    const result = createResumeSchema.safeParse({ from: 'BLANK', userId: 'someone-else' });
    expect(result.success).toBe(false);
  });

  it('refuses DUPLICATE without a source', () => {
    const result = createResumeSchema.safeParse({ from: 'DUPLICATE' });
    expect(result.success).toBe(false);
  });

  it('refuses a source resume when not duplicating', () => {
    const result = createResumeSchema.safeParse({ from: 'BLANK', sourceResumeId: 'abc' });
    expect(result.success).toBe(false);
  });

  it('refuses an update that tries to set the revision', () => {
    const result = updateResumeSchema.safeParse({
      expectedRevision: 1,
      revision: 99,
    });
    expect(result.success).toBe(false);
  });

  it('refuses an update that tries to set the origin', () => {
    const result = updateResumeSchema.safeParse({
      expectedRevision: 1,
      origin: 'PROFILE',
    });
    expect(result.success).toBe(false);
  });

  it('refuses an update with no revision at all', () => {
    const result = updateResumeSchema.safeParse({ name: 'New name' });
    expect(result.success).toBe(false);
  });
});

// ─── Persistence ────────────────────────────────────────────────────────────

describe('resume documents', () => {
  it('creates a blank resume', async () => {
    const user = await track(createUser());
    const resume = await createResume({ userId: user.id, input: { from: 'BLANK' }, limit: null });

    expect(resume.revision).toBe(1);
    expect(resume.origin).toBe('BLANK');
    expect(resume.content.experiences).toHaveLength(0);
  });

  it('persists content and returns it after a re-read', async () => {
    const user = await track(createUser());
    const created = await createResume({ userId: user.id, input: { from: 'BLANK' }, limit: null });

    await updateResume({
      userId: user.id,
      resumeId: created.id,
      input: { expectedRevision: 1, content: typicalContent() },
    });

    const reloaded = await getResume({ userId: user.id, resumeId: created.id });
    expect(reloaded.content.basics.fullName).toBe('Jordan Ellis');
    expect(reloaded.content.experiences).toHaveLength(2);
    expect(reloaded.content.experiences[0].achievements[0]).toContain('38%');
  });

  it('increments the revision on every save', async () => {
    const user = await track(createUser());
    const created = await createResume({ userId: user.id, input: { from: 'BLANK' }, limit: null });

    const first = await updateResume({
      userId: user.id,
      resumeId: created.id,
      input: { expectedRevision: 1, name: 'One' },
    });
    expect(first.revision).toBe(2);

    const second = await updateResume({
      userId: user.id,
      resumeId: created.id,
      input: { expectedRevision: 2, name: 'Two' },
    });
    expect(second.revision).toBe(3);
  });

  it('rejects a save built on a stale revision', async () => {
    const user = await track(createUser());
    const created = await createResume({ userId: user.id, input: { from: 'BLANK' }, limit: null });

    await updateResume({ userId: user.id, resumeId: created.id, input: { expectedRevision: 1, name: 'A' } });

    let conflict: unknown;
    try {
      await updateResume({
        userId: user.id,
        resumeId: created.id,
        input: { expectedRevision: 1, name: 'B' },
      });
    } catch (error) {
      conflict = error;
    }
    expect(conflict).toBeInstanceOf(ResumeRevisionConflictError);
  });

  it('reports the current revision when a save conflicts', async () => {
    const user = await track(createUser());
    const created = await createResume({ userId: user.id, input: { from: 'BLANK' }, limit: null });
    await updateResume({ userId: user.id, resumeId: created.id, input: { expectedRevision: 1, name: 'A' } });

    try {
      await updateResume({ userId: user.id, resumeId: created.id, input: { expectedRevision: 1, name: 'B' } });
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as ResumeRevisionConflictError).currentRevision).toBe(2);
    }
  });

  it('does not let one of two concurrent saves win silently', async () => {
    const user = await track(createUser());
    const created = await createResume({ userId: user.id, input: { from: 'BLANK' }, limit: null });

    const results = await Promise.allSettled([
      updateResume({ userId: user.id, resumeId: created.id, input: { expectedRevision: 1, name: 'A' } }),
      updateResume({ userId: user.id, resumeId: created.id, input: { expectedRevision: 1, name: 'B' } }),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ResumeRevisionConflictError);
  });

  it('lists only the caller\'s resumes, newest first', async () => {
    const alice = await track(createUser());
    const bob = await track(createUser());

    const a = await createResume({ userId: alice.id, input: { from: 'BLANK', name: 'Alice A' }, limit: null });
    await createResume({ userId: alice.id, input: { from: 'BLANK', name: 'Alice B' }, limit: null });
    await createResume({ userId: bob.id, input: { from: 'BLANK', name: 'Bob' }, limit: null });

    const list = await listResumes(alice.id);
    expect(list).toHaveLength(2);
    expect(list.map((resume) => resume.name)).toContain('Alice A');
    expect(list.map((resume) => resume.name)).not.toContain('Bob');
    expect(a.userId).toBe(alice.id);
  });

  it('returns a 404-shaped error for another user\'s resume', async () => {
    const alice = await track(createUser());
    const bob = await track(createUser());
    const mine = await createResume({ userId: alice.id, input: { from: 'BLANK' }, limit: null });

    let error: unknown;
    try {
      await getResume({ userId: bob.id, resumeId: mine.id });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(StructuredResumeNotFoundError);
    expect((error as Error).message).toBe('Resume not found.');
  });

  it('refuses to update another user\'s resume', async () => {
    const alice = await track(createUser());
    const bob = await track(createUser());
    const mine = await createResume({ userId: alice.id, input: { from: 'BLANK', name: 'Original' }, limit: null });

    let error: unknown;
    try {
      await updateResume({
        userId: bob.id,
        resumeId: mine.id,
        input: { expectedRevision: 1, name: 'Hijacked' },
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(StructuredResumeNotFoundError);

    const reloaded = await getResume({ userId: alice.id, resumeId: mine.id });
    expect(reloaded.name).toBe('Original');
  });

  it('refuses to delete another user\'s resume', async () => {
    const alice = await track(createUser());
    const bob = await track(createUser());
    const mine = await createResume({ userId: alice.id, input: { from: 'BLANK' }, limit: null });

    let error: unknown;
    try {
      await deleteResume({ userId: bob.id, resumeId: mine.id });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(StructuredResumeNotFoundError);
    expect((await listResumes(alice.id)).length).toBe(1);
  });

  it('enforces the plan resume limit', async () => {
    const user = await track(createUser());
    await createResume({ userId: user.id, input: { from: 'BLANK' }, limit: 1 });

    let error: unknown;
    try {
      await createResume({ userId: user.id, input: { from: 'BLANK' }, limit: 1 });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ResumeLimitExceededError);
    expect((error as ResumeLimitExceededError).limit).toBe(1);
  });

  it('treats a null limit as unlimited', async () => {
    const user = await track(createUser());
    for (let index = 0; index < 4; index += 1) {
      await createResume({ userId: user.id, input: { from: 'BLANK' }, limit: null });
    }
    expect((await listResumes(user.id)).length).toBe(4);
  });
});

// ─── Versioning ─────────────────────────────────────────────────────────────

describe('resume versioning', () => {
  it('records the source and leaves the original untouched', async () => {
    const user = await track(createUser());
    const original = await createResume({
      userId: user.id,
      input: { from: 'BLANK' },
      limit: null,
    });
    await updateResume({
      userId: user.id,
      resumeId: original.id,
      input: { expectedRevision: 1, name: 'Master', content: typicalContent() },
    });

    const copy = await duplicateResume({ userId: user.id, resumeId: original.id, limit: null });

    expect(copy.sourceResumeId).toBe(original.id);
    expect(copy.origin).toBe('DUPLICATE');
    expect(copy.content.basics.fullName).toBe('Jordan Ellis');
    // Independent documents: different rows, different content objects.
    expect(copy.content).not.toBe(original.content);
  });

  it('does not let an edit to a copy change the original', async () => {
    const user = await track(createUser());
    const original = await createResume({ userId: user.id, input: { from: 'BLANK' }, limit: null });
    await updateResume({
      userId: user.id,
      resumeId: original.id,
      input: { expectedRevision: 1, content: typicalContent() },
    });
    const copy = await duplicateResume({ userId: user.id, resumeId: original.id, limit: null });

    const edited = { ...copy.content, basics: { ...copy.content.basics, headline: 'Tailored headline' } };
    await updateResume({
      userId: user.id,
      resumeId: copy.id,
      input: { expectedRevision: 1, content: edited },
    });

    const reloadedOriginal = await getResume({ userId: user.id, resumeId: original.id });
    expect(reloadedOriginal.content.basics.headline).toBe('Senior Backend Engineer');
  });

  it('does not let deleting a copy delete the original', async () => {
    const user = await track(createUser());
    const original = await createResume({ userId: user.id, input: { from: 'BLANK' }, limit: null });
    const copy = await duplicateResume({ userId: user.id, resumeId: original.id, limit: null });

    await deleteResume({ userId: user.id, resumeId: copy.id });

    const stillThere = await getResume({ userId: user.id, resumeId: original.id });
    expect(stillThere.id).toBe(original.id);
    expect((await listResumes(user.id)).length).toBe(1);
  });

  it('does not let deleting the original break the copy', async () => {
    const user = await track(createUser());
    const original = await createResume({ userId: user.id, input: { from: 'BLANK' }, limit: null });
    const copy = await duplicateResume({ userId: user.id, resumeId: original.id, limit: null });

    await deleteResume({ userId: user.id, resumeId: original.id });

    const survivor = await getResume({ userId: user.id, resumeId: copy.id });
    expect(survivor.id).toBe(copy.id);
    // The relationship is cleared rather than dangling.
    expect(survivor.sourceResumeId).toBeNull();
  });

  it('gives the copy fresh entry ids so the two cannot be coupled', async () => {
    const user = await track(createUser());
    const original = await createResume({ userId: user.id, input: { from: 'BLANK' }, limit: null });
    await updateResume({
      userId: user.id,
      resumeId: original.id,
      input: { expectedRevision: 1, content: typicalContent() },
    });
    const copy = await duplicateResume({ userId: user.id, resumeId: original.id, limit: null });

    const originalIds = (await getResume({ userId: user.id, resumeId: original.id })).content.experiences.map(
      (entry) => entry.id,
    );
    const copyIds = copy.content.experiences.map((entry) => entry.id);
    for (const id of copyIds) expect(originalIds).not.toContain(id);
  });

  it('can retarget a copy at a job and keeps the source aimed where it was', async () => {
    const user = await track(createUser());
    const jobA = await track(
      prisma.jobLead.create({
        data: { userId: user.id, company: 'Acme', title: 'Backend Engineer', score: {}, checklist: {}, contacts: {}, interviews: {}, prepPack: {} },
      }),
    );
    const jobB = await track(
      prisma.jobLead.create({
        data: { userId: user.id, company: 'Globex', title: 'Platform Engineer', score: {}, checklist: {}, contacts: {}, interviews: {}, prepPack: {} },
      }),
    );

    const original = await createResume({
      userId: user.id,
      input: { from: 'BLANK', targetJobId: jobA.id },
      limit: null,
    });
    expect(original.targetJobId).toBe(jobA.id);

    const tailored = await duplicateResume({
      userId: user.id,
      resumeId: original.id,
      name: 'Platform — Globex',
      targetJobId: jobB.id,
      limit: null,
    });

    expect(tailored.targetJobId).toBe(jobB.id);
    expect(tailored.targetJob).toEqual({ id: jobB.id, title: 'Platform Engineer', company: 'Globex' });

    const reloaded = await getResume({ userId: user.id, resumeId: original.id });
    expect(reloaded.targetJobId).toBe(jobA.id);
  });

  it('defaults a plain duplicate to the source\'s own target job', async () => {
    const user = await track(createUser());
    const job = await track(
      prisma.jobLead.create({
        data: { userId: user.id, company: 'Acme', title: 'Engineer', score: {}, checklist: {}, contacts: {}, interviews: {}, prepPack: {} },
      }),
    );
    const original = await createResume({ userId: user.id, input: { from: 'BLANK', targetJobId: job.id }, limit: null });
    const copy = await duplicateResume({ userId: user.id, resumeId: original.id, limit: null });
    expect(copy.targetJobId).toBe(job.id);
  });

  it('refuses to target another user\'s job', async () => {
    const alice = await track(createUser());
    const bob = await track(createUser());
    const bobsJob = await track(
      prisma.jobLead.create({
        data: { userId: bob.id, company: 'Bob Co', title: 'Engineer', score: {}, checklist: {}, contacts: {}, interviews: {}, prepPack: {} },
      }),
    );

    let error: unknown;
    try {
      await createResume({ userId: alice.id, input: { from: 'BLANK', targetJobId: bobsJob.id }, limit: null });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(TargetJobNotFoundError);
  });

  it('refuses to target a soft-deleted job', async () => {
    const user = await track(createUser());
    const job = await track(
      prisma.jobLead.create({
        data: {
          userId: user.id,
          company: 'Acme',
          title: 'Engineer',
          score: {},
          checklist: {},
          contacts: {},
          interviews: {},
          prepPack: {},
          deletedAt: new Date(),
        },
      }),
    );

    let error: unknown;
    try {
      await createResume({ userId: user.id, input: { from: 'BLANK', targetJobId: job.id }, limit: null });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(TargetJobNotFoundError);
  });

  it('offers only the caller\'s own jobs as targets', async () => {
    const alice = await track(createUser());
    const bob = await track(createUser());
    await track(
      prisma.jobLead.create({
        data: {
          userId: alice.id,
          company: 'Mine',
          title: 'With description',
          jobDescription: 'A real posting.',
          score: {},
          checklist: {},
          contacts: {},
          interviews: {},
          prepPack: {},
        },
      }),
    );
    await track(
      prisma.jobLead.create({
        data: { userId: alice.id, company: 'Mine', title: 'No description', score: {}, checklist: {}, contacts: {}, interviews: {}, prepPack: {} },
      }),
    );
    await track(
      prisma.jobLead.create({
        data: { userId: bob.id, company: 'Theirs', title: 'Private', score: {}, checklist: {}, contacts: {}, interviews: {}, prepPack: {} },
      }),
    );

    const jobs = await listTargetableJobs(alice.id);
    expect(jobs.length).toBe(2);
    expect(jobs.map((job) => job.company)).not.toContain('Theirs');

    const withDescription = jobs.find((job) => job.title === 'With description');
    const without = jobs.find((job) => job.title === 'No description');
    expect(withDescription?.hasDescription).toBe(true);
    expect(without?.hasDescription).toBe(false);
  });
});

// ─── Career profile integration ─────────────────────────────────────────────

async function seedCareerProfile(userId: string) {
  const profile = await prisma.userProfile.create({
    data: {
      userId,
      phone: '+44 7700 900123',
      summary: 'Backend engineer with seven years building payment platforms.',
      websiteUrl: 'https://jordanellis.dev',
      linkedinUrl: 'https://linkedin.com/in/jordanellis',
      location: 'Bristol, United Kingdom',
      headline: 'Senior Backend Engineer',
      careerProfileConfirmedAt: new Date(T0),
      careerProfileVersion: 3,
    },
  });

  const experience = await prisma.careerExperience.create({
    data: {
      profileId: profile.id,
      userId,
      jobTitle: 'Senior Backend Engineer',
      company: 'Acme Payments Ltd',
      location: 'London',
      startDate: '2021-03',
      endDate: null,
      isCurrent: true,
      responsibilities: ['Led the ledger migration.'],
      achievements: ['Reduced p99 latency by 38%.'],
      technologies: ['TypeScript', 'PostgreSQL'],
      evidenceSnippet: 'Reduced p99 latency by 38%.',
      sortOrder: 0,
    },
  });

  const education = await prisma.careerEducation.create({
    data: {
      profileId: profile.id,
      userId,
      institution: 'University of Bristol',
      qualification: 'BSc',
      fieldOfStudy: 'Computer Science',
      startDate: '2015-09',
      endDate: '2019-06',
      sortOrder: 0,
    },
  });

  const skill = await prisma.careerSkill.create({
    data: { profileId: profile.id, userId, name: 'TypeScript', origin: 'STATED', confirmed: true, sortOrder: 0 },
  });
  const inferred = await prisma.careerSkill.create({
    data: { profileId: profile.id, userId, name: 'Rust', origin: 'INFERRED', confirmed: false, sortOrder: 1 },
  });

  const project = await prisma.careerProject.create({
    data: {
      profileId: profile.id,
      userId,
      name: 'ledgerkit',
      description: 'Event sourcing helpers.',
      role: 'Maintainer',
      technologies: ['TypeScript'],
      results: ['320 stars'],
      sortOrder: 0,
    },
  });

  const credential = await prisma.careerCredential.create({
    data: {
      profileId: profile.id,
      userId,
      kind: 'CERTIFICATION',
      name: 'AWS Solutions Architect',
      issuer: 'Amazon Web Services',
      issuedDate: '2022-05',
      sortOrder: 0,
    },
  });

  return { profile, experience, education, skill, inferred, project, credential };
}

describe('populating a resume from the career profile', () => {
  it('copies confirmed values verbatim', async () => {
    const user = await track(createUser({ name: 'Jordan Ellis', email: 'jordan.ellis@example.com' }));
    await seedCareerProfile(user.id);

    const result = await resumeFromCareerProfile(user.id);
    expect(result).not.toBeNull();

    const content = result!.content;
    expect(content.basics.fullName).toBe('Jordan Ellis');
    expect(content.basics.email).toBe('jordan.ellis@example.com');
    expect(content.basics.phone).toBe('+44 7700 900123');
    expect(content.summary).toContain('seven years');
    expect(content.experiences[0].jobTitle).toBe('Senior Backend Engineer');
    expect(content.experiences[0].company).toBe('Acme Payments Ltd');
    expect(content.experiences[0].startDate).toBe('2021-03');
    expect(content.experiences[0].isCurrent).toBe(true);
    expect(content.experiences[0].achievements[0]).toBe('Reduced p99 latency by 38%.');
    expect(content.education[0].institution).toBe('University of Bristol');
    expect(content.skills.map((skill) => skill.name)).toContain('TypeScript');
    expect(content.projects[0].name).toBe('ledgerkit');
    expect(content.credentials[0].name).toBe('AWS Solutions Architect');
  });

  it('does not fabricate contact details the user never gave', async () => {
    const user = await track(createUser({ name: 'Jordan Ellis', email: 'jordan.ellis@example.com' }));
    await prisma.userProfile.create({
      data: { userId: user.id, careerProfileConfirmedAt: new Date(T0), careerProfileVersion: 1 },
    });

    const result = await resumeFromCareerProfile(user.id);
    expect(result!.content.basics.phone).toBeNull();
    expect(result!.content.basics.location).toBeNull();
    expect(result!.content.basics.linkedinUrl).toBeNull();
  });

  it('preserves an INFERRED skill as inferred rather than presenting it as verified', async () => {
    const user = await track(createUser());
    await seedCareerProfile(user.id);

    const result = await resumeFromCareerProfile(user.id);
    const rust = result!.content.skills.find((skill) => skill.name === 'Rust');
    expect(rust?.origin).toBe('INFERRED');
    const typescript = result!.content.skills.find((skill) => skill.name === 'TypeScript');
    expect(typescript?.origin).toBe('STATED');
  });

  it('does not duplicate the same experience twice', async () => {
    const user = await track(createUser());
    await seedCareerProfile(user.id);

    const result = await resumeFromCareerProfile(user.id);
    const keys = result!.content.experiences.map(
      (entry) => `${entry.company}|${entry.jobTitle}|${entry.startDate}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('does not infer an end date for a current role', async () => {
    const user = await track(createUser());
    const seeded = await seedCareerProfile(user.id);
    await prisma.careerExperience.update({
      where: { id: seeded.experience.id },
      // Deliberately contradictory source data: a current role with an end date.
      data: { isCurrent: true, endDate: '2024-01' },
    });

    const result = await resumeFromCareerProfile(user.id);
    expect(result!.content.experiences[0].isCurrent).toBe(true);
    expect(result!.content.experiences[0].endDate).toBeNull();
  });

  it('regenerates entry ids rather than reusing profile row ids', async () => {
    const user = await track(createUser());
    const seeded = await seedCareerProfile(user.id);

    const result = await resumeFromCareerProfile(user.id);
    expect(result!.content.experiences[0].id).not.toBe(seeded.experience.id);
    expect(result!.content.education[0].id).not.toBe(seeded.education.id);
  });

  it('returns null rather than throwing when there is no profile', async () => {
    const user = await track(createUser());
    const result = await resumeFromCareerProfile(user.id);
    expect(result).toBeNull();
  });

  it('creates an empty resume rather than failing when the profile is missing', async () => {
    const user = await track(createUser());
    const resume = await createResume({ userId: user.id, input: { from: 'PROFILE' }, limit: null });
    expect(resume.origin).toBe('BLANK');
    expect(resume.content.basics.fullName).toBeNull();
  });

  it('records the profile version it was built from', async () => {
    const user = await track(createUser());
    await seedCareerProfile(user.id);
    const resume = await createResume({ userId: user.id, input: { from: 'PROFILE' }, limit: null });
    expect(resume.sourceProfileVersion).toBe(3);
    expect(resume.origin).toBe('PROFILE');
  });

  it('does not modify the career profile when the resume is edited', async () => {
    const user = await track(createUser());
    const seeded = await seedCareerProfile(user.id);
    const resume = await createResume({ userId: user.id, input: { from: 'PROFILE' }, limit: null });

    const changed: ResumeContent = {
      ...resume.content,
      summary: 'A summary I wrote myself that says something completely different.',
      experiences: resume.content.experiences.map((entry, index) =>
        index === 0 ? { ...entry, jobTitle: 'Staff Engineer', company: 'Somewhere Else' } : entry,
      ),
    };
    await updateResume({
      userId: user.id,
      resumeId: resume.id,
      input: { expectedRevision: 1, content: changed },
    });

    const profile = await prisma.userProfile.findUniqueOrThrow({ where: { userId: user.id } });
    expect(profile.summary).toBe('Backend engineer with seven years building payment platforms.');
    expect(profile.careerProfileVersion).toBe(3);

    const experience = await prisma.careerExperience.findUniqueOrThrow({ where: { id: seeded.experience.id } });
    expect(experience.jobTitle).toBe('Senior Backend Engineer');
    expect(experience.company).toBe('Acme Payments Ltd');
  });

  it('does not modify the career profile when the resume is deleted', async () => {
    const user = await track(createUser());
    await seedCareerProfile(user.id);
    const resume = await createResume({ userId: user.id, input: { from: 'PROFILE' }, limit: null });

    await deleteResume({ userId: user.id, resumeId: resume.id });

    const summary = await careerProfileSummary(user.id);
    expect(summary).not.toBeNull();
    expect(summary!.confirmed).toBe(true);
    expect(summary!.counts.experiences).toBe(1);
    expect(summary!.counts.skills).toBe(2);
  });

  it('summarises the profile for the "start from" chooser', async () => {
    const user = await track(createUser());
    await seedCareerProfile(user.id);

    const summary = await careerProfileSummary(user.id);
    expect(summary?.confirmed).toBe(true);
    expect(summary?.counts.experiences).toBe(1);
    expect(summary?.counts.credentials).toBe(1);
  });

  it('reports an unconfirmed profile as unconfirmed', async () => {
    const user = await track(createUser());
    await prisma.userProfile.create({ data: { userId: user.id } });
    const summary = await careerProfileSummary(user.id);
    expect(summary?.confirmed).toBe(false);
  });
});

// ─── Storage of unreadable content ──────────────────────────────────────────

describe('defensive reads', () => {
  it('refuses to serve content that no longer validates rather than crashing the renderer', async () => {
    const user = await track(createUser());
    const resume = await createResume({ userId: user.id, input: { from: 'BLANK' }, limit: null });

    // Corrupted behind the service's back, which is exactly the case the
    // re-validation on read exists for.
    await prisma.structuredResume.update({
      where: { id: resume.id },
      data: { content: { experiences: 'not an array' } },
    });

    let error: unknown;
    try {
      await getResume({ userId: user.id, resumeId: resume.id });
    } catch (caught) {
      error = caught;
    }
    expect((error as Error).name).toBe('ResumeContentCorruptError');
  });
});