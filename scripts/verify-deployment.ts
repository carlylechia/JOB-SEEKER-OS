/**
 * Post-deploy verification.
 *
 * Migrations being applied is not the same as the application working. This
 * waits for the deployment to be genuinely healthy before a pipeline is allowed
 * to report success, and raises an alert if it never becomes so.
 *
 * Why this is its own step rather than a hopeful `sleep`:
 *
 *  - A merge is not a deploy. Vercel builds for a while after the push.
 *  - The build can succeed while the RUNTIME is broken — a green build that
 *    500s on the first request is exactly the failure this exists to catch.
 *  - "Probably fine" is how a broken dashboard reaches users.
 *
 * It deliberately checks the UNAUTHENTICATED `/api/health` endpoint, which is
 * the only surface that answers "can this deployment serve traffic at all"
 * without needing a session.
 *
 *   tsx scripts/verify-deployment.ts --url https://example.com --timeout 300
 */

export type HealthReport = {
  status: 'ok' | 'degraded';
  schema: { status: string; pendingMigrations?: string[]; unknownMigrations?: string[] };
  databaseReachable?: boolean;
  detail?: string;
};

export type Options = {
  url: string;
  timeoutSeconds: number;
  intervalSeconds: number;
};

export type ProbeResult = {
  ok: boolean;
  status: number | null;
  body: HealthReport | null;
  note: string;
};

export function parseArgs(argv: string[]): Options {
  const get = (flag: string, fallback: string): string => {
    const index = argv.indexOf(flag);
    return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
  };
  return {
    url: (get('--url', process.env.DEPLOY_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? '')).replace(/\/$/, ''),
    timeoutSeconds: Number(get('--timeout', '300')),
    intervalSeconds: Number(get('--interval', '10')),
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One probe.
 *
 * Returns a verdict rather than throwing, so a transient network blip is a
 * "not yet" rather than an abort.
 */
export async function probe(url: string): Promise<ProbeResult> {
  try {
    const response = await fetch(`${url}/api/health`, {
      headers: { accept: 'application/json' },
      // A cold serverless function can take a while to wake.
      signal: AbortSignal.timeout(20_000),
    });

    const text = await response.text();
    let body: HealthReport | null = null;
    try {
      body = JSON.parse(text) as HealthReport;
    } catch {
      return { ok: false, status: response.status, body: null, note: 'response was not JSON' };
    }

    if (response.status === 200 && body.status === 'ok') {
      return { ok: true, status: 200, body, note: 'healthy' };
    }

    if (body.schema?.status === 'BEHIND') {
      return {
        ok: false,
        status: response.status,
        body,
        note: `schema is BEHIND — missing ${(body.schema.pendingMigrations ?? []).join(', ')}`,
      };
    }

    return { ok: false, status: response.status, body, note: `status ${response.status}` };
  } catch (error) {
    return {
      ok: false,
      status: null,
      body: null,
      note: error instanceof Error ? error.message.slice(0, 120) : String(error).slice(0, 120),
    };
  }
}

/**
 * Fire the existing Discord alert.
 *
 * Reuses the webhook this project already alerts on, so a failed deploy lands
 * in the same channel as every other important error rather than nowhere.
 * Failure to alert is logged and swallowed: a webhook outage must not mask the
 * real problem.
 */
export async function alert(title: string, message: string): Promise<void> {
  const webhook = process.env.ALERT_WEBHOOK_URL;
  if (!webhook) {
    console.warn('  (no ALERT_WEBHOOK_URL set — skipping alert)');
    return;
  }
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: [
          `**[teChia Jobs] ${title}**`,
          '',
          message.slice(0, 1600),
        ].join('\n'),
      }),
    });
  } catch (error) {
    console.warn('  (alert could not be sent)', error instanceof Error ? error.message : error);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!options.url) {
    console.error(
      'No URL to check. Pass --url, or set DEPLOY_URL / NEXT_PUBLIC_APP_URL.\n' +
        'The application URL is read from NEXT_PUBLIC_APP_URL in most setups.',
    );
    process.exit(1);
  }

  const healthUrl = `${options.url}/api/health`;
  console.log(`\nWaiting for ${healthUrl} to report healthy (timeout ${options.timeoutSeconds}s)\n`);

  const deadline = Date.now() + options.timeoutSeconds * 1000;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt += 1;
    const result = await probe(options.url);

    if (result.ok) {
      console.log(`  ✓ healthy after ${attempt} attempt(s)`);
      console.log(`    schema: ${result.body?.schema.status}`);
      console.log(`    database reachable: ${result.body?.databaseReachable ?? 'unknown'}\n`);
      return;
    }

    console.log(`  … attempt ${attempt}: ${result.note}`);
    await sleep(options.intervalSeconds * 1000);
  }

  const final = await probe(options.url);

  const message = [
    `A deployment to ${options.url} never became healthy within ${options.timeoutSeconds}s.`,
    '',
    `Last probe: ${final.note}`,
    final.body?.schema?.status === 'BEHIND'
      ? `Pending migrations: ${(final.body.schema.pendingMigrations ?? []).join(', ')}`
      : '',
    '',
    `Check: ${healthUrl}`,
  ]
    .filter(Boolean)
    .join('\n');

  console.error(`\n  ✗ ${options.url} did not become healthy.\n`);
  await alert('Deployment verification failed', message);
  process.exit(1);
}

/**
 * Only run when invoked directly, so tests can import the pure helpers without
 * a network probe firing as a side effect of the import.
 */
if (require.main === module) {
  main().catch((error) => {
    console.error('Deployment verification crashed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}