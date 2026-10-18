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
| `BLOB_READ_WRITE_TOKEN` | yes | Vercel Blob (private resume storage) |
| `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` | optional | LinkedIn sign-in |
| `ALERT_WEBHOOK_URL` | optional | Discord alerting for important errors |
| `MONETIZATION_ENABLED=false` | optional | Emergency kill switch |
| `OPENAI_API_KEY` | yes for Resume Intelligence | AI provider key (server-only). Never `NEXT_PUBLIC_*` |
| `RESUME_INTELLIGENCE_MODEL` | optional | Extraction model. Defaults to `gpt-5.4-mini`. Must support Structured Outputs |

**Never** hardcode any of these in source. Do not commit real values.

> **AI key safety.** `OPENAI_API_KEY` is read only in server code. If it is ever
> exposed to the browser, rotate it immediately — a public key is a billable
> credential. Without it, Resume uploads and downloads keep working and the
> analysis endpoint returns a clear "not available" message; it never simulates
> a successful extraction.

> **Preview safety.** `MONETIZATION_ENABLED=false` in the Preview environment
> guarantees preview builds can never start real trials.

---

## Runtime baseline

| Component | Version | Note |
|---|---|---|
| Next.js | 15.5.27 | Latest patched Maintenance-LTS. Next 16 is **not** usable yet: `next-auth@5.0.0-beta.25` peer-depends on `next: ^14 \|\| ^15` |
| Prisma | 6.x | Supported. Prisma 8 is still an RC — do not force it into a schema migration |
| Node | 24.x (production) | `engines` allows `>=22` so the local toolchain is not blocked |
| PostgreSQL | Current supported major | No major upgrade required for this release |

Verify these stay current before each release; see `docs/ARCHITECTURE.md`.

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

### 3. Deploy the migration

Run from a trusted machine, not from a preview build:

```bash
DATABASE_URL="<production-url>" npm run prisma:migrate:deploy
DATABASE_URL="<production-url>" npm run prisma:migrate:status
```

Expect `Database schema is up to date!`.

**Do not** use `prisma db push` in production. **Do not** run `migrate reset`.

### 4. Deploy the application

Push to `main`. `buildCommand` is `npm run build:vercel`, which runs
`prisma generate && next build`. It intentionally does **not** migrate, so a
preview build cannot mutate the production database.

### 5. Bootstrap the first admin

```bash
DATABASE_URL="<production-url>" npm run admin:bootstrap -- owner@yourdomain.com
```

The account must already exist. Verify by signing in and opening `/admin`.

```bash
DATABASE_URL="<production-url>" npm run monetization:status
```

Confirm `Admins` is at least `1`. Do **not** enable monetization without an admin.

### 6. Preview the initialization

```bash
DATABASE_URL="<production-url>" npm run monetization:initialize -- --dry-run
```

Read the summary. Confirm the trial plan exists and the user count looks right.

### 7. Initialize monetization

```bash
DATABASE_URL="<production-url>" npm run monetization:initialize
```

This establishes the **immutable** launch timestamp and the 14-day existing-user
trial window. Re-running is safe and will not move the window.

### 8. Verify trial assignments

```bash
DATABASE_URL="<production-url>" npm run monetization:status
```

Spot-check a real account in the admin dashboard: it should show `Pro Trial`
with a trial end exactly 14 days after the launch timestamp.

### 9. Verify the end-to-end flow

1. Sign in as a test user → `/settings/billing` shows the trial countdown.
2. Request a Pro upgrade.
3. Confirm it appears under `/admin/upgrade-requests`.
4. Approve it with **Activate plan** checked.
5. Confirm the user's plan is now `Pro`.
6. Confirm the user received an in-app notification and queued email.

### 10. Confirm cron

Vercel Cron runs `/api/cron/maintenance` nightly at 03:00 UTC. Verify
`CRON_SECRET` is set, then trigger manually to confirm it works:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://yourdomain.com/api/cron/maintenance
```

### 11. Verify Resume Intelligence

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

### 12. Monitor

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

---

## Rollout checklist

```
[ ] Production DB backup verified and restorable
[ ] Migration tested against a copy of production data
[ ] Production build passes (typecheck + lint + tests + build)
[ ] All required env vars set in Vercel
[ ] RESEND_FROM domain verified in the Resend dashboard
[ ] BLOB_READ_WRITE_TOKEN present (private resume storage)
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