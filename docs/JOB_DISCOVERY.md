# Intelligent Daily Job Discovery

## Overview

teChia Jobs discovers, normalizes, ranks and persists a daily shortlist of up to five job opportunities for eligible Pro/Premium users. Five is a ceiling, not a promise: the system does not pad a shortlist with unrelated or stale vacancies when the free sources do not return enough eligible jobs.

## Sources implemented

Free (no credentials required):
- Remotive (free aggregator) — enabled by default; disable with `REMOTIVE_ENABLED=false`.
- Arbeitnow (free aggregator) — enabled by default; disable with `ARBEITNOW_ENABLED=false`.

Optional paid/credentialed:
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
- Scoring and explanations: `scoring.ts` (reuses the shared weighted fit model in `src/lib/scoring.ts`)
- Ranking diversity: `ranking.ts`
- Daily runs: `service.ts`
- Source health: `source-health.ts`

## Matching approach

- Search from up to four selected target titles; if none are set, use the profile headline or a compact skill query.
- Score against actual posting text and the saved role, skills, seniority, remote/location and salary preferences.
- Keep listings last seen in the shared source index within seven days; ignore dated listings older than 30 days.
- Deduplicate across sources, cap repeated employers and titles where there are alternatives, and explain matched skills and missing posting details.
- A saved job is not recommended again; a recent “Not for me” dismissal is also suppressed. Silence and clicks are not treated as negative feedback.
- The process is deterministic and uses no paid AI or recommendation API. No protected or sensitive personal traits are used for ranking.

## Research notes

Leading products publicly describe personalization based on profile information, preferences and activity, but do not disclose the exact job-ranking weights or freshness/diversity rules. LinkedIn says it uses member-provided information and engagement to personalize recommendations; Glassdoor describes using profile and job-search activity for personalized job recommendations. Indeed documents testing technology for accuracy and fairness, not its recommendation formula.

- [LinkedIn Privacy Policy](https://www.linkedin.com/legal/privacy-policy)
- [Glassdoor Privacy Policy](https://hrtechprivacy.com/brands/glassdoor#privacypolicy)
- [Indeed Privacy Policy](https://hrtechprivacy.com/brands/indeed#privacypolicy)

The practical product pattern adopted here is transparent, preference-based ranking plus explicit save/dismiss signals, fresh source data, and diverse results. These are our implementation choices, not claims about competitors’ internal algorithms.

## Scheduling

- Cron endpoint: `/api/cron/job-discovery` (secured by `CRON_SECRET`).
- Vercel cron configured in `vercel.json`.
- Each cron invocation handles up to 20 eligible users, ordered by the fewest prior discovery runs, so a fixed first batch cannot permanently monopolize the daily run.
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
- Only up to five matches are returned. Free feeds have no availability or relevance SLA; guaranteeing five quality matches for every user/day would require broader licensed inventory or knowingly weakening the relevance bar.
- With more than 20 eligible users, a single daily cron invocation cannot process everyone that day. Increase invocation frequency or move to a durable, rate-limited queue before advertising per-user daily delivery at that scale.
- Brave results are search results, not verified vacancies.
- Connectors requiring credentials remain disabled until configured.
EOF
echo done