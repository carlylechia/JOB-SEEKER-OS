/**
 * Workflow file validation.
 *
 * On 2026-10-18 the first version of the deploy workflow was merged and
 * silently refused to run: GitHub rejected the file itself because a
 * multi-line double-quoted `run:` scalar containing inline JavaScript does not
 * parse. The run failed with "This run likely failed because of a workflow file
 * issue" and produced no log — so the pipeline that was supposed to catch
 * outages was itself down, and nothing in the test suite noticed.
 *
 * These tests make that impossible to repeat:
 *
 *  - every workflow file must parse as YAML
 *  - every `run:` step must be a string or a block, never a malformed scalar
 *  - the deploy pipeline must actually contain the steps it claims to
 */

import fs from 'node:fs';
import path from 'node:path';

import yaml from 'js-yaml';
import { describe, it, expect } from './harness';

const WORKFLOW_DIR = path.join(process.cwd(), '.github', 'workflows');

type Workflow = {
  name?: string;
  on?: unknown;
  jobs?: Record<string, { steps?: Array<{ name?: string; run?: unknown; uses?: string }> }>;
};

function workflowFiles(): string[] {
  if (!fs.existsSync(WORKFLOW_DIR)) return [];
  return fs.readdirSync(WORKFLOW_DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
}

describe('workflow files', () => {
  it('has at least one workflow to check', () => {
    // Guards against this suite silently passing because the directory moved.
    expect(workflowFiles().length).toBeGreaterThan(0);
  });

  it('parses every workflow as valid YAML', () => {
    for (const file of workflowFiles()) {
      const raw = fs.readFileSync(path.join(WORKFLOW_DIR, file), 'utf8');
      let parsed: unknown;
      let error: unknown = null;
      try {
        parsed = yaml.load(raw);
      } catch (caught) {
        error = caught;
      }
      // The assertion IS the parse. A malformed scalar throws here.
      expect(error).toBeNull();
      expect(parsed).toBeDefined();
    }
  });

  it('gives every workflow a name and at least one job', () => {
    for (const file of workflowFiles()) {
      const wf = yaml.load(fs.readFileSync(path.join(WORKFLOW_DIR, file), 'utf8')) as Workflow;
      expect(typeof wf.name).toBe('string');
      expect(Object.keys(wf.jobs ?? {}).length).toBeGreaterThan(0);
    }
  });

  /**
   * Every `run:` must be a plain string. The 2026-10-18 failure produced a
   * value that looked like a mapping rather than a command, so this is the
   * specific shape that broke.
   */
  it('never lets a run step be a non-string', () => {
    for (const file of workflowFiles()) {
      const wf = yaml.load(fs.readFileSync(path.join(WORKFLOW_DIR, file), 'utf8')) as Workflow;
      for (const [jobName, job] of Object.entries(wf.jobs ?? {})) {
        for (const step of job.steps ?? []) {
          if (step.run === undefined) continue;
          expect(typeof step.run).toBe('string');
          // Also catch a step that parsed into an object, which reads better
          // than a raw type failure in the assertion above.
          expect(step.run === null || typeof step.run === 'object').toBe(false);
          void `${jobName}:${step.name ?? ''}`;
        }
      }
    }
  });

  it('keeps every step name non-empty, so logs are readable', () => {
    for (const file of workflowFiles()) {
      const wf = yaml.load(fs.readFileSync(path.join(WORKFLOW_DIR, file), 'utf8')) as Workflow;
      for (const job of Object.values(wf.jobs ?? {})) {
        for (const step of job.steps ?? []) {
          expect(typeof step.name).toBe('string');
          expect((step.name ?? '').trim().length).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('the deploy pipeline', () => {
  const file = path.join(WORKFLOW_DIR, 'deploy.yml');
  const load = (): Workflow => yaml.load(fs.readFileSync(file, 'utf8')) as Workflow;

  it('triggers on pushes to main', () => {
    const wf = load();
    const on = (wf.on ?? {}) as { push?: { branches?: string[] } };
    expect(on.push?.branches).toContain('main');
  });

  it('serialises deployments and never cancels one midway', () => {
    const raw = fs.readFileSync(file, 'utf8');
    const wf = yaml.load(raw) as Workflow & {
      concurrency?: { group?: string; 'cancel-in-progress'?: boolean };
    };
    expect(wf.concurrency?.group).toBeTruthy();
    // A cancelled migration job is exactly the half-finished state that
    // caused the outage. A newer push must wait instead.
    expect(wf.concurrency?.['cancel-in-progress']).toBe(false);
  });

  it('applies migrations before it verifies, not after', () => {
    const wf = load();
    const steps = wf.jobs?.deploy?.steps ?? [];
    const names = steps.map((s) => s.name ?? '');

    const migrate = names.findIndex((n) => n.includes('Apply pending migrations'));
    const verify = names.findIndex((n) => n.includes('Verify the schema now matches'));

    expect(migrate).toBeGreaterThanOrEqual(0);
    expect(verify).toBeGreaterThanOrEqual(0);
    expect(migrate).toBeLessThan(verify);
  });

  it('waits for a healthy deployment rather than trusting a green build', () => {
    const wf = load();
    const names = (wf.jobs?.deploy?.steps ?? []).map((s) => s.name ?? '');
    expect(names.some((n) => n.includes('become healthy'))).toBe(true);
  });

  it('uses migrate deploy, never db push or reset', () => {
    const raw = fs.readFileSync(file, 'utf8');
    // `migrate deploy` applies committed migrations only. `db push` invents
    // schema and `reset` destroys it; neither may ever reach a pipeline.
    expect(raw).not.toContain('prisma db push');
    expect(raw).not.toContain('migrate reset');
    expect(raw).toContain('prisma migrate deploy');
  });

  it('never prints the database URL', () => {
    const raw = fs.readFileSync(file, 'utf8');
    // The URL carries the password; echoing it into a build log leaks it.
    const echoes = raw.split('\n').filter((line) => /echo.*\$DATABASE_URL/.test(line));
    expect(echoes.length).toBe(0);
  });
});