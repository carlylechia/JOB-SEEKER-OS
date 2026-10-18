/**
 * Health and schema-drift check.
 *
 * Two jobs:
 *
 *  1. Let monitoring ask whether the app is up, without a session.
 *  2. Answer the one question that is otherwise invisible — "is the database
 *     schema in step with the code that is deployed?" — so a drift is diagnosed
 *     in seconds instead of from a support ticket saying "the dashboard is
 *     broken".
 *
 * Deliberately reports NO secrets and NO user data. It is unauthenticated, so
 * it says only what an anonymous visitor already learns from a status code.
 */

import { NextResponse } from 'next/server';
import { withCors } from '@/lib/cors';
import { checkSchemaDrift, explainDrift } from '@/lib/db/schema-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const report = await checkSchemaDrift();

  // `BEHIND` is a 503: the app is deployed but cannot serve the pages that
  // read the missing tables. Callers can alert on the status alone.
  const status = report.status === 'BEHIND' ? 503 : 200;

  return withCors(
    NextResponse.json(
      {
        status: report.status === 'BEHIND' ? 'degraded' : 'ok',
        schema: {
          status: report.status,
          pendingMigrations: report.pending,
          unknownMigrations: report.unknown,
        },
        // The explanation is safe to return: it names migrations, never data.
        ...(report.status !== 'CURRENT' ? { detail: explainDrift(report).trim() } : {}),
        ...(report.error ? { databaseReachable: false } : { databaseReachable: true }),
      },
      { status },
    ),
    request,
  );
}