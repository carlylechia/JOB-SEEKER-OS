# AI Cover Letters & Application Materials

teChia Jobs helps users create personalised, truthful professional application
materials from their actual background and the specific opportunity they are
pursuing.

This is a production feature: generation calls the configured AI provider,
output is verified server-side before anything is stored, and nothing is ever
sent automatically. The user always controls what goes to a recruiter,
employer or external platform.

---

## Supported material types

| Type | Target job needed? | Template source | PDF export | Editable DOCX |
|---|---|---|---|---|
| Cover letter | Yes | `intro` | Yes | Yes |
| Recruiter message | No | `intro`, `referral` | No | Yes |
| LinkedIn connection | No | `intro` | No | Yes |
| Application follow-up | Yes | `follow_up`, `check_in` | No | Yes |
| Application status check | Yes | `check_in`, `follow_up` | No | Yes |
| Interview thank-you | Yes | `thank_you` | No | Yes |

Follow-up, status check and thank-you are **application-grounded**: they are
only offered when the pipeline record genuinely supports the claim (the role
is at or beyond Applied, or an interview is recorded). The system never
invents an application or an interview.

Template categories map to the existing `FollowUpTemplate.type` vocabulary:
`intro`, `follow_up`, `thank_you`, `check_in`, `referral`.

---

## Source-of-truth hierarchy

Generated materials are built from, and checked against, this hierarchy:

1. User-confirmed structured career profile (`UserProfile` confirmed at
   `careerProfileConfirmedAt`)
2. Selected saved resume / tailored variant (`StructuredResume`)
3. The user's own job record and job description (`JobLead`)
4. A valid saved AI job-intelligence result (`JobIntelligenceAnalysis`) —
   treated as the model's reading, never as evidence about the employer
5. Actual application stage, dates and contacts (`JobLead.status`,
   `dateApplied`, `nextFollowUp`, `contacts`, `interviews`)
6. User-provided instructions and confirmed context
7. An existing user-authored draft, when explicitly selected

The raw resume file is never sent — only the structured, user-reviewed profile
or an explicitly selected built resume. Contact details, account identifiers
and other users' data are never included.

The material editor lets the user explicitly choose a saved structured resume.
When selected, its text is sent as labelled context and its own numbers,
employers, titles, skills and technologies are included in the server-side
claim checks. Without a selection, generation uses the confirmed career
profile only.

---

## Anti-fabrication safeguards

These are enforced in server code, not by asking the model nicely:

- **Greeting, sender name and sign-off are server-derived** from real values.
  An invented "Dear Mr Smith" is structurally impossible.
- **Every personal fact is listed as a claim** with a source and a verbatim
  excerpt. Excerpts are re-quoted against the real job text and profile; a
  quote that cannot be found is dropped.
- **Every number, percentage or multiplier in the prose must already appear in
  the candidate's records.** "Increased revenue by 60%" cannot survive unless
  the profile says 60%.
- **Employers, titles, degrees and credentials must name an organisation that
  actually appears in the candidate's records.** "Worked at MadeUpCo" is
  removed.
- **Unsupported sentences are removed from the draft and listed for review,**
  never left silently in the text.

The AI provider has **no tools** — no file access, no network, no database
writes, no messaging. Prompt injection is a wording problem, not a security
problem.

---

## Draft persistence and versioning

Materials are stored in the `ApplicationMaterial` table, owned by `userId`.

- A regeneration creates a **new row** chained through `supersedesId`; the
  previous draft is left intact. Nothing the user has reviewed is ever
  silently overwritten.
- `revision` numbers each draft in its chain (starting at 1).
- `editVersion` implements optimistic concurrency: the client echoes the
  version it loaded, and a mismatch is rejected with 409.
- `status` is `DRAFT | READY | ARCHIVED`. Archiving soft-deletes; revision
  chains stay meaningful.
- `jobId`, `resumeId` and `templateId` are optional and `SetNull` on deletion,
  so deleting a job, resume or template never destroys the user's writing.
- Reuse is keyed by the full generation input, including user instructions,
  tone, length, selected resume content, job facts and application context.
  Changing those inputs produces a fresh draft rather than returning a stale
  one.
- Private material is never written onto a shared `JobLead` and never exposed
  through public job APIs.

---

## Provider and model

The configured provider is OpenAI, using `responses.parse()` with
`zodTextFormat()` for schema-constrained output. Default model:
`gpt-4.1-mini`, overridable via `APPLICATION_MATERIALS_MODEL`.

There are **no tools**. The model returns a typed object
(subject, opening, body paragraphs, closing, claims, review notes, missing
information, unsupported items) — never a greeting, sign-off or recipient name.

Server-side verification re-checks every claim before anything is persisted.

---

## Entitlements

Access is governed by the existing `AI_COVER_LETTER` feature key
(`src/lib/billing/plans.ts`):

- Pro and Premium: granted
- Free: refused at the server with `PLAN_REQUIRED` (403); the UI shows an
  upgrade prompt linking to `/settings/billing`
- Active eligible Pro trial: granted during the trial window
- Expired trial: refused; server-side access checks are timestamp-derived,
  so an expired trial cannot bypass them
- Administrators: exempt, and never consume customer quotas

No new plan, limit, usage table or parallel quota system was added.

---

## Usage accounting

Generation consumes one unit from the shared `aiCredits` budget
(`PLAN_LIMITS.aiCredits`), the same budget used by AI Job Intelligence, Resume
Intelligence parsing and Resume Optimisation. One AI allowance, not several.

Usage is reserved **before** the provider call, inside a transaction with a
PostgreSQL advisory lock keyed on `(user, feature, period)`, so parallel
requests serialise and an idempotency key prevents double-charging on retry.

Copy, download, manual editing, opening a saved draft and viewing the library
do **not** consume a credit.

---

## Copy and download

- **Copy** writes the draft text to the clipboard. No AI call, no credit.
- **Download .txt** produces a plain-text file with the subject (if any) and
  body. No AI call, no credit.
- **Download PDF** (cover letters only) reuses the resume builder's `pdf-lib`
  renderer — no second PDF stack. The letter uses bundled-font metrics,
  structured applicant contact details from the selected resume/profile,
  today's date, and the actual saved company/job title when available. It does
  not add an invented recipient name or postal address. No AI call, no credit.
- **Download DOCX** uses semantic editable paragraphs and safe URL hyperlinks.
  Cover letters receive a restrained sender/date/company/subject block. Other
  materials remain message/email text with an optional subject and no forced
  letterhead. Word-compatible apps may repaginate the output.

All downloads are `private, no-store`, force-download, with safe server-derived
filenames.

---

## No automatic sending

This release generates and manages drafts only. Nothing is emailed, messaged,
submitted or posted externally. There are no "Sent successfully" buttons. The
user reviews, copies or downloads and sends independently.

---

## Database and migrations

New table `ApplicationMaterial` plus three enums
(`ApplicationMaterialType`, `ApplicationMaterialStatus`,
`ApplicationMaterialOrigin`). Migration files:

- `prisma/migrations/20261018212656_application_materials/`
- `prisma/migrations/20261018220000_application_material_unique/`

Apply with `npm run prisma:migrate:deploy`. Do not run `prisma db push` in
production.

---

## Environment variables

No new secrets. Reuses `OPENAI_API_KEY` (server-side only). Optional:
`APPLICATION_MATERIALS_MODEL` (defaults to `gpt-4.1-mini`).

## User-controlled generation parameters

When generating a draft, the user chooses:

- **Tone** (`PROFESSIONAL | CONFIDENT | WARM | CONCISE | FORMAL`) — changes
  *how* the draft is written, never *what* is claimed. Confidence comes from
  specificity, not from overstating.
- **Length** (`SHORT | STANDARD | DETAILED`) — target character budget for the
  body text, specific to each material type.
- **Instructions** — free-text style guidance. These are style/emphasis only;
  they can never add a fact that isn't in the candidate's verified records.
- **Conversation** — a pasted exchange the user supplies as context. Treated as
  unverified data; the model may refer to it but never assert that it happened.
- **Recipient name** — only used when the user supplies it from a saved contact
  or their own outreach. Never invented.
- **Source draft** — when revising, the current draft text is sent so the model
  improves it rather than starting from scratch.

These are sent to the model with every generation request. Tone and length are
validated against what is allowed for the selected material type; instructions,
conversation, recipient name and source draft are bounded by length and treated
as untrusted user input.

---

## Testing

`npm test` runs the Node test suite against a local Postgres database
(`TEST_DATABASE_URL` or `DATABASE_URL`). All AI calls are served by injected
fakes — no key, no network, no paid calls.

Tests added: `tests/application-materials.test.ts` — entitlement enforcement
(Free/Pro/Premium/trial/admin), generation (all six types, missing context,
foreign job, numeric fabrication, employer fabrication, timeout, reuse,
duplicate concurrency, malformed output), verification, persistence (save,
edit, revision chaining, archive, ownership isolation, no credit for
copy/download/edit).

---

## Deployment

1. Commit the schema and migrations.
2. Push to `main`; the deploy workflow runs `prisma migrate deploy` before
   verifying the deployment serves.
3. The `AI_COVER_LETTER` entitlement is already present in `plans.ts`; set
   `released: true` (done in this release) so Pro/Premium users can access it.
   No seed or backfill is required.

## Job details page integration

The job details page (`/jobs/[id]`) lists existing cover letters and
application materials for that job, with type, status, generation status,
subject and updated date. A "Create material" link pre-selects the target job,
so users can generate a cover letter directly from a job they are viewing.
