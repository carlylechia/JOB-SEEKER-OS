# teChia Jobs — Interview Intelligence & Preparation Packs: Phase 0 Audit

Branch: `feat/pro-interview-intelligence` (created from `main` @ `5809932`, release 4).
Release 5 (AI cover letters / application materials) exists on
`origin/feat/pro-ai-application-materials` but is **not merged into main**, so this
release does not depend on it. All foundations interview prep needs already exist
on `main`.

## Stack (confirmed in repository)
- Next.js 15.5.27, React 19, App Router, Prisma 6.16.1, Postgres
- OpenAI SDK v7 (`responses.parse` + `zodTextFormat` structured outputs, no tools)
- Auth.js v5 (next-auth) credentials + LinkedIn, JWT session
- zod validation, Node built-in `node:test` runner with a custom `expect` harness
  (`tests/harness.ts`), tests at `tests/*.test.ts`, run via `npm test`
- Integration tests need a local/test Postgres (`TEST_DATABASE_URL`)

## Existing Prep Packs (reuse, do not duplicate)
- `JobLead.prepPack` is a `Json` column holding free-form text:
  `whyThisRole`, `topFitPoints`, `likelyQuestions`, `questionsToAsk`,
  `questionsToAsk`, `technicalFocus`, `companyResearchLinks`, `prepScore`,
  `prepStatus` (`NOT_STARTED | IN_PROGRESS | READY`). Type: `src/types/index.ts`
  `PrepPack`.
- UI: `src/app/(app)/prep/page.tsx` — per-job prep cards, sidebar nav entry
  "Prep Packs" → `/prep`.
- API: `PATCH /api/jobs/[id]/prep` (session-scoped, ownership via `userId`,
  zod validation, `prep_pack_updated` / `prep_pack_update_failed` observability,
  `privateNoStore`).
- Job detail page `src/app/(app)/jobs/[id]/page.tsx` shows a prep-pack summary
  linking to `/prep`.
- `JobLead.interviews` (`Json`, `Interview[]`) and `JobLead.contacts` (`Json`)
  hold known interview stage and recruiter contacts — inputs for context selection.
- Queue: `generateDailyQueue` (`src/lib/queue-engine.ts`) already emits a
  `prep` task (priority 90) for `INTERVIEWING` jobs; dedupe key `jobId::prep`.
  Client `use-job-data` mirrors this with `type: 'PREPARE'`. No persistent queue
  table — queue tasks are derived views, so no parallel task system should be built.

## Monetization & entitlements (authoritative, reuse)
- `src/lib/billing/plans.ts`: feature keys `AI_INTERVIEW_PREP` (Pro/Premium) and
  `ADVANCED_PREPARATION` (Premium) already exist, both `released: false`. Plan
  limits `aiCredits`: FREE 25, PRO/PREMIUM unlimited — one shared AI allowance.
- `src/lib/billing/subscriptions.ts`: `getEffectiveSubscription`,
  `buildEntitlements`, `requireEntitlement(userId, feature)` (throws
  `PlanRequiredError` 403), `getEntitlements`, admin exemption, timestamp-derived
  expiry (expired trials fail closed).
- `src/lib/billing/usage.ts`: `consumeUsage(userId, feature, units,
  {limit, idempotencyKey})` — atomic under a PG advisory lock, idempotency key
  prevents double-charging, throws `UsageLimitExceededError` (403).
- `src/lib/billing/plans.ts` `FEATURE_ENTITLEMENTS` is the registry; do not add
  redundant keys. Use `AI_INTERVIEW_PREP` for pack generation and feedback.

## AI provider pattern (reuse exactly, do not add a second framework)
Per-feature module under `src/lib/<feature>/`:
- `ai-client.ts` — OpenAI provider, feature-specific error class, factory with
  `__setXxxAiProviderFactory` test seam, no tools, structured outputs via
  `zodTextFormat`, server-side re-validation.
- `schema.ts` — versioned strict zod contract, `*_SCHEMA_VERSION`, prompt version.
- `limits.ts` — char ceilings, timeout, floors.
- `prompt.ts` — system prompt treating third-party text as untrusted data,
  fenced user message, privacy notice.
- `verify.ts` — pure server-side re-verification (excerpts re-quoted against
  source text, capability claims re-checked against profile, no unsupportable
  claims).
- `service.ts` — orchestration: authenticate → entitlement → resolve job →
  fingerprint → duplicate suppression (unique index lock) → consume usage →
  provider → verify → persist. No provider call inside a transaction.
- `route-errors.ts` — map domain errors to `{error: {code, message}}` envelopes.
- Route: `auth()` session, ownership-scoped `findFirst({id, userId})`,
  `applyRateLimit`, `handleRoute`, `privateNoStore`, `apiError`.

## Security & privacy conventions
- Never accept a client `userId`; always derive from `auth()` session.
- Ownership-scoped queries return 404 (not 403) for another user's records.
- `logImportantError` sends to Discord only at `error` level; never log full
  answers/resumes/prompts.
- `sanitizeText` (`src/lib/sanitize.ts`) for stored text.

## What does NOT exist yet (this release builds it)
- Structured interview questions tied to a pack; question versions; practice
  attempts; answer feedback; rubric-based evaluation; preparation progress;
  pack staleness/fingerprinting; AI-gated interview prep entitlement enforcement
  (`AI_INTERVIEW_PREP` is defined but `released: false` and not wired anywhere).

## Release-4 baseline intact
Job CRUD/detail workspace, public job import, pipeline, contacts, checklist,
resume documents + extractions, career profile, structured resumes + resume
builder, job intelligence (AI_JOB_ANALYSIS), cover-letter release not merged.
All must keep working after this release.
