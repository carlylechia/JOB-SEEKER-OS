# Intelligent Daily Job Discovery

## Overview

teChia Jobs discovers, normalizes, ranks and persists a daily shortlist of up to 5 job opportunities for eligible Pro/Premium users.

## Sources implemented

- Adzuna (aggregator API) — requires `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, optional `ADZUNA_COUNTRY`, `ADZUNA_ENABLED`.
- Brave Search (web search) — requires `BRAVE_SEARCH_API_KEY`, optional `BRAVE_SEARCH_ENABLED`.
- Greenhouse (public boards) — requires `GREENHOUSE_BOARD_TOKENS` (comma-separated), optional `GREENHOUSE_ENABLED`.
- Lever (public postings) — requires `LEVER_SITES` (comma-separated), optional `LEVER_ENABLED`.

Missing credentials mark the connector `NOT_CONFIGURED`; other connectors continue.

## Architecture

- Connectors: `src/lib/job-discovery/connectors/*`
- Registry: `src/lib/job-discovery/registry.ts`
- Normalization/dedupe: `normalize.ts`, `dedupe.ts`
- Search planning: `search-plan.ts`
- Scoring: `scoring.ts` (reuses `src/lib/scoring.ts`)
- Daily runs: `service.ts`
- Source health: `source-health.ts`

## Scheduling

- Cron endpoint: `/api/cron/job-discovery` (secured by `CRON_SECRET`).
- Vercel cron configured in `vercel.json`.
- Manual refresh: `POST /api/job-discovery/run` with 6-hour cooldown.

## Database

Migration `20261026054013_job_discovery_foundation` adds `ExternalJob`, `JobDiscoveryRun`, `DailyJobRecommendation`, `JobSourceHealth`.

## Security

- All private endpoints require authentication and `DAILY_JOB_DISCOVERY` entitlement.
- Cron endpoints fail closed without `CRON_SECRET`.
- URLs validated via `isSafeExternalUrl`.
- No client-supplied userId/plan accepted.

## Limitations

- No claim of complete internet coverage.
- Brave results are search results, not verified vacancies.
- Connectors requiring credentials remain disabled until configured.
EOF
echo done