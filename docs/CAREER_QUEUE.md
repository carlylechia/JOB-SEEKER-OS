# AI Career Queue & Career Coach

## Overview

The Career Queue converts a user's job-search state into prioritized, actionable
items. Deterministic rules decide eligibility and urgency; AI provides optional
explanations and coaching.

## Architecture

- `src/lib/career-queue/types.ts` — shared types.
- `src/lib/career-queue/prioritization.ts` — deterministic candidate generation.
- `src/lib/career-queue/service.ts` — persistence, reconciliation, state transitions.
- `src/lib/career-queue/coach.ts` — AI career coach.
- `src/lib/career-queue/weekly-review.ts` — weekly review metrics.

## API

- `GET/POST /api/career-actions`
- `GET/PATCH/DELETE /api/career-actions/[id]`
- `POST /api/career-coach`
- `GET /api/career-review`

## Entitlements

- `AI_CAREER_COACH` (Pro/Premium)
- `AI_DAILY_ACTION_PLAN` (all plans)
- `AI_WEEKLY_CAREER_REVIEW` (Pro/Premium)

## Migration

`prisma/migrations/20261020111856_add_career_actions`

## Tests

`npm test` includes `tests/career-queue.test.ts`.
