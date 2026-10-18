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

`consumeUsage()` performs check-and-increment inside a transaction that holds
a `SELECT … FOR UPDATE` row lock. A naive read → check → write lets a user
bypass a limit by firing parallel requests; the lock serialises them.

This is verified by a test that fires 10 concurrent requests at a limit of 5
and asserts exactly 5 succeed.

Units are generic (`feature` + `units`) rather than hardwiring "1 request = 1
credit", so job analysis and interview generation can be priced differently
later.

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
| Resume files | Private blobs + authenticated, ownership-checked route |
| Cache safety | `private, no-store` on all admin/billing responses |
| Input validation | Strict Zod schemas rejecting unknown fields |
| Secrets | Server-only env vars; never logged |
| Error messages | Safe codes and copy; details logged server-side only |
| Indexes | On `User.role`, `Subscription.{userId,status,trialEndsAt,endsAt}`, `UpgradeRequest.{userId,status,createdAt}`, `UsageRecord.{userId,featureKey,periodStart}` |