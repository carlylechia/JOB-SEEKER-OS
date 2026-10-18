/**
 * Deployment verification tests.
 *
 * This script is the last line of defence in the deploy pipeline: a green
 * build means nothing if the runtime 500s. On 2026-10-18 a build went green
 * while every dashboard load failed, so the claim being tested here is that
 * "the pipeline passed" actually implies "the site works".
 *
 * The probe is exercised against a real local HTTP server rather than a mock,
 * because the failure modes that matter — a 503 body, a non-JSON response, a
 * connection that never answers — are exactly the ones a hand-written mock
 * tends to get wrong.
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { describe, it, afterEach, expect } from './harness';
import { parseArgs, probe } from '../scripts/verify-deployment';

const servers: http.Server[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

/** Start a server that answers /api/health with the given handler. */
function serve(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<string> {
  const server = http.createServer(handler);
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

const HEALTHY = {
  status: 'ok',
  schema: { status: 'CURRENT', pendingMigrations: [], unknownMigrations: [] },
  databaseReachable: true,
};

describe('argument parsing', () => {
  it('reads the url, timeout and interval from flags', () => {
    const options = parseArgs(['--url', 'https://example.com', '--timeout', '120', '--interval', '4']);
    expect(options.url).toBe('https://example.com');
    expect(options.timeoutSeconds).toBe(120);
    expect(options.intervalSeconds).toBe(4);
  });

  it('strips a trailing slash so paths never double up', () => {
    expect(parseArgs(['--url', 'https://example.com/']).url).toBe('https://example.com');
  });

  it('falls back to the environment when no flag is given', () => {
    const previous = process.env.DEPLOY_URL;
    process.env.DEPLOY_URL = 'https://from-env.example.com';
    expect(parseArgs([]).url).toBe('https://from-env.example.com');
    if (previous === undefined) delete process.env.DEPLOY_URL;
    else process.env.DEPLOY_URL = previous;
  });

  it('defaults the timeout generously, because builds are slow', () => {
    expect(parseArgs(['--url', 'https://example.com']).timeoutSeconds).toBe(300);
  });
});

describe('probing a healthy deployment', () => {
  it('accepts a 200 that reports an ok status', async () => {
    const url = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(HEALTHY));
    });

    const result = await probe(url);
    expect(result.ok).toBe(true);
    expect(result.body?.schema.status).toBe('CURRENT');
  });
});

describe('probing a deployment that is up but wrong', () => {
  /**
   * This is the exact 2026-10-18 failure: the app answers, the build was
   * green, and the schema was behind. Returning `ok` here would be a lie that
   * reports a broken site as a passing deploy.
   */
  it('rejects a 503 reporting the schema is behind, and names the migration', async () => {
    const url = await serve((_req, res) => {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'degraded',
          schema: { status: 'BEHIND', pendingMigrations: ['20261018125251_job_intelligence'] },
        }),
      );
    });

    const result = await probe(url);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
    expect(result.note).toContain('BEHIND');
    expect(result.note).toContain('20261018125251_job_intelligence');
  });

  it('rejects a 200 that reports degraded, rather than trusting the status code', async () => {
    // Status code alone is not the contract; the body's verdict is.
    const url = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'degraded', schema: { status: 'BEHIND', pendingMigrations: ['x'] } }));
    });

    expect((await probe(url)).ok).toBe(false);
  });

  it('rejects a non-JSON response instead of crashing', async () => {
    const url = await serve((_req, res) => {
      res.writeHead(500, { 'content-type': 'text/html' });
      res.end('<html>Vercel error page</html>');
    });

    const result = await probe(url);
    expect(result.ok).toBe(false);
    expect(result.note).toContain('not JSON');
  });

  it('rejects a 404, which means the route is missing from the build', async () => {
    const url = await serve((_req, res) => {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not Found');
    });

    expect((await probe(url)).ok).toBe(false);
  });

  it('reports an unreachable host as not-ready rather than throwing', async () => {
    // A transient network blip must be "not yet", never an abort that takes
    // down the whole pipeline.
    const result = await probe('https://definitely-not-a-real-host-xyz.invalid');
    expect(result.ok).toBe(false);
    expect(result.status).toBeNull();
    expect(typeof result.note).toBe('string');
  });
});