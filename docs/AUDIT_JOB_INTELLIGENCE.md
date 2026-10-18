# Audit — AI Job Intelligence & Match Explanations

Pre-implementation audit of the existing job-scoring engine, preference model,
career-profile data, AI boundary, entitlements, usage accounting and job
workspace. Written before any code changed, so the "reuse, don't duplicate"
decisions below are traceable.

Base commit: `bd60a39` (merge of `feat/pro-resume-intelligence`).

## 1. Prerequisites

| Prerequisite | State |
| --- | --- |
| Monetization foundation | **Present on `main`.** Merged in PR #12. |
| Resume Intelligence & Career Profile | **Present on `main`.** Merged in PR #13. |
| Existing partial job-intelligence work | **None.** `rg -i "jobIntelligence\|AI_JOB_ANALYSIS\|matchExplanation"` across `src`, `prisma`, `tests`, `docs` returns nothing. |

So this branch builds directly on `main` with no unmerged dependency, and it
does not re-implement anything the previous two releases already ship.

## 2. Runtime baseline

Identical to the Resume Intelligence audit: Next.js `15.5.27` App Router,
React `19.0.0`, TypeScript `5.8.2` strict, Prisma `6.16.1` on PostgreSQL,
Zod `3.24.2`, `openai` SDK `7.38.0`, Node's built-in test runner via `tsx`.

## 3. The deterministic scoring engine — the source of truth

### `src/lib/scoring.ts`

`calculateFitScore(job, preferences)` is a pure function of a stored
`ScoreFields` object plus `UserPreferences`. It is not model-driven and this
release must not make it model-driven.

* Nine 0–5 sub-signals weighted by `weights` (coreStack 25, roleAlignment 17,
  seniorityFit 20, geographyEligibility 10, timezoneCompatibility 10,
  compensationFit 10, domainRelevance 5, applicationFriction 5,
  signalQuality 5).
* Two hard gates: `geographyEligibility === 0` or `timezoneCompatibility === 0`
  short-circuits to `0`. This is the existing "mandatory business constraint"
  the AI must never be able to talk around.
* Multiplicative penalties for seniority and role misalignment, plus
  `getPersonalizationModifier()`, which folds in title match, regions,
  timezones, must-have tech, remote-only and salary.
* `calculateFitTier()` maps the score to the **existing product vocabulary**:
  `A ≥ 80`, `B ≥ 65`, `C ≥ 50`, `D < 50`. The UI already renders these as
  "Strong Fit / Good Fit / Moderate / Stretch" in
  `src/components/dashboard/top-priority-list.tsx`.

**Decision:** the AI returns a *separate* qualitative category and is handed the
deterministic `fitScore` and `fitTier` as read-only inputs. It has no field in
its output schema for either value. `calculateFitScore` and `calculateFitTier`
are untouched.

### Title matching — the rule that must survive

`titleMatchesAny(title, values)` in `src/lib/preferences.ts` normalises both
sides to lowercase alphanumeric tokens and matches if either string contains
the other. `hasTitleMatch()` in `scoring.ts` unions
`targetRoles + preferredTitles` and is used by:

* `getPersonalizationModifier()` — a title match is worth `+0.08`, a miss
  costs `-0.28`.
* `hydrateJob()` — writes `score.titleMatch`, shown on the job detail page.

`inferScoreComponents()` in `src/lib/public-jobs.ts` sets
`roleAlignment = 4` on a title match and `2` otherwise, and is the only thing
that decides what a discovered job scores when it is imported.

**Routes that depend on `titleMatchesAny`** (checked exhaustively with `rg`):
`scoring.ts` (`hasTitleMatch`), `public-jobs.ts` (`inferScoreComponents`),
and transitively every consumer of `hydrateJob` / `buildStoredJobPayload`.

**Decision:** `titleMatchesAny` is **not modified**. The AI may *explain*
relatedness — distinguishing a direct target from an adjacent role — but the
title-fit dimension it returns is explicitly labelled advisory, and the
deterministic `titleMatch` boolean and `roleAlignment` sub-signal continue to
drive scoring and the dashboard. `inferScoreComponents` is not touched, so the
public job filter cannot be weakened.

**One defect found.** `titleMatchesAny` matches on substring containment in
either direction, so a bare target of `"engineer"` matches
`"Engineering Manager"`, and `"manager"` matches `"Senior Dev Manager"`. That
is a genuine false positive for the exact case this release is required to get
right (§7 of the brief: a similarly named managerial role must not match a user
seeking intermediate individual-contributor roles).

**Decision:** the fix is *additive and non-weakening* — a new exported
`classifyTitleRelationship()` in a new module provides structured
relatedness (direct / related / adjacent / weak / conflicting / insufficient)
for the AI to explain, and it refuses to call something a direct match when the
user's targets contain no leadership tokens but the job title does. The existing
`titleMatchesAny` boolean is left exactly as it is, because changing it would
alter existing scores for existing users. The relationship classifier only ever
*agrees or downgrades*, never upgrades, relative to the deterministic result.

## 4. Job model and ownership

`JobLead` is the only job entity. It is **always user-owned** (`userId`, no
nullable variant, cascade delete). There is no shared/global job table.

The "public" pool in `src/lib/public-jobs.ts` is therefore a *read view over
every user's `JobLead` rows*, and the save path is
`clonePublicJobForUser(sourceJobId, userId)`, which copies selected fields into
a new row owned by the saving user.

Consequences that shape this design:

1. **Analysis must attach to the caller's own `JobLead`.** A user must save a
   public job into their workspace before it can be analysed. That is exactly
   the existing product rule and this release preserves it.
2. **Nothing private crosses a user boundary.** The analysis reads the caller's
   own `JobLead` row only. The source owner's `contacts`, `interviews`,
   `checklist`, `prepPack` and `notes` are never read — the clone already
   carries a copy of the fields the public pool exposes, and the analysis runs
   on the clone.
3. **Soft deletes are respected.** Every read uses
   `{ id, userId, deletedAt: null }`.

### Job description

`JobLead.notes` is the only free-text field. It is **not** a reliable job
description: `extractJobFields()` writes auto-generated strings into it
(`"Detected stack: … | Eligibility clues: …"`), and users overwrite it freely.

**Decision:** add one additive nullable column, `JobLead.jobDescription`, and
populate it from the ingestion flow where a real description was supplied. A
minimal additive field is the honest answer here — inventing an extraction
adapter over `notes` would feed the model text we know is not a job posting.
Jobs with no description still analyse, on metadata alone, and say so.

The migration is `ADD COLUMN` only. No existing column changes meaning, no
existing row is rewritten, and `notes` keeps working exactly as before.

## 5. Career profile — what is available for personalization

From the merged Resume Intelligence release:

| Source | Table | Fields used |
| --- | --- | --- |
| Confirmed profile version | `UserProfile` | `careerProfileVersion`, `careerProfileConfirmedAt`, `headline`, `summary`, `location`, `remotePreference`, `phone` |
| Preferences | `UserProfile` | `targetRoles`, `preferredTitles`, `preferredStack`, `mustHaveTech`, `currentLevel`, `targetLevel`, `preferredRegions`, `workRegions`, `timezoneMatches`, `remoteOnly`, `salaryMin`, `salaryTarget`, `timezoneToleranceHours` |
| Skills | `CareerSkill` | `name`, `origin`, `confirmed` |
| Experience | `CareerExperience` | `jobTitle`, `company`, `technologies`, `responsibilities`, `evidenceSnippet` |
| Projects | `CareerProject` | `name`, `role`, `technologies`, `results` |
| Education / credentials | `CareerEducation`, `CareerCredential` | `qualification`, `fieldOfStudy`, `institution`, `name`, `kind` |

Fallback priority, in the order the brief requires:

1. User-confirmed structured career profile (`careerProfileConfirmedAt` set).
2. Explicitly saved work history and skills (the `Career*` rows exist even
   when never confirmed).
3. Relevant structured preferences (`UserProfile` list columns).
4. Verified scalars (`headline`, `summary`, `location`).

**Raw resume text is never re-parsed for job analysis.** The career profile is
already a structured, user-reviewed artefact; re-sending a whole resume for
every job would be both wasteful and a larger privacy exposure than the task
needs.

`UserProfile.email` is excluded — a job analysis has no need for it, and the
previous release already established that the address on a resume must never be
writable.

## 6. AI provider boundary

`src/lib/resume/ai-client.ts` already establishes the pattern this release
must follow rather than fork:

* one module knows OpenAI exists;
* `responses.parse()` + `zodTextFormat()` — confirmed against current OpenAI
  documentation as the schema-constrained mechanism for the Responses API;
* **no tools** — no function calling, no web search, no code interpreter;
* every response re-validated server-side with Zod regardless of what the
  provider guarantees;
* errors collapsed into a closed set of machine codes; provider messages,
  request ids and stack traces never reach the browser;
* `__setResumeAiProviderFactory()` seam so tests inject a fake and never touch
  the network.

**Decision:** a sibling `src/lib/job-intelligence/ai-client.ts` with its own
`JobIntelligenceAiProvider` interface and its own factory override. Reusing the
resume module's interface would force job analysis to import a resume-shaped
contract (`extract(resumeText)`), which is the wrong shape and would couple two
features that are otherwise independent. The SDK, the error mapping approach,
the timeout and the "no tools" rule are shared.

Model selection is independent: `JOB_INTELLIGENCE_MODEL`, defaulting to the
same `gpt-5.4-mini` the resume feature already uses, because a structured-output
model with strict schema adherence is exactly what this contract needs.

## 7. Entitlements, usage and limits — all already built

* `FEATURE_ENTITLEMENTS` already contains **`AI_JOB_ANALYSIS`**, mapped to
  `PRO`/`PREMIUM`, currently `released: false`. This release flips that one
  flag. No new feature key, no new plan, no new limit row.
* `requireEntitlement(userId, feature)` is the server gate.
* `consumeUsage(userId, feature, units, { limit, idempotencyKey })` is the
  meter — transaction-scoped advisory lock, `UsageRecord` table, no second
  credit system.
* `PLAN_LIMITS.aiCredits` is the shared AI budget across every AI capability.
* `applyRateLimit()` is the burst limiter.

## 8. Persistence

There is no existing analysis-of-a-job model to reuse — `ResumeExtraction` is
scoped to a resume document and its uniqueness key is `(resumeId, contentHash,
schemaVersion)`, neither of which applies here.

**Decision:** a new `JobIntelligenceAnalysis` model, deliberately shaped like
`ResumeExtraction` so the codebase stays consistent:

* `@@unique([userId, jobId, inputFingerprint, schemaVersion])` — simultaneously
  the cache key and the concurrency lock, exactly as the previous release
  argued for;
* `status`, `errorCode`, `provider`, `model` for traceability;
* `data Json` holding the verified structured output;
* cascade delete from both `User` and `JobLead`, so deleting a lead or an
  account removes the assessment.

The fingerprint is a SHA-256 over the normalised job fields, the career-profile
version, the relevant preference subset, the deterministic score inputs and the
contract versions — not over `updatedAt`, so an unrelated edit does not
invalidate a cached analysis, and not over the request, so it does not churn
per request.

## 9. Prompt injection surface

A job description is attacker-controlled text, exactly like a resume. The
system prompt states the same three defences the resume prompt uses: the
posting is data, the model has no tools, and nothing it returns is trusted. The
posting is fenced with markers chosen so the document is unlikely to contain
them.

Beyond that, two structural controls this release adds because the task is
riskier than resume parsing:

1. **The model cannot produce a score.** There is no numeric score field in the
   output schema.
2. **Deterministic facts are injected, not derived.** `geographyEligibility`,
   `timezoneCompatibility`, the salary arithmetic and the title relationship are
   computed server-side and passed in as read-only context. The model explains
   them; it cannot change them.

## 10. Files affected

**New**

```
prisma/migrations/2026XXXX_job_intelligence/migration.sql
docs/AUDIT_JOB_INTELLIGENCE.md
docs/JOB_INTELLIGENCE.md
src/lib/job-intelligence/limits.ts
src/lib/job-intelligence/title-fit.ts
src/lib/job-intelligence/dimensions.ts
src/lib/job-intelligence/schema.ts
src/lib/job-intelligence/profile-context.ts
src/lib/job-intelligence/prompt.ts
src/lib/job-intelligence/ai-client.ts
src/lib/job-intelligence/verify.ts
src/lib/job-intelligence/service.ts
src/lib/job-intelligence/route-errors.ts
src/app/api/jobs/[id]/intelligence/route.ts
src/components/jobs/job-intelligence-panel.tsx
tests/job-intelligence.test.ts
```

**Modified**

```
prisma/schema.prisma                     JobIntelligenceAnalysis + JobLead.jobDescription
src/lib/billing/plans.ts                 AI_JOB_ANALYSIS released: true
src/lib/job-schema.ts                    jobDescription on the payload
src/lib/db-helpers.ts                    map/build carry jobDescription
src/types/index.ts                       JobLead + JobFormValues jobDescription
src/app/api/jobs/route.ts                persist jobDescription
src/app/api/jobs/[id]/route.ts           persist jobDescription
src/components/jobs/job-form.tsx         description field
src/components/jobs/public-job-browser.tsx  nothing to change (clone path)
src/app/(app)/jobs/[id]/page.tsx         intelligence panel
src/app/(marketing)/jobs-public/...      untouched
.env.example                             JOB_INTELLIGENCE_MODEL
docs/ARCHITECTURE.md, docs/DEPLOYMENT.md, README.md
```

## 11. Out of scope (deliberately)

No resume optimisation, no cover letters, no interview generation. No
autonomous job-search agent: the analysis model receives no tools, cannot
apply to anything, cannot contact an employer, cannot write to the database and
cannot see another user's records. No URL fetching from the AI or the analysis
path — any future scraping needs separate SSRF-safe design. No change to
`titleMatchesAny`, `calculateFitScore`, `inferScoreComponents` or the public
job filter.