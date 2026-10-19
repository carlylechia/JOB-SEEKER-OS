# teChia Jobs — Cover Letters & Application Materials: Phase 0 Audit

Branch: `feat/pro-ai-cover-letters` (created from `main` @ `5809932`, release 4 — Resume Builder).

## Critical finding: cover letters do NOT exist yet in `main`

Despite the release-5 name in the roadmap, `main` is at release 4. There is **no**
`ApplicationMaterial` / `CoverLetter` model, no `src/app/(app)/application-materials`
page, no cover-letter API route, and no generation service.

The entitlement registry (`src/lib/billing/plans.ts`) defines
`AI_COVER_LETTER` (Pro/Premium) with `released: false` and the description
"Draft tailored cover letters for each application." Everything else referenced
under "cover letter" is incidental:

- `JobLead.checklist.coverLetterReady` — a boolean checklist item on the job page
- `src/lib/billing/plans.ts` — the unreleased feature key
- `src/lib/queue-ai.ts` — queue task copy mentioning cover letters
- `src/lib/resume/ai-client.ts` — resume *extraction* (not cover letters)

So this release must BUILD the cover letter feature from scratch, following the
established per-feature AI pattern. It must not import assumptions from an
unavailable release-5 implementation.

## Stack (confirmed in repository)
- Next.js 15.5.27, React 19, App Router, Prisma 6.16.1, Postgres
- OpenAI SDK v7 (`responses.parse` + `zodTextFormat` structured outputs, no tools)
- Auth.js v5 (credentials + LinkedIn), JWT session
- zod validation, Node built-in `node:test` runner + custom `expect` harness
  (`tests/harness.ts`), tests at `tests/*.test.ts`, run via `npm test`
- Integration tests need a local/test Postgres (`TEST_DATABASE_URL`)

## Existing foundations to reuse (do not duplicate)
- `JobLead` — the target job (title, company, jobDescription, location, etc.)
- `UserProfile` + career tables (`CareerExperience`, `CareerProject`,
  `CareerSkill`, `CareerCredential`) — the candidate's verified history
- `StructuredResume` — a tailored resume targeted at a job (`targetJobId`)
- `JobIntelligenceAnalysis` — existing AI job-fit result, reusable as context
- `buildProfileContext` (`src/lib/job-intelligence/profile-context.ts`) —
  bounded career-profile context sent to the provider (raw resume never sent)
- `buildDeterministicInputs` + `buildDeterministicBlock` — fit score/tier and
  job facts as settled, re-applied context
- Entitlement + usage: `requireEntitlement`, `consumeUsage` (advisory lock +
  idempotency key), `getEffectiveSubscription`, admin exemption, `aiCredits`
  shared budget (FREE 25, PRO/PREMIUM unlimited)
- Prisma conventions: soft-delete via `deletedAt` on `JobLead`; relation
  cascades; unique indexes as concurrency locks
- UI: gold/silver/charcoal design system, `PageHeader`, `btn-primary`,
  `btn-secondary`, `input`, `badge`; no blue dominant accent

## AI provider pattern (reuse exactly, do not add a second framework)
Per-feature module under `src/lib/<feature>/`:
- `ai-client.ts` — OpenAI provider, feature-specific error class, factory with
  `__setXxxAiProviderFactory` test seam, no tools, structured outputs via
  `zodTextFormat`, server-side re-validation
- `schema.ts` — versioned strict zod contract, `*_SCHEMA_VERSION`, prompt version
- `limits.ts` — char ceilings, timeout, floors
- `prompt.ts` — system prompt treating third-party text as untrusted data,
  fenced user message, privacy notice
- `verify.ts` — pure server-side re-verification (excerpts re-quoted against
  source text, capability claims re-checked against profile, no unsupportable
  claims)
- `service.ts` — orchestration: authenticate → entitlement → resolve job →
  profile/preferences/resume → fingerprint → duplicate suppression (unique index
  lock) → consume usage → provider → verify → persist. No provider call inside a
  transaction.
- `route-errors.ts` — map domain errors to `{error: {code, message}}` envelopes
- Route: `auth()` session, ownership-scoped `findFirst({id, userId})`,
  `applyRateLimit`, `handleRoute`, `privateNoStore`, `apiError`

## AI model situation (quality review)
| Feature | Model | Basis |
|---|---|---|
| Resume extraction | `gpt-4o-mini` | Chosen by benchmarking: 18/18 accurate, cheapest |
| Resume optimization | `gpt-4.1-mini` | Quality model; output read by a person sending to an employer |
| Job intelligence | `gpt-4.1-mini` | Quality model; drives a real career decision |
| Interview prep | `gpt-4.1-mini` | Quality model (this branch) |

**Cover letters need persuasive, tailored, truthful writing** — this is the
output a user actually sends to an employer, so it deserves the quality model
(`gpt-4.1-mini`, consistent with optimization and job intelligence), NOT the
cheapest extraction model. Configurable via `COVER_LETTER_MODEL` (read in one
place). Do not use `gpt-4o-mini` for cover-letter generation: extraction
accuracy ≠ persuasive writing quality.

## What does NOT exist yet (this release builds it)
- `CoverLetter` / `ApplicationMaterial` data model
- Cover-letter generation service (entitlement → fingerprint → usage → provider → verify → persist)
- Cover-letter prompts (system prompt focused on persuasive, truthful, tailored writing)
- Cover-letter verification (anti-hallucination: no invented companies, metrics, or claims)
- Cover-letter API routes (generate, get, edit, list, delete)
- Cover-letter UI (generate, edit, preview, save)
- Entitlement flip: `AI_COVER_LETTER` `released: false` → `true`

## Release-4 baseline intact
Job CRUD/detail workspace, public job import, pipeline, contacts, checklist,
resume documents + extractions, career profile, structured resumes + resume
builder, job intelligence (AI_JOB_ANALYSIS), interview prep (separate branch).
All must keep working after this release.

## Quality bar for this release
A cover letter is "worth paying for" only when it is:
- Specific to the actual job (not a template with [Company] swapped in)
- Grounded in the user's real experience (no fabricated companies, metrics, roles)
- Persuasive and concise (one page, strong opening, evidence-backed claims)
- Honest about gaps (flags missing info as questions for the user, never invents)
- Editable by the user before sending (the model proposes, the person decides)
