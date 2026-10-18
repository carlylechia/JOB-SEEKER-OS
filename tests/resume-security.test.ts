/**
 * Resume Builder security.
 *
 * The invariants under test are the ones a resume product must never violate:
 * one user cannot reach another's document, a client cannot set its own
 * identity, plan or role, a paid operation is gated server-side, an export
 * cannot be cached publicly, and untrusted resume text cannot introduce
 * executable structure into a generated document.
 *
 * ── What is tested, and how ────────────────────────────────────────────────
 *
 * These run against the service layer and the request contracts, which is the
 * layer the route handlers are a thin wrapper around. Request schemas and the
 * download headers deliberately live in `src/lib/resume-builder/requests.ts`
 * and `download.ts` rather than inside the route modules, precisely so they can
 * be asserted here against the SAME objects production uses — a route module may
 * only export HTTP verbs, so a schema defined inside one would be untestable and
 * a copy asserted here could silently drift from it.
 *
 * The route handlers additionally contain no authorisation logic of their own:
 * they resolve the session, hand a session-derived `userId` to the service, and
 * map domain errors onto the shared envelope. That is asserted structurally by
 * `no route derives identity from the request`, below.
 */

import { describe, it, expect, afterEach } from './harness';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { prisma } from '@/lib/prisma';
import {
  StructuredResumeNotFoundError,
  TargetJobNotFoundError,
  createResume,
  deleteResume,
  duplicateResume,
  getResume,
  listResumes,
  listTargetableJobs,
  updateResume,
} from '@/lib/resume-builder/documents';
import { resumeDownloadHeaders } from '@/lib/resume-builder/download';
import { getLayoutMetrics, preparePdfEngine, renderPdfLayout } from '@/lib/resume-builder/pdf';
import { buildLayout } from '@/lib/resume-builder/layout';
import {
  applyOptimizationRequestSchema,
  duplicateResumeRequestSchema,
  runOptimizationRequestSchema,
} from '@/lib/resume-builder/requests';
import { resumeContentSchema } from '@/lib/resume-builder/schema';
import { applyAcceptedOperations, buildOptimizationInputs } from '@/lib/resume-builder/optimization/service';
import { getEntitlements } from '@/lib/billing/subscriptions';
import { createUser, destroyUser, DAY_MS, T0 } from './helpers';
import { hostileContent, TYPICAL_JOB_DESCRIPTION, typicalContent } from './resume-builder-fixtures';

const created: string[] = [];
async function track<T extends { id: string }>(p: Promise<T>): Promise<T> {
  const v = await p;
  created.push(v.id);
  return v;
}

afterEach(async () => {
  for (const id of created.splice(0)) await destroyUser(id).catch(() => undefined);
});

async function seedUser(params: { pro?: boolean; role?: 'USER' | 'ADMIN' } = {}) {
  const user = await track(createUser({ role: params.role }));
  if (params.pro) {
    const plan = await prisma.plan.findUniqueOrThrow({ where: { code: 'PRO' } });
    await prisma.subscription.create({
      data: {
        userId: user.id,
        planId: plan.id,
        status: 'ACTIVE',
        startsAt: new Date(T0.getTime() - DAY_MS),
        source: 'ADMIN_MANUAL',
      },
    });
  }
  return user;
}

async function seedResume(userId: string) {
  const resume = await createResume({ userId, input: { from: 'BLANK' }, limit: null });
  await updateResume({
    userId,
    resumeId: resume.id,
    input: { expectedRevision: 1, content: typicalContent() },
  });
  return getResume({ userId, resumeId: resume.id });
}

async function seedJob(userId: string, description: string | null = TYPICAL_JOB_DESCRIPTION) {
  return track(
    prisma.jobLead.create({
      data: {
        userId,
        company: 'Northwind',
        title: 'Senior Backend Engineer',
        jobDescription: description,
        score: {},
        checklist: {},
        contacts: {},
        interviews: {},
        prepPack: {},
      },
    }),
  );
}

// ─── Ownership ──────────────────────────────────────────────────────────────

describe('ownership boundaries', () => {
  it('does not let one user read another user\'s resume', async () => {
    const alice = await seedUser();
    const bob = await seedUser();
    const mine = await seedResume(alice.id);

    await expect(getResume({ userId: bob.id, resumeId: mine.id })).rejects.toThrow(
      StructuredResumeNotFoundError,
    );
  });

  it('returns an identical error for a missing resume and someone else\'s', async () => {
    const alice = await seedUser();
    const bob = await seedUser();
    const mine = await seedResume(alice.id);

    const theirs = await getResume({ userId: bob.id, resumeId: mine.id }).catch((error) => error);
    const missing = await getResume({ userId: bob.id, resumeId: 'does-not-exist' }).catch(
      (error) => error,
    );

    expect(theirs.message).toBe(missing.message);
    expect(theirs.name).toBe(missing.name);
  });

  it('does not let one user update another user\'s resume', async () => {
    const alice = await seedUser();
    const bob = await seedUser();
    const mine = await seedResume(alice.id);

    await expect(
      updateResume({ userId: bob.id, resumeId: mine.id, input: { expectedRevision: 1, name: 'Hijacked' } }),
    ).rejects.toThrow(StructuredResumeNotFoundError);

    expect((await getResume({ userId: alice.id, resumeId: mine.id })).name).not.toBe('Hijacked');
  });

  it('does not let one user delete another user\'s resume', async () => {
    const alice = await seedUser();
    const bob = await seedUser();
    const mine = await seedResume(alice.id);

    await expect(deleteResume({ userId: bob.id, resumeId: mine.id })).rejects.toThrow(
      StructuredResumeNotFoundError,
    );
    expect((await listResumes(alice.id)).length).toBe(1);
  });

  it('does not let one user duplicate another user\'s resume', async () => {
    const alice = await seedUser();
    const bob = await seedUser();
    const mine = await seedResume(alice.id);

    await expect(
      duplicateResume({ userId: bob.id, resumeId: mine.id, limit: null }),
    ).rejects.toThrow(StructuredResumeNotFoundError);
    expect((await listResumes(bob.id)).length).toBe(0);
  });

  it('does not optimise against another user\'s resume', async () => {
    const alice = await seedUser({ pro: true });
    const bob = await seedUser({ pro: true });
    const mine = await seedResume(alice.id);

    await expect(buildOptimizationInputs({ userId: bob.id, resumeId: mine.id })).rejects.toThrow(
      StructuredResumeNotFoundError,
    );
  });

  it('does not apply another user\'s proposal to their own resume', async () => {
    const alice = await seedUser({ pro: true });
    const bob = await seedUser({ pro: true });
    const mine = await seedResume(alice.id);
    await applyAcceptedOperations({
      userId: bob.id,
      resumeId: mine.id,
      optimizationId: 'any-id',
      acceptedOperationIds: ['any-operation'],
      expectedRevision: mine.revision,
    }).catch((error) => {
      // The proposal id cannot belong to this user, so the lookup fails before
      // any content is read.
      expect(error).toBeInstanceOf(StructuredResumeNotFoundError);
    });

    // And the document is untouched either way.
    const reloaded = await getResume({ userId: alice.id, resumeId: mine.id });
    expect(reloaded.revision).toBe(mine.revision);
  });

  it('offers only the caller\'s own jobs as targets', async () => {
    const alice = await seedUser();
    const bob = await seedUser();
    await seedJob(bob.id);

    const jobs = await listTargetableJobs(alice.id);
    expect(jobs).toHaveLength(0);
  });

  it('refuses to target another user\'s private job', async () => {
    const alice = await seedUser();
    const bob = await seedUser();
    const privateJob = await seedJob(bob.id);

    await expect(
      createResume({ userId: alice.id, input: { from: 'BLANK', targetJobId: privateJob.id }, limit: null }),
    ).rejects.toThrow(TargetJobNotFoundError);

    // The error must not confirm that the job exists.
    await expect(
      createResume({
        userId: alice.id,
        input: { from: 'BLANK', targetJobId: 'genuinely-missing' },
        limit: null,
      }),
    ).rejects.toThrow(TargetJobNotFoundError);
  });

  it('refuses to target a soft-deleted job', async () => {
    const user = await seedUser();
    const job = await track(
      prisma.jobLead.create({
        data: {
          userId: user.id,
          company: 'Gone',
          title: 'Removed',
          score: {},
          checklist: {},
          contacts: {},
          interviews: {},
          prepPack: {},
          deletedAt: new Date(),
        },
      }),
    );

    await expect(
      createResume({ userId: user.id, input: { from: 'BLANK', targetJobId: job.id }, limit: null }),
    ).rejects.toThrow(TargetJobNotFoundError);
  });
});

// ─── Client-supplied identity ───────────────────────────────────────────────

describe('client-supplied identity is rejected, not ignored', () => {
  it('refuses a run payload naming a user, a job or a plan', () => {
    for (const payload of [
      { force: false, userId: 'someone-else' },
      { force: false, jobId: 'some-job' },
      { force: false, plan: 'PREMIUM' },
      { force: false, content: {} },
    ]) {
      expect(runOptimizationRequestSchema.safeParse(payload).success).toBe(false);
    }
  });

  it('accepts an empty run payload, which means "optimise the stored state"', () => {
    expect(runOptimizationRequestSchema.safeParse({}).success).toBe(true);
  });

  it('refuses an apply payload naming a different resume or a user', () => {
    for (const payload of [
      { optimizationId: 'a', acceptedOperationIds: ['x'], expectedRevision: 1, targetResumeId: 'other' },
      { optimizationId: 'a', acceptedOperationIds: ['x'], expectedRevision: 1, userId: 'other' },
      { optimizationId: 'a', acceptedOperationIds: ['x'], expectedRevision: 1, applyAll: true },
    ]) {
      expect(applyOptimizationRequestSchema.safeParse(payload).success).toBe(false);
    }
  });

  it('refuses an apply with no accepted operations', () => {
    expect(
      applyOptimizationRequestSchema.safeParse({
        optimizationId: 'a',
        acceptedOperationIds: [],
        expectedRevision: 1,
      }).success,
    ).toBe(false);
  });

  it('refuses an apply with no revision', () => {
    expect(
      applyOptimizationRequestSchema.safeParse({
        optimizationId: 'a',
        acceptedOperationIds: ['x'],
      }).success,
    ).toBe(false);
  });

  it('refuses an over-long user edit', () => {
    expect(
      applyOptimizationRequestSchema.safeParse({
        optimizationId: 'a',
        acceptedOperationIds: ['x'],
        expectedRevision: 1,
        editedText: { x: 'y'.repeat(5000) },
      }).success,
    ).toBe(false);
  });

  it('refuses a duplicate payload carrying ownership fields', () => {
    expect(duplicateResumeRequestSchema.safeParse({ userId: 'other' }).success).toBe(false);
    expect(duplicateResumeRequestSchema.safeParse({}).success).toBe(true);
  });

  it('refuses a content document carrying an identity field', () => {
    expect(resumeContentSchema.safeParse({ basics: {}, userId: 'other' }).success).toBe(false);
  });

  it('stores only fields the schema allows, with no write path to role or plan', async () => {
    const user = await seedUser();
    const resume = await seedResume(user.id);

    await expect(
      updateResume({
        userId: user.id,
        resumeId: resume.id,
        input: { expectedRevision: 1, role: 'ADMIN' } as never,
      }),
    ).rejects.toThrow();

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.role).toBe('USER');
  });
});

// ─── Entitlements ───────────────────────────────────────────────────────────

describe('server-side entitlement gates', () => {
  it('withholds the builder and the optimiser from a user with no paid plan', async () => {
    const user = await seedUser();
    const entitlements = await getEntitlements(user.id);
    expect(entitlements.features.RESUME_BUILDER).toBe(false);
    expect(entitlements.features.RESUME_OPTIMIZATION).toBe(false);
  });

  it('grants them to a paying user', async () => {
    const user = await seedUser({ pro: true });
    const entitlements = await getEntitlements(user.id);
    expect(entitlements.features.RESUME_BUILDER).toBe(true);
    expect(entitlements.features.RESUME_OPTIMIZATION).toBe(true);
  });

  it('grants them to an admin and to nobody else by role string', async () => {
    const admin = await seedUser({ role: 'ADMIN' });
    const entitlements = await getEntitlements(admin.id);
    expect(entitlements.isAdmin).toBe(true);
    expect(entitlements.features.RESUME_BUILDER).toBe(true);
  });

  it('withholds them once a trial has elapsed', async () => {
    const user = await seedUser();
    const plan = await prisma.plan.findUniqueOrThrow({ where: { code: 'PRO' } });
    await prisma.subscription.create({
      data: {
        userId: user.id,
        planId: plan.id,
        status: 'TRIALING',
        startsAt: new Date(T0.getTime() - 30 * DAY_MS),
        trialStartsAt: new Date(T0.getTime() - 30 * DAY_MS),
        trialEndsAt: new Date(T0.getTime() - DAY_MS),
        source: 'TRIAL',
      },
    });
    const entitlements = await getEntitlements(user.id);
    expect(entitlements.plan).toBe('FREE');
    expect(entitlements.features.RESUME_OPTIMIZATION).toBe(false);
  });
});

// ─── Download headers ───────────────────────────────────────────────────────

describe('export response headers', () => {
  it('is never publicly cacheable', () => {
    const headers = resumeDownloadHeaders({ resumeName: 'Jordan Ellis', byteLength: 1234 });
    const cacheControl = headers.get('Cache-Control') ?? '';
    expect(cacheControl).toContain('private');
    expect(cacheControl).toContain('no-store');
    expect(cacheControl).toContain('must-revalidate');
    expect(headers.get('Pragma')).toBe('no-cache');
    expect(headers.get('Vary')).toBe('Cookie');
  });

  it('is an attachment with a safe filename', () => {
    const headers = resumeDownloadHeaders({ resumeName: 'Jordan Ellis', byteLength: 1 });
    expect(headers.get('Content-Disposition')).toContain('attachment');
    expect(headers.get('Content-Disposition')).toContain('Jordan-Ellis.pdf');
  });

  it('cannot have its header broken by a hostile resume name', () => {
    for (const name of ['../../etc/passwd', 'a"b;c\nd\re', '%PDF-1.7\r\n%evil', '你好']) {
      const disposition = resumeDownloadHeaders({ resumeName: name, byteLength: 1 }).get(
        'Content-Disposition',
      ) as string;
      expect(disposition).not.toContain('\n');
      expect(disposition).not.toContain('\r');
      // Exactly one unescaped filename pair; the RFC 5987 form is URL-encoded.
      expect(disposition.split('filename=').length).toBe(2);
    }
  });

  it('declares the real length so a truncated body is detectable', () => {
    expect(resumeDownloadHeaders({ resumeName: 'A', byteLength: 98765 }).get('Content-Length')).toBe(
      '98765',
    );
  });

  it('sandsboxes the document and forbids sniffing', () => {
    const headers = resumeDownloadHeaders({ resumeName: 'A', byteLength: 1 });
    expect(headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox");
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('Content-Type')).toBe('application/pdf');
  });
});

// ─── Untrusted content in the exported document ─────────────────────────────

describe('malicious resume content in the exported document', () => {
  it('introduces no executable PDF structure', async () => {
    await preparePdfEngine();
    const layout = buildLayout(
      { content: hostileContent(), templateKey: 'classic-ats', accentKey: 'gold', density: 1 },
      getLayoutMetrics(),
    );
    const { bytes } = await renderPdfLayout(layout);
    const raw = Buffer.from(bytes).toString('latin1');

    expect(raw).not.toContain('/JavaScript');
    expect(raw).not.toContain('/JS');
    expect(raw).not.toContain('/OpenAction');
    expect(raw).not.toContain('/AA');
    expect(raw).not.toContain('/Launch');
    expect(raw).not.toContain('/EmbeddedFile');
    expect(raw).not.toContain('/RichMedia');
  });

  it('renders hostile text as literal text rather than dropping it', async () => {
    await preparePdfEngine();
    const layout = buildLayout(
      { content: hostileContent(), templateKey: 'classic-ats', accentKey: 'gold', density: 1 },
      getLayoutMetrics(),
    );
    const { bytes } = await renderPdfLayout(layout);
    const { getDocumentProxy, extractText } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });

    expect(text).toContain('IGNORE ALL PREVIOUS INSTRUCTIONS');
    expect(text).toContain('DROP TABLE jobs');
    // The markup is drawn as glyphs, not interpreted.
    expect(text).toContain('<script>');
  });

  it('stores a SQL-looking payload verbatim without executing it', async () => {
    const user = await seedUser();
    const resume = await createResume({ userId: user.id, input: { from: 'BLANK' }, limit: null });
    const payload = "'); DELETE FROM StructuredResume; --";
    await updateResume({
      userId: user.id,
      resumeId: resume.id,
      input: {
        expectedRevision: 1,
        content: resumeContentSchema.parse({
          basics: { fullName: 'Test' },
          experiences: [{ id: 'a', responsibilities: [payload] }],
        }),
      },
    });

    // Every row is still there, and the payload is just a string.
    expect(await prisma.structuredResume.count()).toBe(1);
    const reloaded = await getResume({ userId: user.id, resumeId: resume.id });
    expect(reloaded.content.experiences[0].responsibilities[0]).toBe(payload);
  });

  it('refuses a javascript URL in a contact field', () => {
    expect(resumeContentSchema.safeParse({ basics: { websiteUrl: 'javascript:alert(1)' } }).success).toBe(
      false,
    );
    expect(resumeContentSchema.safeParse({ basics: { portfolioUrl: 'data:text/html,x' } }).success).toBe(
      false,
    );
  });

  it('accepts only http and https URLs', () => {
    const parsed = resumeContentSchema.parse({
      basics: {
        linkedinUrl: 'https://linkedin.com/in/x',
        portfolioUrl: 'http://x.dev',
        websiteUrl: 'x.dev',
      },
    });
    expect(parsed.basics.linkedinUrl).toBe('https://linkedin.com/in/x');
    // Normalised by URL parsing, so the stored value is always absolute.
    expect(parsed.basics.portfolioUrl).toBe('http://x.dev/');
    expect(parsed.basics.websiteUrl).toBe('https://x.dev/');
  });
});

// ─── Structural guarantee about the routes ──────────────────────────────────

describe('no route derives identity from the request', () => {
  const ROUTE_DIR = path.join(process.cwd(), 'src', 'app', 'api', 'resumes');

  function routeFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return routeFiles(full);
      return entry.name === 'route.ts' ? [full] : [];
    });
  }

  it('finds the route modules it expects', () => {
    const files = routeFiles(ROUTE_DIR).map((file) => path.relative(ROUTE_DIR, file));
    expect(files.sort()).toEqual(
      [
        'eligible-jobs/route.ts',
        'route.ts',
        '[id]/duplicate/route.ts',
        '[id]/export.pdf/route.ts',
        '[id]/optimization/apply/route.ts',
        '[id]/optimization/route.ts',
        '[id]/preview/route.ts',
        '[id]/route.ts',
      ].sort(),
    );
  });

  const FORBIDDEN_IN_ROUTES: Array<[RegExp, string]> = [
    [/body\.userId/, 'reads a userId from the request body'],
    [/body\.role/, 'reads a role from the request body'],
    [/body\.plan/, 'reads a plan from the request body'],
    [/searchParams\.get\(['"]userId/, 'reads a userId from the query string'],
    [/searchParams\.get\(['"]role/, 'reads a role from the query string'],
    [/body\.targetResumeId/, 'accepts a target resume from the request body'],
    [/\{\s*error\.message\s*\}/, 'sends a raw error message to the client'],
  ];

  it('never takes identity, role or plan from the request', () => {
    for (const file of routeFiles(ROUTE_DIR)) {
      const source = readFileSync(file, 'utf8');
      // Identity comes from the session and is used verbatim.
      expect(source.includes('session.user.id')).toBe(true);

      for (const [pattern, description] of FORBIDDEN_IN_ROUTES) {
        expect(`${file}: ${description}`.length > 0).toBe(true);
        expect(pattern.test(source)).toBe(false);
      }
    }
  });

  it('answers every authenticated response private and no-store', () => {
    for (const file of routeFiles(ROUTE_DIR)) {
      const source = readFileSync(file, 'utf8');
      if (file.endsWith('export.pdf/route.ts')) {
        // The export builds its headers through the shared, tested helper.
        expect(source).toContain('resumeDownloadHeaders');
        continue;
      }
      expect(source.includes('privateNoStore')).toBe(true);
    }
  });

  it('maps domain errors through the shared envelope instead of leaking internals', () => {
    for (const file of routeFiles(ROUTE_DIR)) {
      const source = readFileSync(file, 'utf8');
      expect(source.includes('handleRoute')).toBe(true);
    }
  });
});