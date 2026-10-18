# Audit — Resume Builder & Job-Specific Optimization

Branch: `feat/pro-resume-builder-optimization`
Base: `origin/main` @ `2eaa50b`
Date: 2026-10-18

This is the audit required before the Resume Builder release. It records what
the repository already provides, what is genuinely missing, and which existing
systems this release reuses rather than replaces.

---

## 1. Prerequisite releases

All three named prerequisites are merged into `origin/main`:

| Release | Merge commit | Present |
| --- | --- | --- |
| Production Monetization & Entitlements Foundation | via `feat/techia-jobs-monetization-foundation` | yes |
| Resume Intelligence & Career Profile | `bd60a39` (#13) | yes |
| AI Job Intelligence & Match Explanations | `d1e54b8` (#14) | yes |

`feat/admin-password-recovery` (the branch that was checked out) is **not**
merged and is unrelated to this release; it was left untouched.

---

## 2. Stack

| Concern | Actual state |
| --- | --- |
| Next.js | `15.5.27`, App Router, `typedRoutes: false` |
| React | `19.0.0` / `19.0.4` |
| Node | `>=22` (engines), local `v22.13.0` |
| TypeScript | `5.8.2`, `@/*` → `src/*`, strict |
| ORM | Prisma `6.16.1`, PostgreSQL, `prisma-client-js` |
| Migrations | `prisma migrate deploy` on merge; `prisma:push` exists but is **not** the production mechanism |
| Tests | `node:test` + a hand-rolled `expect` in `tests/harness.ts`; `npm test` |
| Lint / typecheck | `next lint`, `tsc --noEmit` |
| Deploy | Vercel, `buildCommand: npm run build:vercel`, Node runtime |
| Tailwind | `3.4.17`, CSS custom-property design tokens |

### Conventions that constrain this release

- **Security headers** are set in `next.config.ts`, including
  `object-src 'none'`, `frame-ancestors 'none'` and a CSP whose `connect-src`
  does **not** include OpenAI. Any PDF generation must therefore stay
  server-side.
- **Typecheck uses two tsconfigs.** `next build` typechecks with
  `tsconfig.build.json` (tests excluded); `npm run typecheck` uses
  `tsconfig.json` (tests included).
- `prisma.config.ts` exists only as `.bak`; Prisma is configured through
  `package.json` + `.env`.

---

## 3. Design system

`tailwind.config.ts` defines **two parallel palettes**, and mixing them is the
main trap:

- A fixed brand palette (`gold #D4AF37`, `champagne`, `silver #C9CED6`,
  `charcoal #17191E`, `obsidian`, `graphite`, `warmwhite`, `slate`).
- Themed **semantic tokens** declared as `R G B` triplets in
  `src/app/globals.css` and consumed via `rgb(var(--x) / <alpha-value>)`.

There are **no React primitives for buttons, cards, dialogs or inputs**. The
primitives are CSS component classes in `@layer components`: `.card`,
`.card-pad`, `.btn`, `.btn-primary`, `.btn-secondary`, `.input`, `.select`,
`.badge`, `.title`, `.muted`, `.table`, `.table-wrap`, `.shell`.

Only a handful of React components are genuinely shared
(`PageHeader`, `ScoreBadge`, `StatusBadge`, `PlanBadge`, `PlanRequiredCard`,
`FeatureComparisonTable`, `Logo`, `ThemeSwitch`, `MultiSelectCombobox`). **No
second component library is introduced by this release.**

`globals.css` sets `overflow-x: clip` on `html, body` (deliberately not
`hidden`, which would break `position: sticky`), and a global `:focus-visible`
ring driven by `--focus-ring`.

---

## 4. Existing resume data model

`ResumeDocument` already exists and means **an uploaded file**:

```
ResumeDocument(id, userId, url, fileName, format, sizeBytes, isPrimary)
```

It stores a pointer to a stored PDF/DOCX/TXT plus the size and sniffed format.
It has **no editable content**. `UserProfile.resumeUrl` remains the "primary
resume" pointer used by the existing download, onboarding and profile flows and
this release must not change how it behaves.

Related existing tables: `ResumeExtraction`, `CareerRecordSource`,
`CareerExperience`, `CareerEducation`, `CareerSkill`, `CareerProject`,
`CareerCredential`.

### Consequence

A structured, editable resume **cannot** be modelled on `ResumeDocument` without
destroying the upload contract that `resume/file`, onboarding, the profile page
and the extraction pipeline all depend on. This release therefore adds a
**separate, additive** structured document model, and leaves every existing
column, route and flow untouched.

---

## 5. Career profile

`UserProfile` carries confirmed career fields (`name`, `phone`, `summary`,
`websiteUrl`, `linkedinUrl`, `portfolioUrl`, `location`, `headline`,
`careerProfileConfirmedAt`, `careerProfileVersion`) and owns the relational
career tables listed above.

Optimistic concurrency is **already solved** by `careerProfileVersion`, and
`src/lib/resume/career-profile.ts` enforces *merge, not overwrite* plus *no
silent deletion*.

### Consequence

The builder reads the profile to populate a new resume. It never writes back.
Resume edits and career-profile edits stay independent records.

---

## 6. Job model and ownership boundaries

`JobLead(id, userId, company, title, jobDescription?, score, checklist, …)`,
with `@@index([userId, …])` on every access pattern. A soft delete is
`deletedAt`.

`src/lib/job-intelligence/deterministic.ts` resolves a job with
ownership scoping; a job belonging to another user yields `null`, which the
service turns into `JobNotFoundError` — a 404 deliberately identical to a job
that does not exist.

Public jobs are a **separate import policy** (`src/lib/public-jobs.ts`,
`/api/public-jobs/[id]/save`). Targeting optimisation must therefore be offered
only against the caller's own `JobLead` rows.

### Consequence

Resume targeting reuses `JobLead` and the same ownership-scoped lookup. No new
job-visibility rules are introduced and the existing title filters and
per-user scoring are not weakened.

---

## 7. Job-intelligence output

`JobIntelligenceAnalysis(userId, jobId, schemaVersion, inputFingerprint, status,
data, errorCode, provider, model, jobTextTruncated)` with a **unique index on
`(userId, jobId, inputFingerprint, schemaVersion)`** that is simultaneously the
cache key and the in-flight lock.

The contract in `src/lib/job-intelligence/schema.ts` is a strict, pure Zod
schema (no `.refine`, no `.transform` — OpenAI Structured Outputs refuses them)
and carries **no numeric score field**: the deterministic score is computed by
`src/lib/scoring.ts` and re-applied server-side in `verify.ts`.

This release **reuses** the analysis rather than re-deriving fit. It is read for
context only; no new fit logic is written.

---

## 8. AI provider boundary

There is **no single centralised `ai/` module**. There are two sibling
provider boundaries that deliberately follow the same pattern:

- `src/lib/resume/ai-client.ts` → `ResumeAiProvider.extract(resumeText)`
- `src/lib/job-intelligence/ai-client.ts` → `JobIntelligenceAiProvider.analyse(…)`

Both use `openai@^7.38.0` + `responses.parse({ text: { format: zodTextFormat(…) } })`,
pass **no tools**, validate the parsed output again with Zod, override the
model-echoed `schemaVersion` with the server's own, and map failures to a closed
set of codes. Each exposes `__set…ProviderFactory` so tests can substitute a
fake.

### Consequence

Resume optimisation gets a **third sibling boundary**
(`src/lib/resume-builder/optimization/ai-client.ts`) following the same
conventions, rather than being bolted onto either existing one. The provider
and SDK are unchanged; only the contract differs.

---

## 9. Entitlements, usage and rate limiting

`src/lib/billing/subscriptions.ts` is the single source of truth:

- `getEffectiveSubscription()` derives access from **timestamps**, never from a
  stored `status` column.
- Admins bypass the plan table entirely and are recorded as zero usage.
- `requireEntitlement(userId, feature)` throws `PlanRequiredError` (403).
- `buildEntitlements()` / `getEntitlements()` expose
  `features: Record<FeatureKey, boolean>` and
  `limits: { jobs, resumes, aiCredits }`.

`src/lib/billing/usage.ts` meters every AI capability from **one** table
(`UsageRecord`) with a PostgreSQL transaction-scoped **advisory lock** keyed on
(user, feature, period) — a read/check/write race is explicitly avoided. An
`idempotencyKey` prevents double-charging a retry.

`src/lib/rate-limit.ts` is an in-memory per-instance burst limiter.

Feature keys already defined but **not yet released**:
`RESUME_BUILDER`, `RESUME_OPTIMIZATION` (both `['PRO','PREMIUM']`,
`released: false`), plus `AI_COVER_LETTER`, `AI_INTERVIEW_PREP`,
`PRIORITY_QUEUE`, `ADVANCED_PREPARATION`, `LINKEDIN_ENRICHMENT`.

### Consequence

This release **ships** `RESUME_BUILDER` and `RESUME_OPTIMIZATION` by flipping
`released` to `true`. It introduces **no new feature key, no new plan, no new
limit and no parallel quota system**. PDF export consumes no AI credit and
needs no key of its own — a built resume cannot exist without
`RESUME_BUILDER`, so a separate gate would be invented restriction.

---

## 10. Private file storage

`src/lib/durable-upload.ts` stores resumes as **private** Vercel blobs
(`BLOB_ACCESS.resume = 'private'`) with a local `public/uploads/resumes`
fallback for development.

`src/lib/resume/documents.ts` is the only module that reads them:
`isTrustedStorageUrl()` accepts only `/uploads/**` or `*.blob.vercel-storage.com`,
`readLocalUpload()` resolves and compares paths to defeat traversal, and
`loadOwnedResumeDocument({ userId, resumeId })` scopes every read to the owner.
A browser-supplied storage path is never trusted.

### Consequence

Generated PDFs are **not stored at all**. They are produced on demand from the
authorised structured document and streamed through an authenticated route.
No permanent public URL is ever created, and no new storage surface is added.

---

## 11. Observability

`src/lib/observability.ts` exposes `logImportantInfo` (console) and
`logImportantError` (console + Discord webhook, `ALERT_WEBHOOK_URL`, errors
only). Context is JSON-serialised and truncated.

### Consequence

High-value events only: create, update, duplicate, delete, export
succeeded/failed, optimisation requested/succeeded/failed, entitlement denied,
usage limit reached, save conflict. Ordinary edits and autosaves are **not**
alerted. No resume content, prompt text, profile JSON or token ever enters a log
context.

---

## 12. Testing

`node:test` + `tests/harness.ts` (custom `expect`). Integration tests need a
real Postgres; `tests/setup.ts` refuses any database that is neither local nor
test-named. AI providers are replaced with fakes through the
`__set…ProviderFactory` seams.

`unpdf@^1.9.0` is already a dependency (used by `extract-text.ts` to read
uploaded PDFs) and is reused here to **verify** generated PDFs in tests.

No Playwright or equivalent exists in this repository, so no end-to-end browser
suite is added. End-to-end coverage is exercised at the service and contract
layer instead.

That layer has one real limitation worth naming at audit time: a Next.js App
Router module may only export HTTP verbs, so **nothing defined inside a route
file can be imported by a test**. The request schemas and the PDF download
headers were therefore moved into `src/lib/resume-builder/requests.ts` and
`download.ts`, where they are domain contracts that production and the tests
share. Asserting against a copy would let production drift from what the tests
claim to cover. The route handlers themselves are covered by a structural test
that reads each module and asserts it derives identity only from the session.

---

## 13. PDF generation — options evaluated

| Option | Verdict |
| --- | --- |
| Browser print button labelled "export" | Rejected: not a PDF download |
| `puppeteer` / headless Chrome | Rejected: ~300 MB Chromium, a poor fit for the Vercel function budget, and a second layout engine that cannot guarantee preview parity |
| `@react-pdf/renderer` | Rejected: a second React reconciler inside an App Router app is a bundling hazard, and its font handling is the same problem solved less directly |
| **`pdf-lib` + `@pdf-lib/fontkit` + a real TTF** | **Chosen** |

Measured on this machine, Node 22.13:

- `pdf-lib` + the **standard** Helvetica fonts: no Unicode beyond WinAnsi —
  `José`, `Müller`, `Ø Å æ ø` pass, `Иван`, `Αλέξανδρος`, `東`, `🎯` throw
  `WinAnsi cannot encode`.
- `pdf-lib` + **WOFF2** (`@fontsource/inter`): glyph coverage looks fine but
  fontkit cannot detect the file type, the subsetter throws
  `RangeError: Index out of range`, and with subsetting disabled the extracted
  text comes back as `JJJJ JJJJJJ` — i.e. **not selectable**. Rejected.
- `pdf-lib` + **WOFF2**, subset on: the subsetter crashes outright.
- `pdf-lib` + **TTF** (Inter, OFL-1.1) + `fontkit`, subset
  on: `unpdf` extracts the text perfectly, **but the embedded font stream has no
  usable glyph outlines** — most renderers draw a sparse, nearly blank page.
  Rejected. This was only caught by rasterising the output and looking at it;
  text extraction alone gave a false pass.
- `pdf-lib` + **TTF**, subsetting done by fontkit 2.x and handed back to
  pdf-lib: does not parse (`TTFFont.get` on a table the v2 subsetter omits).
- `pdf-lib` + **TTF**, subset **off**: renders correctly everywhere, text is
  selectable, 3 pages in ~80 ms. Chosen, at ~180 KB per weight.

The chosen option costs file size; the reasoning, including why the trade was
made, is in [`RESUME_BUILDER.md` §7](./RESUME_BUILDER.md#7-pdf-export).

**Font coverage, stated precisely.** The chosen face covers Latin, Latin
Extended-A, Greek and Cyrillic. It does **not** cover CJK or emoji. Rather than
let that pass silently, `LayoutMetrics.unsupportedCharacters()` checks every
drawable string against the font's real character set and the layout reports the
unrepresentable characters. The tests assert that report exists instead of
leaving the case out.

### Layout parity

The chosen architecture is a **single layout engine**
(`src/lib/resume-builder/layout.ts`) that turns structured content into
paginated, absolutely-positioned blocks in PDF points. The PDF renderer and the
HTML preview are two renderers of the *same* block list, so the preview cannot
drift from the export. Neither the engine nor `pdf-lib` is imported by the
client editor bundle — verified against the production build output, where no
client chunk contains either.

---

## 14. What is genuinely missing

1. No structured, editable resume document — only an uploaded file pointer.
2. No resume editor, section management or reordering.
3. No template system of any kind.
4. No PDF export.
5. No linkage between a resume and a target job.
6. No AI operation that proposes changes to a resume.
7. `RESUME_BUILDER` and `RESUME_OPTIMIZATION` are defined but unreleased.

Everything else this release needs — identity, plans, entitlements, usage
accounting, rate limiting, observability, career profile, job intelligence, AI
provider conventions, private storage, the AI error envelope — already exists
and is reused.