# Production Runbook — teChia Jobs

Operational procedures for monetizing teChia Jobs. Follow in order; each step
verifies the one before it.

---

## Environment variables

Set these in Vercel for **Production** (and separately for Preview if the
Preview build needs to boot the app).

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `AUTH_SECRET` | yes | Auth.js session signing secret |
| `AUTH_URL` | yes | Canonical app origin |
| `NEXT_PUBLIC_APP_URL` | yes | Used in transactional email links and sitemap |
| `RESEND_API_KEY` | yes for email | Resend API key (server-only) |
| `EMAIL_FROM` | yes for email | Verified sender, e.g. `teChia Jobs <noreply@yourdomain.com>` |
| `EMAIL_REPLY_TO` | optional | Reply-to for transactional email |
| `ADMIN_NOTIFICATION_EMAIL` | yes | Where new upgrade requests are notified |
| `CRON_SECRET` | yes | Bearer token for `/api/cron/*` (min 16 chars) |
| `BLOB_READ_WRITE_TOKEN` | yes | Token for a Vercel Blob store configured as private (resumes) |
| `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` | optional | LinkedIn sign-in |
| `ALERT_WEBHOOK_URL` | optional | Discord alerting for important errors |
| `MONETIZATION_ENABLED=false` | optional | Emergency kill switch |
| `OPENAI_API_KEY` | yes for Resume Intelligence | AI provider key (server-only). Never `NEXT_PUBLIC_*` |
| `RESUME_INTELLIGENCE_MODEL` | optional | Extraction model. Defaults to `gpt-4o-mini`. Must support Structured Outputs |
| `JOB_INTELLIGENCE_MODEL` | optional | Job-fit analysis model. Defaults to `gpt-4.1-mini`. Must support Structured Outputs |
| `RESUME_OPTIMIZATION_MODEL` | optional | Resume optimisation model. Defaults to `gpt-4.1-mini`. Must support Structured Outputs. Read in exactly one place, independent of the other two |
| `PRODUCTION_URL` | yes for deploys | Repository **variable** (not secret): the public app origin, used by the deploy workflow to verify health |

**Never** hardcode any of these in source. Do not commit real values.

> **AI key safety.** `OPENAI_API_KEY` is read only in server code. If it is ever
> exposed to the browser, rotate it immediately — a public key is a billable
> credential. Without it, Resume uploads and downloads keep working and the
> analysis endpoint returns a clear "not available" message; it never simulates
> a successful extraction.

> **Preview safety.** `MONETIZATION_ENABLED=false` in the Preview environment
> guarantees preview builds can never start real trials.

> **Resume storage must be private.** The resume upload route writes with
> `access: "private"` and deliberately refuses to fall back to public storage.
> Create or select a Vercel Blob store configured for private access, set
> `BLOB_READ_WRITE_TOKEN` to that store's token in every target environment, and
> redeploy. A token linked to a public Blob store fails resume uploads with an
> actionable configuration error. Do not change resume uploads to public to
> work around this: resume files contain personal data.

> **PDF fonts are build artifacts, not environment variables.** The two Inter
> weights are committed at `src/lib/resume-builder/fonts/` and read through a
> literal path. No env var configures them, and nothing needs to be installed for
> export to work.
>
> **Do not resolve fonts through `require.resolve`.** A variable specifier is
> replaced by webpack with a stub that throws `MODULE_NOT_FOUND`, and a literal
> one makes the bundler parse the `.ttf` as JavaScript and fail the build. Both
> were shipped once and produced a warning that looked cosmetic. The unit suite
> cannot catch either — it runs under `tsx`, which resolves for real — so
> **verify PDF export against a production build**, not against `npm run dev`.

---

## Runtime baseline

| Component | Version | Note |
|---|---|---|
| Next.js | 15.5.27 | Latest patched Maintenance-LTS. Next 16 is **not** usable yet: `next-auth@5.0.0-beta.25` peer-depends on `next: ^14 \|\| ^15` |
| Prisma | 6.x | Supported. Prisma 8 is still an RC — do not force it into a schema migration |
| Node | 24.x (production) | `engines` allows `>=22` so the local toolchain is not blocked |
| PostgreSQL | Current supported major | No major upgrade required for this release |

Verify these stay current before each release; see `docs/ARCHITECTURE.md`.

## Deployment pipeline

Merging to `main` now deploys automatically, and migrations are no longer a
manual step. `.github/workflows/deploy.yml` runs on every push to `main`:

```
  push to main
      │
      ├─ 1. Inspect schema drift          read-only; logs what is pending
      ├─ 2. Apply pending migrations      prisma migrate deploy
      ├─ 3. Verify the schema matches     npm run schema:check  → must be CURRENT
      ├─ 4. Wait for a healthy deploy     GET /api/health until ok, then verify
      └─ 5. Summarise                     into the run summary
```

Step 4 is the one that matters. A green build does not mean a working site —
on 2026-10-18 the build went green while every dashboard load returned a 500.
So the pipeline keeps polling `/api/health` until the deployment reports a
CURRENT schema, and fails (and alerts on Discord) if it never does.

### Ordering, and the race it creates

Vercel auto-deploys on push to `main`, so the migration job and the Vercel build
run **concurrently**. Migrations take seconds and a Vercel build takes a minute
or two, so the migration normally wins — but that is a timing assumption, not a
guarantee, and this bug has already taken the site down once.

Two properties make the residual window harmless rather than fatal:

- `concurrency: production-deploy` with `cancel-in-progress: false` means two
  rapid merges can never run two migrations against the database at once. A
  newer push **waits**; it never cancels a half-finished migration.
- `/api/health` re-reads the database on **every request**, so the moment the
  migration lands the deployment recovers on its own. The exposure is seconds.

### Why migrations do not run inside the Vercel build

It is tempting to put `prisma migrate deploy` in `build:vercel`. Do not:

- Vercel builds a **preview** for every pull request. A preview build that
  migrates production is a production outage waiting for a typo.
- Vercel builds are not guaranteed to run once. A retry or a cache hit would
  re-run the migration step.
- Builds can run concurrently, and two `migrate deploy` processes against one
  database is not a supported race.

GitHub Actions runs on `main` only, has an explicit, inspectable log, and cannot
fire for a fork.

### Required GitHub configuration

| Name | Kind | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Secret | Production database. Never printed by the workflow. |
| `ALERT_WEBHOOK_URL` | Secret | Discord, for failed-deployment alerts. |
| `PRODUCTION_URL` | Variable | Public app origin, used to verify health. Not secret. |

Set with:

```bash
gh secret set DATABASE_URL
gh secret set ALERT_WEBHOOK_URL
gh variable set PRODUCTION_URL --body "https://yourdomain.com"
```

### Triggering a deploy manually

```bash
gh workflow run deploy.yml -f reason="migration failed, retrying"
```

Use this after fixing a migration that failed mid-deploy. It runs the same
pipeline, so it is safe.

---

## Deployment sequence

### 1. Prepare

```bash
npm ci
npm run typecheck
npm run test
npm run build
```

### 2. Back up production

Take a managed snapshot (Vercel Postgres / Neon / Supabase). Confirm a restore
path exists **before** continuing.

### 3. Verify the schema matches this build

**Automated.** Merging to `main` runs this pipeline. Run it manually when
deploying from a workstation, or when recovering from a failed deploy:

```bash
DATABASE_URL="<production-url>" npm run schema:check
```

Read-only. Expect `Safe to deploy.` A non-zero exit means **stop**: it names the
missing migration. See §"Why the schema gate exists" below.

### 4. Deploy the migration

Run from a trusted machine, not from a preview build:

```bash
DATABASE_URL="<production-url>" npm run prisma:migrate:deploy
DATABASE_URL="<production-url>" npm run prisma:migrate:status
DATABASE_URL="<production-url>" npm run schema:check   # must now say CURRENT
```

Expect `Database schema is up to date!`.

**Do not** use `prisma db push` in production. **Do not** run `migrate reset`.

> **Order matters.** Merge and deploy the *code* only after this step succeeds.
> Vercel deploys code the instant it is merged; the database does not move on
> its own. Migrating afterwards leaves a window where the deployed code queries
> columns that do not exist yet.

### 5. Deploy the application

Push to `main`. `buildCommand` is `npm run build:vercel`, which runs
`prisma generate && next build`. It intentionally does **not** migrate, so a
preview build cannot mutate the production database.

### 6. Bootstrap the first admin

```bash
DATABASE_URL="<production-url>" npm run admin:bootstrap -- owner@yourdomain.com
```

The account must already exist. Verify by signing in and opening `/admin`.

```bash
DATABASE_URL="<production-url>" npm run monetization:status
```

Confirm `Admins` is at least `1`. Do **not** enable monetization without an admin.

### 7. Preview the initialization

```bash
DATABASE_URL="<production-url>" npm run monetization:initialize -- --dry-run
```

Read the summary. Confirm the trial plan exists and the user count looks right.

### 8. Initialize monetization

```bash
DATABASE_URL="<production-url>" npm run monetization:initialize
```

This establishes the **immutable** launch timestamp and the 14-day existing-user
trial window. Re-running is safe and will not move the window.

### 9. Verify trial assignments

```bash
DATABASE_URL="<production-url>" npm run monetization:status
```

Spot-check a real account in the admin dashboard: it should show `Pro Trial`
with a trial end exactly 14 days after the launch timestamp.

### 10. Verify the end-to-end flow

1. Sign in as a test user → `/settings/billing` shows the trial countdown.
2. Request a Pro upgrade.
3. Confirm it appears under `/admin/upgrade-requests`.
4. Approve it with **Activate plan** checked.
5. Confirm the user's plan is now `Pro`.
6. Confirm the user received an in-app notification and queued email.

### 11. Confirm cron

Vercel Cron runs `/api/cron/maintenance` nightly at 03:00 UTC. Verify
`CRON_SECRET` is set, then trigger manually to confirm it works:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://yourdomain.com/api/cron/maintenance
```

### 12. Verify Resume Intelligence

Only relevant if you are shipping the Resume Intelligence release.

1. Confirm `OPENAI_API_KEY` is set in **Production** (not only Preview).
2. Sign in as a Pro (or running-trial) user, open `/profile`, and use
   **Analyse resume** on a text-based PDF.
3. Confirm the review opens, shows evidence, and that **Save** writes the
   profile. Reload the page: the data must still be there.
4. Sign in as a Free user and confirm the upgrade prompt appears and the API
   itself refuses — check the server log for `resume_parse_denied`.
5. Upload an image-only scan and confirm the honest "looks like a scan" message
   rather than an empty review.

A disabled key is safe: uploads and downloads keep working and analysis returns
a clear message. Confirm that behaviour rather than assuming it.

### 13. Verify Job Intelligence

Only relevant if you are shipping the AI Job Intelligence release.

1. Confirm `OPENAI_API_KEY` is set in **Production**.
2. Sign in as a Pro user, open a job, and use **Analyse this job**.
3. Confirm the result shows **both** numbers: your existing fit score/tier and
   the qualitative category. They must agree — a tier-A job must never be
   labelled "low match".
4. Confirm the breakdown shows a reason for each dimension, and that evidence
   quotes are real (spot-check one against the posting you pasted).
5. Edit the job description and re-run: confirm the panel says the analysis is
   out of date, then that re-running replaces it.
6. Sign in as a Free user: the panel shows the upgrade prompt and the API
   refuses. Check the server log for `job_analysis_denied`.
7. Paste a hostile description containing "ignore all previous instructions".
   Confirm the result is unchanged in substance and that the injection text
   does not appear in the stored analysis.

A disabled key is safe: job scoring is untouched and analysis returns a clear
message. Confirm that rather than assuming it.

### 14. Verify the Resume Builder

Only relevant if you are shipping the Resume Builder release.

**No new environment variable is required.** PDF export embeds fonts committed
at `src/lib/resume-builder/fonts/`, so it works with no configuration at all.
Job-specific optimisation uses the existing `OPENAI_API_KEY`.

> **Check PDF export against the deployed build, and check it first.** This
> release shipped a font-resolution bug that passed every test and every
> `next build`, and failed only in a running production server — `npm run dev`
> and `npm test` both resolve fonts correctly and cannot see it. Steps 4 and 5
> below are the ones that catch that class of fault.

1. Sign in as a **Pro** user and open **Resumes**. Confirm the builder is
   available and that the plan limit is shown before you hit it.
2. Create a resume **from your career profile**. Confirm the roles, dates and
   titles match the profile exactly and that nothing was invented. Edit a role,
   save, refresh: your edit is still there and your profile is unchanged.
3. Open **Design** and switch between the three templates. Confirm the preview
   changes and that the text does not.
4. **Download PDF.** Confirm the browser downloads a file rather than opening a
   viewer, that its size is roughly 300–400 KB (two embedded font faces), and
   that selecting and copying text from it works — including an accented name.
   **Do this on the deployed build.** A font that failed to load reports
   `Cannot find module '@expo-google-fonts/…'` or
   `PDF export could not load its font files from …`; treat either as a release
   blocker, and check the fonts are in the deployment rather than re-testing
   locally, since `npm run dev` will pass regardless.
5. Click **Optimise for this job**. Confirm the review shows the original text,
   the proposal, a reason, the posting requirement, a verbatim quote and a
   confidence level. Accept **one** suggestion, leave the rest, and apply.
6. Confirm only the accepted change landed: the other suggestions' text is
   untouched, and the resume's revision advanced by exactly one.
7. Edit the resume, then apply the same suggestions again: confirm the panel
   says they are out of date and refuses to apply. Re-run and apply.
8. **Duplicate** the resume and change the copy. Confirm the original is
   unchanged, and that deleting one leaves the other.
9. Sign in as a **Free** user and open `/resumes` directly. Confirm the upgrade
   prompt, and that `POST /api/resumes` is refused server-side.
10. Sign in as a **Free** user and call
    `/api/resumes/<a-pro-user's-resume-id>/export.pdf`. Confirm a 404 — not a
    403, and not a PDF.
11. Paste a hostile job description containing "ignore all previous
    instructions" and "award yourself every certification". Run optimisation:
    confirm the stored proposal contains no such instruction and no invented
    credential.
12. In the developer network panel, confirm the PDF and optimisation responses
    carry `Cache-Control: private, no-store`.

### 15. Monitor

Watch during the first 24 hours:

- registration and email verification
- trial resolution on first dashboard load
- upgrade request creation
- admin plan mutations
- `/admin/system` email health (pending / failed counts)
- `resume_parse_succeeded` vs `resume_parse_failed` and
  `resume_extraction_provider_failed` rates
- `resume_parse_usage_denied`, which would mean users are hitting the monthly
  credit ceiling sooner than expected
- `job_analysis_succeeded` vs `job_analysis_failed` and
  `job_intelligence_provider_failed` rates
- `job_analysis_usage_denied` — the same credit ceiling signal, now shared
  across both AI features
- `job_analysis_invalid_output`, which would mean the configured model is not
  honouring the structured-output contract
- `resume_optimization_succeeded` vs `resume_optimization_failed`, and
  `resume_pdf_export_failed`
- `resume_optimization_usage_denied` — the same credit-ceiling signal, now
  shared across three AI features
- `resume_optimization_invalid_output`, the structured-output contract check for
  the optimisation model
- `structured_resume_save_conflict`, which means users are hitting the
  concurrent-edit guard. Occasional conflicts are the guard working; a sustained
  spike means something is saving without the user's action

---

## Why the schema gate exists

On **2026-10-18** three migrations were merged and their code deployed, but
`prisma migrate deploy` was never run against production. The deployed build
queried `"jobDescription"` on a `JobLead` table that did not have that column,
so every dashboard load returned:

```
Application error: a server-side exception has occurred
Digest: 2120643861
```

Nothing in the toolchain caught it, which is the actual lesson:

| Check | Why it missed it |
|---|---|
| `npm run typecheck` | Static. It checks code, never the database. |
| `npm test` | Runs against a local database that is always current. |
| `prisma generate` | Validates the schema against the *client*, not the server. |
| The browser message | Names no table and no column. Slow to diagnose from a ticket. |

The three controls added in response:

1. **`npm run schema:check`** — compares committed migrations against applied
   ones and exits non-zero on proven drift. It only reads; it never migrates.
2. **`GET /api/health`** — reports schema status without a session, returning
   `503` when the schema is behind. Drift is diagnosable in seconds.
3. **Runbook order** — the schema check is now step 3, before migration and
   deploy, so "forgot the migration" is a failed command rather than an outage.

> The gate **fails closed on proven drift** but **fails open when the database
> is unreachable**. Blocking every deploy on a transient network blip would
> teach people to ignore the check, which is worse than not having one.

### What was added afterwards: automation

The gate detects drift. The pipeline in §"Deployment pipeline" prevents it —
`prisma migrate deploy` now runs on every merge to `main`, followed by a
verification step that waits for a genuinely healthy deployment and alerts if
there isn't one. Merging a migration and deploying the code that needs it are
the same action now.

### Checking drift in production

```bash
curl -s https://job-seeker-os.vercel.app/api/health | jq
```

```json
{
  "status": "degraded",
  "schema": { "status": "BEHIND", "pendingMigrations": ["20261018125251_job_intelligence"] }
}
```

`status: ok` means the deployed code and the database agree. No secrets and no
user data are exposed.

### The `0_init` baseline

Production records a `0_init` migration predating this repository's history.
The guard ignores anything sorting before the earliest migration we own, so
that baseline does not produce a permanent false "database is ahead" warning.
A permanently-warning check is a check people learn to ignore.

## Rollout checklist

```
[ ] Production DB backup verified and restorable
[ ] Migration tested against a copy of production data
[ ] Production build passes (typecheck + lint + tests + build)
[ ] All required env vars set in Vercel
[ ] RESEND_FROM domain verified in the Resend dashboard
[ ] BLOB_READ_WRITE_TOKEN present (private resume storage)
[ ] PDF export verified end to end against a PRODUCTION build (`next build && next start`), not `npm run dev` — the test suite runs under `tsx` and cannot detect a bundler resolution failure
[ ] CRON_SECRET set (>= 16 chars)
[ ] Admin account bootstrapped and /admin verified
[ ] monetization:initialize --dry-run reviewed
[ ] monetization:initialize run; trial assignments verified
[ ] Billing UI verified as a real user
[ ] Upgrade request → admin approval → plan activation verified
[ ] Cron endpoint verified with curl
[ ] OPENAI_API_KEY set in Production (if shipping Resume Intelligence)
[ ] Resume analysis → review → save → survives reload verified
[ ] Free-plan API refusal verified server-side (not just in the UI)
[ ] No secrets committed to git
```

---

## Runbook: common situations

### Trial expired but user still sees Pro

This should be impossible — access is derived from timestamps, not from the
cron. If it happens, check for a second `Subscription` row:

```sql
SELECT userId, COUNT(*) FROM "Subscription" GROUP BY userId HAVING COUNT(*) > 1;
```

The `UNIQUE` constraint on `userId` makes this impossible through the app.

### Email not sending

1. `/admin/system` → is `RESEND_API_KEY` configured?
2. Check `EmailOutbox` for `FAILED` rows and their `lastError`.
3. Deliveries are **queued**, not sent inline. A `PENDING` backlog means the
   cron has not run.
4. Force a drain: `npm run maintenance:run` or call the cron endpoint.

Email failures never affect accounts, subscriptions, or plan changes.

### Recover an admin account

If an administrator is locked out, there is no public route that can help —
no admin-registration endpoint, no "is admin?" signup field, no admin address
in client-side code. That is deliberate. The CLI is the way back in.

```bash
DATABASE_URL="<production-url>" npm run admin:password -- you@yourdomain.com --promote
```

- Generates a strong 24-character password (128 bits of entropy) and prints it
  **once**. Omit the `--promote` flag to reset the password without changing the
  role; pass an explicit password as a second argument if you prefer.
- **Destroys any outstanding password-reset token.** A token issued before the
  recovery would still be redeemable otherwise, which is a takeover path on the
  very account being recovered.
- Refuses anything under 14 characters, anything predictable, and anything over
  72 bytes — bcrypt silently truncates at 72 bytes, so a longer password would
  appear stronger than it is.
- Uses the same cost factor (12) as registration, so no rehash is needed on
  next sign-in.
- The password is never written to a log, an exception, or stdout.

To promote an account **without** touching its password:

```bash
DATABASE_URL="<production-url>" npm run admin:bootstrap -- you@yourdomain.com
```

> **Changing the password does not end existing sessions.** Sessions are signed
> JWTs, so a session issued before the change stays valid until it expires. If
> you are recovering from a suspected compromise, revoke sessions at your
> identity provider as well.

### Revoke admin access

```bash
DATABASE_URL="<production-url>" npm run admin:revoke -- former-admin@yourdomain.com
```

The command refuses to remove the last remaining admin.

### Resume analysis failing for everyone

Work down this list; the app degrades safely at every step.

1. Is `OPENAI_API_KEY` set in Production? A missing or rejected key produces
   `resume_extraction_provider_failed` with provider status 401/403.
2. `resume_extraction_provider_failed` with 429 means the provider is rate
   limiting us. Confirm the model and check the account's tier limits.
3. `resume_extraction_invalid_output` means refusals or schema misses — the
   model rejected the contract. Verify `RESUME_INTELLIGENCE_MODEL` supports
   Structured Outputs.
4. `resume_storage_read_failed` means stored blobs are unreadable. Check
   `BLOB_READ_WRITE_TOKEN`.
5. Users reporting "looks like a scan" have image-only PDFs. This is expected
   and correct; there is no OCR, by design.

**The safe move while diagnosing:** unset `OPENAI_API_KEY`. Resume upload,
download and replacement keep working, and analysis returns a clear message
instead of failing opaquely.

### Recovering a failed extraction

No user action is lost. A failed run is stored with a machine-readable code and
can be retried from `/profile` without re-uploading the resume. Because the
retry reuses the same document version, it is not charged a second time.

To force a completely fresh analysis, use **Run analysis again**, which is
charged as a new operation.

Raw resume text is never stored, so there is nothing to clean up manually. To
remove a resume and everything derived from it, delete it as usual — the
extractions and confirmed career records cascade.

### Emergency: disable monetization

Set `MONETIZATION_ENABLED=false` in Vercel and redeploy. This stops new trials
from starting. Existing subscriptions and access are unaffected — it is not a
kill switch for paid access.

To force everyone back to Free, use `/admin/users` and change plans
individually (there is deliberately no bulk destructive operation).

### Rollback

The schema is additive, so code can be rolled back without losing subscription
rows. Note that `MonetizationConfig.existingUserTrialStartedAt` is immutable by
design; changing the trial window requires an explicit audited decision, not a
rollback.

---

## Scripts

| Command | Safe in | Purpose |
|---|---|---|
| `npm run monetization:initialize` | production (with backup) | Backfill trials + activate |
| `npm run monetization:initialize -- --dry-run` | production | Report only, no writes |
| `npm run monetization:status` | anywhere | Read-only state report |
| `npm run admin:bootstrap -- <email>` | production | Promote one account to ADMIN |
| `npm run admin:revoke -- <email>` | production | Demote an admin |
| `npm run maintenance:run` | production | Drain outbox + reconcile (safe to repeat) |
| `npm run prisma:migrate:deploy` | production | Apply migrations |
| `npm run prisma:seed` | **development only** | Local demo data |

> `prisma:seed` creates a demo user. **Never run it against production.**