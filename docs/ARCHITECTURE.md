# Monetization Architecture — teChia Jobs

A teChia Digital Solutions product.

This document explains the commercial infrastructure behind teChia Jobs for
another senior engineer. It covers the decisions, the guarantees, and the
things that will bite you if you change them carelessly.

---

## 1. Source-of-truth hierarchy

```
Database
  ↓
Subscription service      (src/lib/billing/subscriptions.ts)
  ↓
Effective plan            resolved from real timestamps, never trusted blindly
  ↓
Entitlements              (src/lib/billing/plans.ts)
  ↓
Feature access            server-enforced via requireEntitlement()
```

Client-side state is presentation only. No page, component, or route decides
access; they all ask the server.

---

## 2. Subscription architecture

**One current access record per user.** `Subscription.userId` is `UNIQUE`, so
two competing subscriptions cannot exist and create ambiguous entitlements.
This is enforced by the database, not just application code.

`Subscription` holds:

| Field | Purpose |
|---|---|
| `planId` | FK to `Plan` |
| `status` | `TRIALING \| ACTIVE \| EXPIRED \| CANCELLED \| SUSPENDED` |
| `startsAt` / `endsAt` | Paid access window |
| `trialStartsAt` / `trialEndsAt` | Trial window |
| `source` | `TRIAL \| ADMIN_MANUAL \| FUTURE_BILLING \| SYSTEM` |
| `billingProvider` | Provider-neutral; NULL today |
| `externalCustomerId` / `externalSubscriptionId` | Provider-neutral; NULL today |

**Stable codes, not display names.** `FREE`, `PRO`, `PREMIUM` are the business
identifiers. Display names live in the `Plan` table and can change freely
without touching a single subscription.

**Money is integer minor units.** `monthlyPrice` / `yearlyPrice` are `Int`
(cents), never floats. `NULL` means pricing is undecided and the UI renders
"Contact us" rather than inventing a number.

### Why the status column is never trusted

A row saying `ACTIVE` with `endsAt < now()` is **expired**. `resolveFromRecord()`
in `subscriptions.ts` derives the effective state from timestamps, not from the
stored status.

This matters because the nightly cron reconciles records and sends
notifications — it is **not** the security boundary. If a trial expires at
10:00, the user loses Pro access at 10:00 whether or not the cron has run.

---

## 3. Trial semantics

### Deterministic launch

Every existing user receives the **same** 14-day Pro trial, anchored to a
single immutable timestamp stored in `MonetizationConfig.existingUserTrialStartedAt`.

The trial deliberately does **not** start on first login, first dashboard
visit, onboarding completion, email verification, or migration time. Those are
all per-user signals; using any of them would produce a different trial window
per user and make the launch date meaningless.

Re-running initialization never moves the window. If a correction is genuinely
needed, that is an explicit audited admin action, not a re-run.

### New users

Users registering after activation get a trial starting at account creation,
exactly 14 days later, in UTC. No calendar-day rounding.

### Idempotency

`startTrial()` returns the existing subscription untouched if a trial already
exists. A user cannot obtain a second trial by logging out, verifying email,
completing onboarding, uploading a resume, switching devices, or because a
scheduled job re-ran.

### Admin exemption

Admins bypass plan entitlements entirely in `getEffectiveSubscription()`.
They never consume customer AI quotas, and their access does not depend on a
trial. The admin dashboard even redirects `/settings/billing` away, since a
billing page would be misleading for an unrestricted account.

### Testability

All billing logic reads time from `src/lib/billing/clock.ts`, never
`new Date()` directly. `setTestNow()` lets tests exercise 14-day expiry
instantly, and it **refuses to run in production**.

---

## 4. Entitlement architecture

Capabilities are identified by what they *do*, not by which plan pays for them:

```
AI_JOB_ANALYSIS, AI_COVER_LETTER, AI_INTERVIEW_PREP,
RESUME_OPTIMIZATION, PRIORITY_QUEUE, ADVANCED_PREPARATION, …
```

`FEATURE_ENTITLEMENTS` maps each capability to the plans that grant it.
`released: false` marks a capability that is defined but **not yet shipped**, so
the UI shows "Coming soon" rather than implying a working feature.

Enforcement is three-layered:

1. **UI gate** — `PlanRequiredCard`, `FeatureComparisonTable` explain what is
   locked and which tier unlocks it.
2. **API gate** — `requireEntitlement(userId, feature)` throws
   `PlanRequiredError`, which serialises to a safe `403 PLAN_REQUIRED` payload.
3. **Call site** — call it immediately before any expensive provider call.

Hiding a button is never sufficient.

### Adding a feature

1. Add the key to `FEATURE_KEYS` and `FEATURE_ENTITLEMENTS` in `plans.ts`.
2. Set `released: false` until it actually works.
3. Call `requireEntitlement()` at the route handler.
4. Call `consumeUsage()` before the provider call if it is metered.

No new tables, no scattered `if (user.plan === 'PRO')` checks.

---

## 5. Usage accounting

One `UsageRecord` table backs every metered capability. Rows are never deleted
to "reset" a counter — usage is metered against explicit UTC
`periodStart`/`periodEnd` windows, which keeps history auditable and lets a
future provider with custom billing periods slot in without a redesign.

### Concurrency

`consumeUsage()` performs check-and-increment inside a transaction that holds a
**PostgreSQL transaction-scoped advisory lock** keyed on
`(userId, featureKey, periodStart)`. A naive read → check → write lets a user
bypass a limit by firing parallel requests.

A row lock alone is not sufficient here: `SELECT … FOR UPDATE` only locks rows
that already exist, so the very first burst of requests in an empty period would
each read zero and all pass. A test caught exactly that — 6 of 10 parallel
requests passing a limit of 5. An advisory lock exists whether or not any row
does, and is released automatically on commit or rollback.

This is verified by a test that fires 10 concurrent requests at a limit of 5
and asserts exactly 5 succeed.

Units are generic (`feature` + `units`) rather than hardwiring "1 request = 1
credit", so resume optimisation, job analysis and interview generation can be
priced differently later.

An `idempotencyKey` on each row means a retry of the same operation is recorded
once, not twice.

> **Open question.** `PLAN_LIMITS` defines a single `aiCredits` figure per plan,
> while `consumeUsage` meters **per feature key**. Today a feature's ceiling is
> therefore reached by usage of that feature, and the `aiCreditsRemaining` value
> sent to the UI is the plan's figure rather than a computed remainder. This is
> pre-existing behaviour across all AI features; the Resume Builder release did
> not change it and records the discrepancy in
> [`RESUME_BUILDER.md` §12](RESUME_BUILDER.md#12-usage-accounting).

---

## 6. Admin authorization

`src/lib/authz.ts` provides `getCurrentUser()`, `getCurrentAdmin()`,
`requireUser()` and `requireAdmin()`.

**Role lives in the database** (`User.role`), never derived from
`user.email === …`. `getCurrentUser()` re-reads the role on every request, so a
revoked role takes effect immediately rather than persisting in a stale JWT.

There is deliberately **no** public admin-registration route, **no** "are you
admin?" signup field, and **no** admin email in client-side JavaScript. Admin
access is granted only by `npm run admin:bootstrap -- <email>`, which promotes
exactly one existing account.

Enforcement happens in server components, route handlers, and the database
mutation path (the plan-change service re-verifies the admin role *inside* its
transaction). Hiding `/admin` from navigation is presentation, not
authorization.

---

## 7. Upgrade workflow

```
User submits request  →  Admin reviews  →  Admin contacts user (email/WhatsApp)
     →  Arrangement happens OUTSIDE the app  →  Admin confirms
     →  Plan activated + request marked APPROVED in ONE transaction
     →  User notified (in-app + queued email)
```

**No payment collection is implemented.** The copy never implies otherwise:
"Submitting a request does not charge you."

### State machine

```
PENDING → CONTACTED → APPROVED | REJECTED
       ↘ CANCELLED (user may withdraw while open)
```

`assertTransition()` enforces legal moves. Terminal states
(`APPROVED`/`REJECTED`/`CANCELLED`) have no outgoing edges, so a second admin
acting on a stale copy gets a `409` instead of double-applying.

### Approval is atomic

`adminChangePlan(..., resolveUpgradeRequestId)` writes the subscription change,
the audit event, the request resolution, the notification and the email outbox
row inside one transaction. The plan and the request can never disagree.

### Duplicate protection

A user with an open (`PENDING`/`CONTACTED`) request gets `409` rather than a
second identical row. They may submit again once it is resolved.

### Contact links

`buildWhatsappUrl()` constructs `https://wa.me/<digits>` from a **validated**
number only. It refuses anything that is not digits plus an optional leading
`+`, so a user-supplied `javascript:` or hostile host can never become a link.
The prefilled message is short and carries no account data.

---

## 8. Email reliability

The application has previously reported business failures when the email
provider failed. The fix is architectural, not a try/catch.

```
BEGIN
  subscription change / account creation
  audit event
  in-app notification
  email outbox row          <-- queued, not sent
COMMIT

then, out of band:          <-- never inside the transaction
  deliver via Resend with bounded retries
```

A failed provider call therefore:

- **never** rolls back or fails the business transaction,
- is persisted as `PENDING`/`FAILED` for retry,
- is observable via `getEmailOutboxHealth()`,
- and **never** fabricates a successful delivery record.

Retries use bounded exponential backoff (6 attempts, 1 min doubling) via
`nextAttemptAt`. Failures beyond the budget become `FAILED` rather than
retrying forever. Claims are made with a conditional `updateMany`, so
concurrent workers cannot double-send.

`idempotencyKey` on `EmailOutbox` is `UNIQUE`, so a trial reminder keyed
`trial-ending-3-days:<userId>:<date>` is sent exactly once no matter how often
the cron runs.

External email APIs are **never** called inside a database transaction — that
would hold locks across network I/O.

---

## 9. Scheduled jobs

`/api/cron/maintenance` runs a single idempotent worker:

1. release stale email-processing locks
2. drain the email outbox
3. reconcile expired subscriptions/trials
4. send trial-ending reminders (deduped)

Scheduled nightly via `vercel.json` crons.

`/api/cron/queue` runs daily and is idempotent:

1. sync each user's career actions
2. send one motivating daily digest with the top three moves
3. warn users whose streak is at risk (timezone-aware, once per day)

Career-action sync also reconciles the queue: open system actions whose job has
moved to a closed stage (rejected, archived, offer) or was deleted are
auto-dismissed, and are revived only if the job returns to an active stage.
Queue reads apply the same job-status filter defensively, so stale interview
or follow-up prompts cannot leak back in.

Streaks use the user's saved timezone, and any protected-page visit counts as
activity. A user who reads their dashboard every day keeps the streak even if
they change nothing.

### Cron is not authorization

`isCronAuthorized()` **fails closed**: if `CRON_SECRET` is unset or shorter
than 16 characters, the endpoint is unreachable rather than public. The
previous implementation only checked the token when the variable happened to be
set, which silently exposed maintenance endpoints whenever it was missing. The
same helper now protects `/api/cron/queue`.

Secrets are compared with a constant-time loop. Successes and failures are
logged without ever logging the secret.

The same work runs offline via `npm run maintenance:run`, so recovery never
depends on the scheduler.

All work is **batched and bounded** (25 outbox rows, 200 subscriptions per
invocation) so a large user base cannot exhaust a serverless execution. A single
failing user is recorded and skipped rather than aborting the batch.

---

## 10. Future payment provider integration

Nothing provider-specific exists today. The seam is already in place:

```
Payment provider
      ↓  webhook (signature-verified, idempotent, replay-safe)
Billing adapter   ← to be written
      ↓
Subscription service
      ↓
Entitlements      ← unchanged
```

`Subscription.billingProvider`, `externalCustomerId`, and
`externalSubscriptionId` are nullable and unused today. A future adapter sets
them and drives the **same** `Subscription` rows through the **same**
entitlement engine — no rewrite of feature gates, history, or usage tracking.

`src/lib/billing/upgrade-requests.ts` and the service layer already model the
manual path; automated billing only changes *what writes the subscription*, not
how access is resolved.

---

## 11. Migration strategy

Migrations are **additive only**. The monetization schema introduced:

- `ALTER TABLE "User" ADD COLUMN role … DEFAULT 'USER'` — existing users keep
  working and default to `USER`; admins are promoted explicitly afterwards.
- New tables only. No `DROP`, no `TRUNCATE`, no data rewrite.

Production deploys run `prisma migrate deploy` **separately** from the build.
`build:vercel` deliberately no longer runs migrations, because a Vercel
**preview** build must never mutate a production database.

### Rollout

```
1. Deploy code
2. Deploy schema migration
3. Verify production DB
4. Configure env vars
5. Bootstrap an admin
6. Initialize monetization  (npm run monetization:initialize -- --dry-run)
7. Verify existing-user trial assignments
8. Enable monetization
9. Verify billing UI + upgrade request flow
```

Migration success is **not** monetization launch. `enabledAt` is what activates
trials, and it is set explicitly.

Because the schema is additive, code can be rolled back without destroying
subscription rows.

---

## 12. Security summary

| Control | Implementation |
|---|---|
| Admin auth | `requireAdmin()` / `getCurrentAdmin()`; DB role re-read per request |
| Plan changes | Transactional, reason required, role re-verified inside the tx |
| User identity | Always from session; `userId` in a body is rejected by strict Zod |
| Feature gates | `requireEntitlement()` → safe `403 PLAN_REQUIRED` |
| Usage limits | Row-locked transaction; concurrency-tested |
| Cron | Fail-closed constant-time bearer check |
| Schema drift | `npm run schema:check` blocks a deploy on proven drift; `GET /api/health` reports `503` when the DB is behind |
| Migrations | GitHub Actions applies them on every merge to `main`, serialised via `concurrency`, then waits for a healthy deployment |
| Deploy verification | The pipeline polls `/api/health` until the schema is CURRENT; a green build alone is never treated as success |
| Resume files | Private blobs + authenticated, ownership-checked route |
| Cache safety | `private, no-store` on all admin/billing responses |
| Input validation | Strict Zod schemas rejecting unknown fields |
| Secrets | Server-only env vars; never logged |
| Error messages | Safe codes and copy; details logged server-side only |
| Indexes | On `User.role`, `Subscription.{userId,status,trialEndsAt,endsAt}`, `UpgradeRequest.{userId,status,createdAt}`, `UsageRecord.{userId,featureKey,periodStart}` |

---

## 13. Resume Intelligence

Added by the Resume Intelligence release. It reuses everything above rather
than introducing a second system: the entitlement resolver, the `consumeUsage`
advisory lock, `PLAN_LIMITS.aiCredits`, the observability helpers and the
private-blob access pattern.

Full detail — pipeline, limits, configuration, troubleshooting — is in
[`docs/RESUME_INTELLIGENCE.md`](RESUME_INTELLIGENCE.md). The points that
matter architecturally:

| Concern | Decision |
|---|---|
| Entitlements | `AI_RESUME_PARSER` gates the provider call; `CAREER_PROFILE_INTELLIGENCE` gates reading and saving the profile. Both Pro+. Resume **upload stays Free**, so gating the AI operation never breaks existing functionality. |
| Usage | `consumeUsage` with an idempotency key derived from the document version. No new table, no second credit system. |
| Dedupe / concurrency | The unique index on `ResumeExtraction(resumeId, contentHash, schemaVersion)` is simultaneously the cache key and the concurrency lock. |
| Document model | `ResumeDocument` is new; `UserProfile.resumeUrl` stays as the primary pointer so download, onboarding and the profile page are unchanged. Backfilled from existing values. |
| Confirmed data | Relational `Career*` tables, because job matching and tailored resume generation need to query them. The pre-confirmation draft is JSON, because it is versioned and throwaway-shaped. |
| Concurrency on save | Compare-and-swap on `UserProfile.careerProfileVersion`; a stale tab gets `409`, not a silent overwrite. |
| Provider boundary | `ai-client.ts` is the only module that knows OpenAI exists. The next AI feature depends on the `ResumeAiProvider` interface, not on the SDK. |
| Prompt injection | The document is fenced and labelled as data, the model gets **no tools**, and nothing it returns is trusted — every value is re-checked against the source text before it is stored. |
| Evidence | The model's self-reported confidence is discarded. A claim is `SUPPORTED` only if its snippet can actually be found in the resume. |
| Retention | Raw resume text is **never persisted**. Verification runs before the extraction is stored, which is what makes that possible. |

---

## 14. AI Job Intelligence

Added by the Job Intelligence release. It reuses the same entitlement resolver,
the same `consumeUsage` advisory lock, the same `aiCredits` budget, the same
observability helpers and the same provider seam. It introduces one new table
and one additive column, and it changes no scoring rule.

Full detail — pipeline, verification rules, caching, configuration — is in
[`docs/JOB_INTELLIGENCE.md`](JOB_INTELLIGENCE.md). The points that matter
architecturally:

| Concern | Decision |
| --- | --- |
| The boundary | **The AI explains the matching engine; it never replaces it.** `calculateFitScore`, `calculateFitTier`, `titleMatchesAny` and `inferScoreComponents` are untouched. |
| No score field | There is no numeric score anywhere in the model's output schema. A response carrying `fitScore` fails Zod validation, and there is a test for it. |
| Deterministic facts injected | Remote, location, eligibility, time zone and compensation are computed in TypeScript, handed to the model as read-only facts, and **re-applied over its answer**. The model explains them; it cannot change them. |
| Category derivation | The tier sets the floor; a hard block (geography or time zone scored zero) sets the ceiling. A tier-A job is never a "low match"; a blocked job is never a "strong match". Defined once, in `categories.ts`. |
| Title relationship | `titleMatchesAny` is unchanged. A new advisory classifier explains relatedness and can only ever **agree or downgrade** — `clampRelationship()` caps a model answer at `RELATED_ROLE` when the engine rejected the title. |
| Evidence | Every excerpt attributed to the posting is re-quoted against the actual text. A quote that cannot be found is dropped. Nothing invented reaches the database. |
| Capability claims | A claim that the user has a skill is re-checked against their real profile rows. Absence from a profile is reported as *absence of evidence*, never as *absence of capability*. |
| Salary | Integer comparison only. A missing salary is `NOT_STATED_BY_EMPLOYER`, never zero. Two currencies are `NOT_COMPARABLE` — no exchange rate is ever invented. |
| Personalisation | The confirmed career profile, then saved work history, then preferences, then verified scalars. **The raw resume is never re-parsed** for job analysis. |
| Job description | A new nullable `JobLead.jobDescription`, separate from `notes`. `notes` holds ingestion-generated clue strings and is not a dependable record of what the employer wrote. |
| Personal ownership | `JobIntelligenceAnalysis` belongs to `(userId, jobId)` and cascades on both. A personalised verdict is never written onto a job record other users can see. |
| Cache | `@@unique([userId, jobId, inputFingerprint, schemaVersion])` is simultaneously the cache key and the concurrency lock. The fingerprint covers job text, career-profile version, matching preferences and both contract versions — never `updatedAt`. |
| Prompt injection | The posting is fenced and labelled as data, the model gets **no tools**, deterministic facts are re-applied, and every claim is re-verified. The analysis model cannot apply to jobs, contact employers, write rows, or change a subscription. |

---

## 15. Resume Builder & Job-Specific Optimisation

Added by the Resume Builder release. Like Job Intelligence, it reuses the
entitlement resolver, the `consumeUsage` advisory lock, the observability
helpers and the provider seam. It introduces two new tables and changes no
existing one.

Full detail — data model, templates, PDF pipeline, verification rules,
configuration — is in
[`docs/RESUME_BUILDER.md`](RESUME_BUILDER.md). The architectural points:

| Concern | Decision |
| --- | --- |
| Two kinds of resume | `ResumeDocument` is an **uploaded file** and keeps every existing consumer. `StructuredResume` is a document the user **builds**. Folding editable content into `ResumeDocument` would make "which file did this extraction come from?" unanswerable. |
| Content as JSONB | The document is edited, validated, versioned and exported as one unit, and is never queried by an inner field. Everything that *is* queried — owner, target job, lineage — is a real indexed column. |
| Versioning | **Independent documents, not snapshot rows.** A variant is its own row that deep-copies the source and regenerates every entry id, so editing or deleting one cannot reach the other and there is nothing to reconstruct. |
| Optimistic concurrency | `revision`, compared inside the conditional write rather than around it — the same mechanism and intent as `UserProfile.careerProfileVersion`. |
| The profile is a source | Creating a resume copies confirmed values verbatim and writes nothing back. Editing or deleting a resume never touches the career profile. |
| Preview equals export | One layout engine emits absolutely-positioned blocks in PDF points; the PDF renderer and the HTML preview are two renderers of that same list. Preview drift is structurally impossible rather than managed. |
| Server-only PDF | `pdf-lib` and `fontkit` appear in no client chunk — verified against the production build output. The preview consumes layout blocks over JSON. |
| Templates are data | Eight fields in `templates.ts` are the complete vocabulary of template difference. No hook, no registration, no way for a template to introduce markup. |
| Accents are keys | A user submits an accent **key** from a five-entry palette, never a colour. There is no code path from a request body to a colour value. |
| The model proposes | The model has **no tools** and returns a closed set of operations naming one place in the document. It cannot read files, call the network, change state, or write anything. |
| Staleness | `inputFingerprint` covers resume text, revision, job text, job `updatedAt`, profile context and fit score. Recomputed on every read, so a proposal is labelled stale the moment anything moves — and applying stale advice is refused, not warned about. |
| Anti-fabrication | Enforced in `verify.ts`, not requested in a prompt. Numeric, acronym and proper-noun tokens must already exist in the candidate's resume or career profile. **The job description licenses nothing**: a number in a posting is the employer's result, not the candidate's. |
| Partial application | Operations are applied highest index first, so a removal cannot shift the indices of the ones still to come. The revision check and the write are one conditional update inside a transaction. |
| User edits are re-checked | "Edit before accepting" runs the **same** anti-fabrication pass as the model's own text, and a refusal says why specifically rather than "choose at least one suggestion". |
| Rejections are visible | Operations the server refused are stored with a reason and counted in the review UI. Silently returning a shorter list is less trustworthy than saying what was removed and why. |
| No new entitlement | `RESUME_BUILDER` and `RESUME_OPTIMIZATION` already existed as defined-but-unreleased keys and are simply shipped. PDF export has no key of its own: a built resume cannot exist without the builder, so a separate gate would be an invented restriction. |
| Export is stateless | Generated per request from the authorised document and streamed. Nothing is stored, so there is no public URL and nothing to leak. No provider call, so it costs no credit. |
| Private responses | Every authenticated response is `private, no-store, must-revalidate`; the export adds `attachment`, `sandbox` and `nosniff`, with a filename derived from the server-known name. |

## 16. AI Cover Letters & Application Materials

Added by the AI Application Materials release. Like Resume Builder and Job
Intelligence, it reuses the entitlement resolver, the `consumeUsage` advisory
lock, the observability helpers and the provider seam. It introduces one new
table and changes no existing one.

Full detail — data model, templates, PDF pipeline, verification rules,
configuration — is in [`docs/APPLICATION_MATERIALS.md`](APPLICATION_MATERIALS.md).
The architectural points:

| Concern | Decision |
| --- | --- |
| One table for everything | `ApplicationMaterial` covers cover letters, recruiter messages, connection notes, follow-ups, status checks and thank-you notes. `type` is a real enum column, not a string convention. |
| Privacy by structure | `userId` is required and every read scopes by it. A material is **never** written onto a shared `JobLead`, so it cannot leak through public job data no matter what happens in the UI. |
| Lineage | `jobId`, `resumeId` and `templateId` are optional `SetNull` foreign keys — a recruiter message legitimately has no job, and deleting a job never destroys the user's writing. |
| Versioning | Chained through `supersedesId` rather than mutating in place; `revision` numbers each draft and `editVersion` implements optimistic concurrency (409 on mismatch). |
| Greeting and sign-off | Server-derived from real values. The model never writes them, so an invented recipient is structurally impossible. |
| Anti-fabrication | Enforced in `verify.ts`: excerpts are re-quoted against real source text, every number must exist in the candidate's records, and employer/title/credential claims must name a known organisation. Unsupported sentences are removed and listed for review. |
| No tools | The provider has no file, network or database access. Prompt injection is a wording problem. |
| Entitlement | Ships the existing `AI_COVER_LETTER` key (already in `plans.ts`, flipped to `released: true`). No new plan, limit, usage table or parallel quota. Usage draws on the shared `aiCredits` budget, reserved before the provider call under the advisory lock with an idempotency key. |
| Copy/download | Never consume a credit. PDF export reuses the resume builder's `pdf-lib` renderer — no second PDF stack. |
| No sending | Drafts only. Nothing is emailed, messaged or submitted. |

