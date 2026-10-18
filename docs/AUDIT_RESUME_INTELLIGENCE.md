# Audit — Resume Intelligence & Career Profile

Pre-implementation audit of the existing resume, profile, AI, storage, billing
and observability infrastructure. Written before any code changed, so the
"reuse, don't duplicate" decisions below are traceable.

Base commit: `22456ea` (merge of `feat/techia-jobs-monetization-foundation`).

## 1. Runtime baseline

| Concern | Finding |
| --- | --- |
| Framework | Next.js `15.5.27`, App Router, React `19.0.0` |
| Language | TypeScript `5.8.2`, `strict` (see `tsconfig.json`) |
| Package manager | npm (`package-lock.json` committed) |
| Data layer | Prisma `6.16.1` against PostgreSQL |
| Validation | Zod `3.24.2` (already a dependency) |
| Tests | Node's built-in runner (`node:test`) via `tsx`, custom `expect` in `tests/harness.ts` |
| E2E | **None installed.** No Playwright / Webdriver config exists. |
| Deployment | Vercel (`vercel.json`), one cron (`/api/cron/maintenance`), `build:vercel` runs `prisma generate` first |
| Runtime constraints | Vercel serverless functions — bounded execution time, no long-lived workers |

## 2. What already existed (reuse, do not replace)

### Resume handling — partial, and weaker than it looks

* `src/app/api/resume/parse/route.ts` — the **only** upload endpoint. Accepts a
  multipart `resume` field, validates `file.type` against a hardcoded MIME set,
  enforces a hardcoded `MAX_FILE_SIZE`, then stores and returns a best-effort
  `extracted` object.
* `src/lib/resume.ts` — **not a real parser.** `extractResumeProfile()` calls
  `file.text()` (which returns mojibake for binary PDF/DOCX), then slices the
  first 160/500 characters as "headline"/"summary" and matches a hardcoded list
  of ~13 skill strings and ~8 job titles against the raw text. There is no PDF
  or DOCX parsing anywhere in the repository.
* `src/lib/durable-upload.ts` — stores resumes as **private** Vercel blobs
  (`resumes/<userId>/<ts>-<name>.<ext>`), with a local `public/uploads/resumes`
  fallback for development. Already handles filename sanitisation and deletion
  of the replaced asset.
* `src/app/api/resume/file/route.ts` — authenticated, ownership-scoped download.
  Correctly derives the caller's own profile; there is no `userId` parameter to
  forge.
* Storage decision already made and documented: **private blobs**, streamed
  through an authorised route. This release must not weaken it.

Gaps that matter:

1. No text extraction — PDF/DOCX were never actually parsed.
2. No magic-byte validation. `Content-Type` is attacker-controlled and was the
   *only* format check.
3. No central limits module. `5 * 1024 * 1024` appears in the route, again in
   `src/app/(app)/profile/page.tsx`, and again (as `MAX_SIZE`) in
   `src/components/onboarding/step-resume.tsx`.
4. No resumable/structured career data anywhere in the schema.
5. No record of *which* resume an extraction came from, because there is no
   `Resume` entity at all — only `UserProfile.resumeUrl`, a single URL string.

### Resume limits vs. plan configuration

`PLAN_LIMITS` in `src/lib/billing/plans.ts` already declares a `resumes` limit
(Free 1 / Pro 5 / Premium 10), so multiple resumes per user are the intended
product shape — the schema just never caught up. `aiCredits` (Free 25 / Pro and
Premium unlimited) already exists as the metered AI budget and is the correct
meter for a new AI capability.

### Entitlement and usage — production quality, fully reusable

* `src/lib/billing/subscriptions.ts` — `getEffectiveSubscription()` derives
  access from **timestamps**, never from a trusted `status`. Admin exemption is
  built in. Trial expiry is computed from real dates.
* `requireEntitlement(userId, feature)` — throws `PlanRequiredError` (403).
  Intended to be called immediately before any expensive provider call.
* `src/lib/billing/usage.ts` — `consumeUsage()` uses a PostgreSQL
  **transaction-scoped advisory lock** keyed on (user, feature, period), so
  parallel requests serialise. It also supports an **idempotency key** that
  prevents double-charging a retried request. This is exactly the primitive
  this feature needs; no new usage table is warranted.
* `src/lib/billing/plans.ts` — `FEATURE_KEYS` / `FEATURE_ENTITLEMENTS` is the
  centralised capability registry. `released: false` means "defined, not
  shipped yet".

### AI provider — none configured

There is **no AI SDK, no provider client, and no AI environment variable** in
the repository. `src/lib/queue-ai.ts` is explicitly deterministic and carries an
`// [AI-READY]` comment describing where a provider call would slot in.

Consequently there is no "existing AI abstraction" to reuse. The first provider
integration has to be introduced — but it must be built as a thin, injectable,
server-only boundary so the next AI feature shares it rather than forking it.

### Storage of private files

`isPrivateResumeUrl()` distinguishes token-gated private blobs from legacy public
uploads. Legacy public resume URLs are redirected rather than proxied so old
accounts are not locked out — this behaviour must be preserved.

### Observability

`src/lib/observability.ts` — `logImportantInfo()` (console) and
`logImportantError()` (console **plus** Discord webhook via
`ALERT_WEBHOOK_URL`, error level only). Discord alerts therefore already only
fire on errors, which satisfies "do not alert on every success".

### Error and response conventions

`src/lib/api.ts` — `ApiErrorCode` union, `apiError()` structured envelope
(`{ error: { code, message, ...safeMeta } }`), `privateNoStore()`, and
`handleRoute()`. Status mapping already includes `PLAN_REQUIRED`,
`USAGE_LIMIT_EXCEEDED`, `RATE_LIMITED`, `CONFLICT`.

Note: `ApiErrorCode` has no `PAYLOAD_TOO_LARGE` or `UNSUPPORTED_MEDIA_TYPE`
member, so those two statuses have to be added rather than smuggled in as a
generic 400.

### Authorisation primitives

`src/lib/authz.ts` — `getCurrentUser()` re-reads `role` from the database on
every call (never from JWT claims). `requireEntitlement()` is the server-side
gate; the UI gate in `PlanRequiredCard` is explicitly documented as cosmetic.

### Rate limiting

`src/lib/rate-limit.ts` — in-memory `Map` bucket, per key, per window. Used by
`/api/profile` as `profile:update:<userId>:<ip>`, 20 req/min.

### Design system

`tailwind.config.ts` + `globals.css` — gold `#D4AF37` accent, silver `#C9CED6`,
charcoal `#17191E`, warm white `#FAFAF7`. Component classes `.card-pad`,
`.btn-primary`, `.btn-secondary`, `.input`, `.title`, `.muted`,
`.table-wrap`, `.table`. `prefers-reduced-motion` already handled in
`globals.css`. No second component library exists and none should be added.

## 3. What this release must add

| Area | Decision |
| --- | --- |
| Resume entity | New `ResumeDocument` rows, so an extraction can be tied to a specific stored file rather than to "whatever is in `resumeUrl` now". `UserProfile.resumeUrl` is kept as the primary pointer so download/onboarding/profile flows keep working unchanged. Backfilled from existing `resumeUrl` values. |
| Career data | Relational `CareerExperience` / `CareerEducation` / `CareerSkill` / `CareerProject` / `CareerCredential` models. Core relationships and searchable fields stay relational; the *pre-confirmation draft* is JSON on `ResumeExtraction` because it is versioned, throwaway-shaped data. |
| Extraction run | `ResumeExtraction` with `PENDING/PROCESSING/COMPLETED/FAILED`, `contentHash`, `schemaVersion`. Unique on `(resumeId, contentHash, schemaVersion)` so the row is both the dedupe key **and** the concurrency lock. |
| Entitlements | Two new keys in the existing registry: `AI_RESUME_PARSER` and `CAREER_PROFILE_INTELLIGENCE`, both Pro+. No parallel plan-checking logic. |
| Usage | `consumeUsage(..., 'AI_RESUME_PARSER', 1, { limit: entitlements.limits.aiCredits, idempotencyKey })`. Existing table, existing lock, existing metering. |
| Limits | New `src/lib/resume/limits.ts` — single source for size/char/page/timeout limits, replacing the three duplicated 5 MB constants. |
| Extraction | `src/lib/resume/extract-text.ts` — magic-byte sniffing + `unpdf` (PDF), `mammoth` (DOCX), UTF-8 validation (TXT). No OCR; image-only PDFs are detected and reported honestly. |
| AI | `src/lib/resume/ai-client.ts` — thin, injectable wrapper over the official `openai` SDK using schema-constrained `responses.parse()` with `zodTextFormat`. Tests inject a fake. |
| UI | New `/career-profile` review route, linked from the existing Profile resume section, the onboarding resume step and the sidebar. Onboarding stays optional and non-blocking. |

## 4. Files affected

**New**

```
prisma/migrations/2026XXXX_resume_intelligence/migration.sql
docs/RESUME_INTELLIGENCE.md
src/lib/resume/limits.ts
src/lib/resume/extract-text.ts
src/lib/resume/schema.ts
src/lib/resume/prompt.ts
src/lib/resume/ai-client.ts
src/lib/resume/documents.ts
src/lib/resume/service.ts
src/lib/resume/career-profile.ts
src/app/api/resume/intelligence/route.ts
src/app/api/resume/intelligence/[extractionId]/route.ts
src/app/api/resume/intelligence/[extractionId]/apply/route.ts
src/app/(app)/career-profile/page.tsx
src/components/resume/career-profile-review.tsx
src/components/resume/resume-analysis-cta.tsx
tests/resume-extraction.test.ts
tests/resume-intelligence.test.ts
```

**Modified**

```
prisma/schema.prisma              new models + additive UserProfile columns
src/lib/billing/plans.ts          two feature keys
src/lib/api.ts                    PAYLOAD_TOO_LARGE, UNSUPPORTED_MEDIA_TYPE
src/app/(app)/profile/page.tsx    analysis CTA, shared limit constants
src/components/onboarding/step-resume.tsx   shared limits + link to review
src/components/layout/sidebar-nav.tsx       career profile destination
src/components/layout/topbar-mobile-menu.tsx mobile destination
.env.example                      OPENAI_API_KEY, RESUME_INTELLIGENCE_MODEL
README.md / docs/DEPLOYMENT.md    configuration + runbook
```

## 5. Out of scope (deliberately)

No visual resume editor, no job-specific rewriting, no cover letters, no
interview generation, no new scoring engine, no new billing or auth provider,
no new AI microservice, no OCR.