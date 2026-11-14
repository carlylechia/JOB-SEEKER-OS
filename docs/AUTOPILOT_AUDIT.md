# Intelligent Application Autopilot — Repository Audit

Release branch: `feat/intelligent-application-autopilot`
Base: `main` @ `b7dce63`

This document is the Phase 1 deliverable: what exists today, what is duplicated,
what is load-bearing, and what may be hidden or replaced. It is intentionally
written before any source change so the consolidation can be reviewed on its own.

---

## 1. Stack and conventions

- Next.js App Router, React 19, TypeScript strict mode.
- Prisma 6 / PostgreSQL, additive migrations only.
- Auth.js v5 (credentials + optional LinkedIn), server-side session checks.
- Zod for every request body and every model output.
- Node's built-in test runner (`tests/*.test.ts`), no paid provider calls.
- Tailwind design tokens in `tailwind.config.ts`; shared primitives in
  `src/components/ui`.
- Entitlements: `Plan → Subscription → Entitlements`, enforced with
  `requireEntitlement()` and metered through `UsageRecord`.

Baseline before changes:

| Check | Result |
| --- | --- |
| `npm run typecheck` | pass |
| `npm test` (local Postgres) | 791 pass / 0 fail |
| `npm run lint` | pass (checked during implementation) |

---

## 2. Current navigation and route inventory

Single navigation source: `src/components/layout/nav-items.ts`. It renders both
the desktop sidebar and the mobile menu, so hiding an item removes it everywhere.

Current destinations (16):

```
/dashboard          /jobs               /daily-jobs         /queue
/pipeline           /contacts           /interview-prep     /prep
/templates          /profile            /career-profile     /resumes
/application-materials                  /settings           /settings/billing
/admin (admin only)
```

Account actions live in the topbar, not the sidebar.

### Duplication found

| Concern | Surfaces today | Decision |
| --- | --- | --- |
| Daily action queue | `/dashboard` embeds `DailyQueue`; `/queue` is a second queue UI backed by the same `generateDailyQueue()` engine | Keep the engine. Make `/dashboard` the only queue surface; `/queue` redirects |
| Job discovery | `/jobs` (saved workspace), `/daily-jobs` (snapshots), `/job-discovery` API, public browsable catalog | Keep all engines. Present under one “Find Jobs” destination with sub-navigation; no duplicate scoring code |
| Application workspace | `/jobs/[id]`, `/pipeline`, `/application-materials/jobs/[jobId]` each show overlapping job context | Keep `/jobs/[id]` as the canonical workspace; pipeline becomes the Applications list; material workspace mounts inside the job workspace |
| Resume surfaces | `/resumes` (builder library), `/career-profile` (confirmed facts), `/application-materials` (writing), `/interview-prep` (prep) | Keep engines; group under Application Studio |
| Interview prep | Structured `InterviewPrepPack` engine plus legacy `JobLead.prepPack` JSON and `/prep` notes | Keep both data shapes; migrate the legacy notes into interview context, do not delete rows |
| Templates | `FollowUpTemplate` driving application materials; `/templates` page | Keep. Surface as a Studio module |
| AI model selection | One env var per feature, each read in its own client | Replace with a central registry; keep env names working |

No dead route trees were found. Every API route below has a caller or is a cron
entry point.

---

## 3. Data model map

41 models, 11 enums, 20 migrations. The load-bearing spine is:

```
User
 ├─ UserProfile ── CareerExperience / Education / Skill / Project / Credential
 ├─ ResumeDocument ── ResumeExtraction ── CareerRecordSource
 ├─ StructuredResume ── ResumeOptimization
 ├─ JobLead ── JobIntelligenceAnalysis
 │           ├─ StructuredResume (targetJob)
 │           ├─ InterviewPrepPack ── InterviewQuestion / ResearchSource / PrepTask / PracticeSession / Attempt
 │           ├─ ApplicationMaterial ── revisions
 │           └─ CareerAction
 ├─ Subscription ── Plan
 ├─ UsageRecord
 ├─ ExternalJob ── DailyJobRecommendation ── JobDiscoveryRun
 └─ JobSource / JobSourceHealth / JobCatalogSyncRun
```

Key invariants that must be preserved:

- A resume is never overwritten by a tailoring operation; variants are separate
  `StructuredResume` rows with `sourceResumeId` and `targetJobId`.
- `ResumeExtraction` and `JobIntelligenceAnalysis` uniqueness is both a cache key
  and a concurrency lock.
- `ApplicationMaterial` revisions are append-only: regeneration sets
  `supersedesId`, never mutates the reviewed draft.
- `UsageRecord` is the only AI credit ledger. No second ledger may be added.
- `Subscription.userId` is unique. Effective access is derived from timestamps.
- `JobLead.status` is the pipeline state. A submission record may be added
  beside it, never instead of it.

### Missing foundations for this release

- No durable, multi-task preparation workflow. Generation currently happens in
  one request per material.
- No first-class `Application` / `ApplicationAttempt` / `ApplicationEvent`
  records. Pipeline state is only `JobLead.status`.
- No automatic resume-source selection; the user chooses.
- No provider capability contract for application execution.
- Company research requires user-supplied URLs; there is no discovery layer.
- No evidence ingestion (email/ATS/webhook) for status detection.
- No automation preferences (pause, auto-prepare, auto-research).

These are added additively in the phases below.

---

## 4. AI surface inventory

| Feature | Model source today | Default |
| --- | --- | --- |
| Resume extraction | `RESUME_INTELLIGENCE_MODEL` | `gpt-4o-mini` |
| Job ingestion | `JOB_INGESTION_MODEL` | `gpt-4.1-mini` |
| Job intelligence | `JOB_INTELLIGENCE_MODEL` | `gpt-4.1-mini` |
| Resume optimization | `RESUME_OPTIMIZATION_MODEL` | `gpt-4.1-mini` |
| Application materials | `APPLICATION_MATERIALS_MODEL` | `gpt-4.1-mini` |
| Interview prep + feedback | `INTERVIEW_PREP_MODEL` | `gpt-4.1-mini` |
| Career coach | `CAREER_COACH_MODEL` | `gpt-4.1-mini` |
| Extension screening answers | `AI_AUTOFILL_MODEL` → `RESUME_OPTIMIZATION_MODEL` | `gpt-4.1-mini` |

Each client independently reads `OPENAI_API_KEY`, constructs an OpenAI client,
implements its own timeout, and reports its own model string. There is no shared
retry policy, fallback behaviour, or usage metric keyed by task.

Phase 4 introduces `src/lib/ai/model-registry.ts` as the single read point while
keeping every existing env var valid.

---

## 5. Security controls already present

- Server-side auth on every app and API route; ownership-scoped queries.
- Zod request schemas and structured error payloads.
- Rate limiting on mutating routes (`src/lib/rate-limit.ts`).
- SSRF-hardened URL fetching for interview research
  (`src/lib/interview-prep/research.ts`) with DNS and redirect validation.
- Private, no-store responses for sensitive endpoints.
- Upload magic-byte sniffing and authenticated blob serving.
- Cron endpoints fail closed behind `CRON_SECRET`.
- Webhook-style provider calls always executed server-side.
- Model output is validated and re-checked against real profile/job facts before
  persistence (`verify.ts` in each AI feature).

New work must reuse these modules rather than reimplementing them.

---

## 6. Browser extension audit

Files: `extension/manifest.json`, `content/content.js`,
`background/service-worker.js`, `popup/*`.

Findings:

1. **`location` shadowing bug.** Every scraper declares
   `const location = document.querySelector(...)`, then returns
   `url: location.href`. `location` is a string at that point, so the returned
   URL is `undefined`. This is the documented bug and is fixed in Phase 6.
2. Auto-fill sends every empty text field to the AI endpoint, including fields
   that may be legal declarations or sensitive questions. This violates the
   release rule that unknown/sensitive questions must never be auto-answered.
3. No submission detection, no evidence boundary, no explicit approval step.
4. `chrome.storage.sync` stores only the app URL and API token; no employer
   credentials are stored. Keep it that way.

Phase 6 fixes (1) and (2) and adds a conservative field-classification boundary.
Full ATS submission providers remain a later phase because each requires
employer credentials or a documented public submission API.

---

## 7. Dependency map before removal

Nothing is deleted in Phase 2. Hidden navigation entries keep their routes,
API handlers, services and tests. Removal is only allowed after:

1. `grep` shows no component, route or test consumer.
2. The replacement path has equivalent functionality.
3. A migration/redirect preserves in-flight user data.

Specific dependencies to respect:

- `/queue` UI → `generateDailyQueue()` → `JobLead` + `mapDbJob`.
- `/daily-jobs` → `DailyJobRecommendation` + `JobDiscoveryRun` snapshots.
- `/pipeline` → `JobLead.status` + `mapDbJob` + status API.
- `/application-materials` → `ApplicationMaterial` + generation service +
  export renderers + template relations.
- `/interview-prep` → `InterviewPrepPack` graph + research fetcher.
- `/prep` → `JobLead.prepPack` JSON only. Must not be deleted while rows exist.

---

## 8. Phase plan adopted

| Phase | Scope in this branch |
| --- | --- |
| 1 | This audit |
| 2 | Five-destination navigation, `/studio` hub, queue consolidation, legacy compatibility |
| 3 | Durable preparation runs/tasks, planning engine, executors, APIs, job-workspace UI |
| 4 | Central AI model registry, provider timeouts/retries, deterministic quality report |
| 5 | Additive application lifecycle entities and transition rules |
| 6 | Extension URL bug, sensitive-field guard, approval boundary |
| 7–10 | Designed but not claimed complete in this branch; see final report |

Every phase is validated with typecheck, lint, targeted tests, and the full
suite before moving on.
