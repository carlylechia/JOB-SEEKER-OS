# teChia Jobs

**teChia Jobs** — *The AI-powered operating system for your job search.*

A teChia Digital Solutions product.

teChia Jobs is a full-stack job search operating system for candidates who want more structure than a spreadsheet and more clarity than a generic tracker.

It combines AI-assisted fit scoring, a daily action queue, pipeline tracking, recruiter CRM, onboarding, public job discovery, and auth/account workflows into one application.

## What It Does

teChia Jobs gives users one place to:

- capture and manage job leads
- score roles against personal preferences
- prioritize the best next action each day
- track pipeline movement from saved lead to offer
- manage recruiter and referral relationships
- prepare for interviews with structured prep packs
- browse and import public jobs into a private workspace
- maintain momentum with streaks, reminders, and notifications

## Current Product Surface

### Core app

- AI fit scoring with explainable sub-signals
- private job workspace with CRUD and detail views
- daily smart queue for ranked next actions
- drag-and-drop application pipeline
- per-job recruiter/contact CRM
- follow-up scheduling and reminders
- dashboard with KPI cards, weekly trends, top priorities, streaks, and upcoming items
- interview prep workspace and reusable follow-up templates

### Resume Intelligence & Career Profile (Pro)

- AI analysis of a resume you have already uploaded — no duplicate upload needed
- structured extraction of basic details, work experience, education, skills, projects, certifications, languages, awards and publications
- every extracted item shows its evidence, and conflicting or uncertain values are surfaced rather than resolved for you
- accept, edit, reject or add items section by section; only what you confirm is saved
- become the reusable career profile behind job matching, tailored resumes, cover letters and interview prep

Full behaviour, limits, configuration and troubleshooting: [docs/RESUME_INTELLIGENCE.md](docs/RESUME_INTELLIGENCE.md).

### AI Job Intelligence (Pro)

- open any job in your workspace and see *why* it fits you, not just a score
- dimension-by-dimension breakdown: title, seniority, required and preferred skills, experience, education, location, remote work, eligibility, time zone, compensation
- every important claim traces back to a short quote from the posting, your career profile, or your preferences
- says plainly what it does not know, and why, instead of guessing
- practical next steps — what to confirm with the employer, what to emphasise, what to fix in your profile
- your existing fit score and tier are unchanged and still drive ranking; the AI explains them rather than replacing them

Full behaviour, limits, configuration and troubleshooting: [docs/JOB_INTELLIGENCE.md](docs/JOB_INTELLIGENCE.md).

### Resume Builder & Job-Specific Optimisation (Pro)

- build a structured resume from your confirmed career profile, from a blank page, or by copying an existing one
- edit every section as structured fields — roles, bullets, education, skills, projects, certifications, languages, awards — with reordering
- three professional templates, all rendering the same content, so switching template can never change what your resume says
- a preview that **is** the export: the same layout blocks at the same coordinates, so nothing is different in the file you download
- download a real, text-selectable PDF with a single click. No credits, no limits, works on every plan
- keep several versions — a master resume plus one tailored variant per role — and edit each independently; the master is never overwritten
- pick one of your own jobs and get specific, evidence-backed suggestions for that resume and that job
- every suggestion shows the original text, the proposal, why it helps, the requirement it addresses and a verbatim quote behind it
- accept, dismiss or edit each suggestion on its own. Accepting one never applies the others
- **the anti-fabrication rule is enforced, not promised.** A rewrite that introduces a figure, technology or credential your resume does not contain is removed before you ever see it — and you are told how many were removed and why. Where a bullet would be stronger with a number you have not given, you get a question, not a made-up figure
- suggestions go out of date the moment you edit the resume or the job, and stale advice cannot be applied

Full behaviour, architecture, limits and troubleshooting: [docs/RESUME_BUILDER.md](docs/RESUME_BUILDER.md).

### AI Cover Letters & Application Materials (Pro)

- cover letters, recruiter outreach, LinkedIn connection notes, application
  follow-ups, status checks and interview thank-you messages, each built from
  your confirmed career profile and the real job details — never generic filler
- every personal fact traces back to a source you control; numbers, employers
  and qualifications the model cannot verify are removed from the draft and
  surfaced for you to review before you send
- drafts are saved, versioned and revisable; a regeneration never overwrites a
  draft you have already read
- works from a saved template or a blank page, links to any job in your
  pipeline, and exports to plain text or PDF
- nothing is sent automatically: you always review, copy or download before
  using the material outside teChia Jobs
- server-side entitlement enforcement via the existing `AI_COVER_LETTER`
  feature key; usage is metered through the shared AI credits budget. Copy,
  download and manual editing never consume a credit

Full behaviour, architecture, limits and troubleshooting:
[docs/APPLICATION_MATERIALS.md](docs/APPLICATION_MATERIALS.md).

### Intake and onboarding

- multi-step onboarding flow with autosaved progress
- onboarding skip and complete flows
- resume upload and parsing
- profile picture upload support
- preference-driven scoring setup for titles, stack, salary, timezone, and remote fit
- job ingestion from pasted descriptions and job URLs

### Auth and account flows

- email/password auth with Auth.js
- LinkedIn sign-in
- email verification flow
- forgot password and reset password flows
- protected app routes with per-user workspaces

### Public and marketing surface

- redesigned landing page and demo experience
- public jobs browser for recent platform jobs
- save-to-workspace flow for public jobs
- Vercel Analytics integration

## Tech Stack

- Next.js 15
- React 19
- TypeScript
- Tailwind CSS
- Auth.js / NextAuth
- Prisma ORM
- PostgreSQL
- Zod
- Recharts
- Lucide React
- Vercel Analytics
- Resend

## Monetization & Access Architecture

- `Plan` → `Subscription` → effective plan → entitlements → feature access
- one current subscription per user (enforced by a unique constraint)
- effective access derived from timestamps, never trusted from a stored status
- centralized entitlement gates (`requireEntitlement`) — no scattered plan checks
- generic metered usage with concurrency-safe consumption
- immutable subscription audit trail (`SubscriptionEvent`)
- durable email outbox so provider failures never fail business transactions
- server-side admin authorization (`requireAdmin` / `getCurrentAdmin`)

## Architecture Notes

- Server-rendered App Router application with focused client-side interactivity where needed
- JWT session strategy via Auth.js
- Prisma + PostgreSQL persistence for users, profiles, jobs, notifications, templates, and public job data
- per-user workspaces for private data isolation
- public job discovery with authenticated import into private workspaces
- request validation, sanitization, and lightweight rate limiting on important endpoints
- observability hooks for important route failures and product events

## Scoring Model

Job fit is personalized using profile and preference data such as:

- target job titles
- current and target seniority
- preferred stack and technologies
- location and timezone overlap
- remote preference
- salary expectations
- job signal quality and friction

Priority states are then used to surface what matters now, including:

- apply today
- apply this week
- follow up due
- interview soon
- prepare assets
- monitor
- skip

## Security and Reliability

- schema validation with Zod
- sanitized text, URL, and array inputs before persistence
- lightweight per-user and per-IP rate limiting on key routes
- structured error handling for API responses
- optional webhook-based alerting for important failures
- database indexes for common query paths
- resume files kept private, identified by magic bytes rather than filename or browser-supplied type, and read only on behalf of their owner
- AI extraction schema-constrained, re-validated against the source document, and given no tools; resume text is treated as untrusted data
- prompt content is never persisted, and resume contents never reach logs, analytics or error payloads

## Local Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create environment files

```bash
cp .env.example .env.local
cp .env.local .env
```

### 3. Configure environment variables

Minimum local setup:

```env
DATABASE_URL="postgresql://jobseekeros:password@localhost:5432/job_seeker_os?schema=public"
AUTH_SECRET="replace-with-a-long-random-secret"
AUTH_URL="http://localhost:3000"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

If you want email flows locally, also set:

```env
RESEND_API_KEY="re_xxxxxxxxx"
EMAIL_FROM="teChia Jobs <noreply@yourdomain.com>"
EMAIL_REPLY_TO="support@yourdomain.com"
```

For monetization and scheduled jobs, also set:

```env
# Where new upgrade requests are notified (server-side only)
ADMIN_NOTIFICATION_EMAIL="admin@yourdomain.com"

# Bearer token for /api/cron/*. At least 16 characters.
# Cron endpoints FAIL CLOSED without this — unreachable, not public.
CRON_SECRET="replace-with-a-long-random-secret-at-least-16-chars"

# Optional emergency kill switch: stops new trials from starting
MONETIZATION_ENABLED="true"
```

To shorten trials while developing, set `DEV_TRIAL_DAYS` (e.g. `1`). It is
ignored in production, so a stray value can never affect real billing.

If you want LinkedIn auth locally, also set:

```env
LINKEDIN_CLIENT_ID="your-linkedin-client-id"
LINKEDIN_CLIENT_SECRET="your-linkedin-client-secret"
```

For durable resume and avatar uploads in production, also set:

```env
BLOB_READ_WRITE_TOKEN="vercel_blob_rw_xxxxxxxxx"
```

For Resume Intelligence (Pro), also set:

```env
# Server-side only. Never prefix with NEXT_PUBLIC_ — anything public ships to
# the browser. Without this key the analysis endpoint returns a clear
# configuration error and never simulates a successful extraction.
OPENAI_API_KEY="sk-xxxxxxxxx"

# Optional. Must support Structured Outputs. Defaults to gpt-5.4-mini.
# RESUME_INTELLIGENCE_MODEL="gpt-5.4-mini"
```

No test needs an API key: the test suite injects a fake provider.

For the Resume Builder's job-specific optimisation, the same key is used — one AI
allowance across every AI feature, not several competing ones.

```env
# Optional. Must support Structured Outputs. Defaults to gpt-4.1-mini, the same
# model as job intelligence and chosen for the same reason.
# RESUME_OPTIMIZATION_MODEL="gpt-4.1-mini"
```

PDF export needs **no configuration at all**. Fonts ship with the application and
are embedded server-side at export time; nothing is stored.

Optional:

- `CORS_ORIGIN`
- `ALERT_WEBHOOK_URL`

### 4. Generate Prisma client

```bash
npm run prisma:generate
```

### 5. Apply migrations

```bash
npm run prisma:migrate:deploy
```

### 6. Optionally seed local data

```bash
npm run prisma:seed
```

### 7. Start the app

```bash
npm run dev
```

Open `http://localhost:3000`.

## Monetization

teChia Jobs monetizes through **manual plan upgrades**, not automated payment
collection:

```
user requests upgrade → admin reviews → admin contacts user (email/WhatsApp)
→ arrangement happens outside the app → admin confirms
→ plan activated → user notified
```

No payment provider is integrated. The subscription model already carries
provider-neutral fields (`billingProvider`, `externalCustomerId`,
`externalSubscriptionId`) so automated billing can be added later **without**
changing the entitlement engine.

### Plans

Three configurable tiers — **Free**, **Pro**, **Premium**. Prices are stored as
integer minor units and are currently `NULL` (undecided), so the UI renders
"Contact us" rather than inventing an amount. Plan definitions, feature
entitlements and limits live in `src/lib/billing/plans.ts`.

### Trials

New accounts get a **14-day Pro trial** starting at account creation. Existing
accounts receive the same 14-day window anchored to a single immutable launch
timestamp stored in `MonetizationConfig` — never to first login, onboarding, or
email verification. Trials never restart, and expiry downgrades to Free
**without deleting any user data**.

Admins bypass all plan entitlements and never consume customer quotas.

### Monetization commands

```bash
# Preview what would change — writes nothing
npm run monetization:initialize -- --dry-run

# Backfill trials and activate monetization
npm run monetization:initialize

# Read-only state report (users, trials, requests, email health)
npm run monetization:status

# Promote exactly one existing account to ADMIN (no self-service path)
npm run admin:bootstrap -- owner@yourdomain.com

# Demote an admin (refuses to remove the last one)
npm run admin:revoke -- owner@yourdomain.com

# Drain the email outbox and reconcile subscriptions manually
npm run maintenance:run
```

Monetization is **not** live until `npm run monetization:initialize` runs.
Until then no trials start and every user resolves to Free.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the design and
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the production rollout runbook.

## Scripts

```bash
npm run dev
npm run build
npm run build:vercel
npm run start
npm run lint
npm run typecheck
npm test
npm run prisma:generate
npm run prisma:migrate:dev -- --name your_change
npm run prisma:migrate:deploy
npm run prisma:migrate:status
npm run prisma:push
npm run prisma:seed
npm run prisma:studio
npm run monetization:initialize
npm run monetization:status
npm run admin:bootstrap
npm run admin:revoke
npm run maintenance:run
```

## Testing

Tests run against a real Postgres database (the billing logic uses row locks,
advisory locks and transactions that cannot be meaningfully mocked) using Node's
built-in test runner — no extra test framework dependency.

```bash
npm test
```

The suite refuses to run against a non-local, non-test database. Point
`TEST_DATABASE_URL` at a disposable database if you want to isolate it from your
development data.

Covered: trial semantics and idempotency, entitlement gating, upgrade requests
and their state machine, plan-change transactions and audit, cross-user
isolation, cron authorization, email failure isolation, usage limits
(including concurrency), and Resume Intelligence (format detection, archive-bomb
protection, evidence verification, prompt-injection containment, merge
behaviour, and the security regressions around cross-user access and privilege
escalation).

**No test needs an API key or makes a network call.** AI extraction is served
by an injected fake provider, and every resume fixture is generated in code — no
real resume and no binary blob is committed.

## Production DB Sync

The repository includes committed Prisma migrations. The expected workflow is:

- use `npm run prisma:migrate:dev -- --name your_change` whenever `prisma/schema.prisma` changes in development
- commit the generated `prisma/migrations/...` files with the schema change
- run `npm run prisma:migrate:deploy` against production **separately**, before or with the deploy

> **Migrations deliberately do NOT run inside the build.** `build:vercel` runs
> `prisma generate && next build` only. Previously the build ran
> `prisma migrate deploy`, which meant a **Vercel preview build could mutate the
> production database**. Keep schema changes as an explicit, reviewed step.

If production ever drifts, repair it once by syncing the schema, then mark the
baseline as applied — never reset production:

```bash
DATABASE_URL="your-production-url" npx prisma db push
DATABASE_URL="your-production-url" npx prisma migrate resolve --applied 20260417000100_init
```

For a **local** database that predates migration history, either reset it if it
is disposable:

```bash
npx prisma migrate reset
```

or mark the baseline as applied if the schema already matches:

```bash
npx prisma migrate resolve --applied 20260417000100_init
```

If production ever drifts again, repair it once by syncing the schema, then mark the baseline as applied:

```bash
DATABASE_URL="your-production-url" npx prisma db push
DATABASE_URL="your-production-url" npx prisma migrate resolve --applied 20260417000100_init
```

For an existing local database that predates migration history, either reset it if it is disposable:

```bash
npx prisma migrate reset
```

or mark the baseline as applied if the schema already matches:

```bash
npx prisma migrate resolve --applied 20260417000100_init
```

## Project Structure

```txt
src/
  app/
    (marketing)/
    (auth)/
    (app)/
    api/
  components/
  hooks/
  lib/
  types/
prisma/
public/
```

## Demo

The demo route highlights the current product surface:

- dashboard and queue workflows
- fit scoring
- pipeline tracking
- recruiter CRM
- interview prep
- streaks, notifications, and ingestion flows
- auth and onboarding improvements

## Branding

- product name: **teChia Jobs**
- parent company: **teChia Digital Solutions**
- tagline: *The AI-powered operating system for your job search.*

Public branding uses "teChia Jobs". Internal identifiers are intentionally unchanged to avoid migration and data risk:

- repository / package name: `job-seeker-os`
- Prisma models, migrations, and table names
- localStorage keys (`job-seeker-os.*`) so existing browser data keeps working
- the demo seed account (`demo@jobseekeros.dev`) and the example Postgres identifiers in the setup docs

## External Configuration Required After a Domain Change

Rebranding does not change external accounts. If the production domain changes, update these outside the repo:

- `NEXT_PUBLIC_APP_URL`, `AUTH_URL`, `AUTH_TRUST_HOST` (Vercel env)
- Auth.js / LinkedIn OAuth authorized redirect URL
- `EMAIL_FROM` / Resend verified sending domain
- Vercel Blob access (no change required unless the domain is used in signed URLs)
- Google Search Console + Bing Webmaster canonical property
- social preview images and profile links

## Status

This repository is actively evolving. Recent branch work expanded:

- onboarding and resume parsing
- notification and streak systems
- LinkedIn auth and password recovery
- queue workflows and dashboard depth
- marketing storytelling and product walkthroughs
- favicon and branding consistency

The next releases are expected to be much more AI-intensive, including:

- smart resume building
- AI job fetching and ranking // crawl as many top job boards as possible and display matching jobs to signed in users who are on the right pricing plan.
- AI-assisted auto-apply workflows
- smarter suggestions across queue, scoring, and execution
