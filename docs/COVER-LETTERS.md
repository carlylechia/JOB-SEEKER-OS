# Cover Letters & Application Materials

teChia Jobs — Pro Release 5.

This document describes the cover letter feature: how users generate
job-specific cover letters from their actual career profile and a real job
description, edit them, and save them for applications.

## 1. Workflow

From a saved job:

1. Open the job (`/jobs/[id]`) and choose **Create cover letter**, or open an
   existing letter from the Cover Letters list (`/cover-letters`).
2. The server generates a tailored cover letter from the actual job
   description, your career profile, your selected resume and the job's fit
   score. The letter names the role and company, connects two or three specific
   experiences from your profile to specific requirements in the posting, and
   stays to one page.
3. Open the letter (`/cover-letters/[id]`) to preview it. Edit the subject and
   body, then save. Edits are your own writing and consume no AI credits.
4. Return later and continue. The letter is persisted server-side and reloads
   on return; a refresh never erases your edits.
5. Mark the letter SENT when you've applied, or ARCHIVED if you no longer need
   it. Previous versions are preserved when you regenerate.

## 2. Data model

One table extends the existing job workspace:

- `CoverLetter` — user-owned, job-targeted letter. Fields: title, content,
  subject, salutation, sign-off, status (DRAFT | GENERATED | SENT | ARCHIVED),
  schema/prompt versions, `inputFingerprint` for staleness and duplicate
  suppression, version number, `keyClaims` (evidence-backed claims the letter
  makes), `limitations` (honest input gaps), `thinInputs` flag and timestamps.
- One letter per `(userId, jobId, inputFingerprint)`: the unique index doubles
  as the duplicate-generation lock, so identical requests are not charged
  twice. Regenerating preserves the previous letter as an archived, superseded
  row and creates a new versioned row.

All user relations cascade on delete.

## 3. Quality bar

A cover letter is "worth paying for" only when it is:

- **Specific to the actual job.** Names the role and company in the opening.
  Not a template with [Company] swapped in.
- **Grounded in real experience.** Connects specific profile experiences to
  specific posting requirements. No fabricated companies, metrics, roles or
  dates.
- **Honest about gaps.** Flags missing information as limitations rather than
  inventing a generic letter.
- **Editable by the user.** The model proposes; the person decides what to
  send.

## 4. AI provider and model configuration

- Provider: OpenAI (Responses API, `responses.parse` with `zodTextFormat`
  structured outputs). No tools, no web search, no code interpreter.
- Model: `gpt-4.1-mini`, overridable via `COVER_LETTER_MODEL` (read in one
  place, `src/lib/cover-letter/ai-client.ts`). This is the quality model used
  for resume optimization and job intelligence — cover letters are persuasive
  documents a user sends to an employer, so they use the quality model, not
  the cheapest extraction model (`gpt-4o-mini`, used for resume extraction
  where accuracy was identical across candidates).
- Timeout 45s.
- All AI work is server-side. API keys and model config never reach the
  browser.
- Every model output is re-validated server-side
  (`src/lib/cover-letter/verify.ts`), even though the provider offers
  structured output.

## 5. Anti-hallucination verification

Every generated letter is verified before storage
(`src/lib/cover-letter/verify.ts`):

- **Evidence re-quoted.** Any excerpt attributed to the job posting is looked
  up in the actual posting text; a quote that cannot be found is dropped.
- **Personal experience re-checked.** If the letter names "your API
  integration project", that project must exist in the user's actual profile.
  Unsupported references lose their quote but the claim stays general.
- **Unsupportable claims stripped.** No flattery ("world-class leader", "I
  admire your mission"), no promises ("guarantee you an interview"), no legal
  determinations, no capability assertions about the person.
- **Gaps flagged.** Missing description, thin profile or no matching
  experience surface as limitations so the user can fill them in.

## 6. Entitlements and usage accounting

- Feature key: `AI_COVER_LETTER` (Pro and Premium), now `released: true` in
  the entitlement registry (`src/lib/billing/plans.ts`).
- Cover letters draw on the shared `aiCredits` allowance — one AI allowance,
  not several competing ones. Plan limits: FREE 25, PRO/PREMIUM unlimited.
- Before any AI call: authenticate → entitlement → resolve inputs → fingerprint
  → usage reservation (advisory lock + idempotency key) → provider → verify →
  persist.
- Reading a saved letter, reviewing claims or navigating the UI consumes
  nothing. Duplicate concurrent or retried requests with the same idempotency
  key are not charged twice.
- Admins are exempt and consume zero customer credits. Expired trials fail
  closed (timestamp-derived, not cron-derived).

## 7. Privacy boundaries

- Letters are private to the authenticated user. Ownership is part of every
  query; another user's letter is a 404, never a 403.
- The raw resume is never sent to the provider — only a bounded summary of the
  confirmed career profile (built by Resume Intelligence).
- Only the minimum authorised data is sent for each operation.
- Letter content is not logged in full.
- Deletion cascades with the user/job.

## 8. Prompt-injection safety

- The system prompt establishes that job descriptions, resumes and profiles are
  untrusted third-party data, not instructions.
- The model gets no tools, so it cannot invoke network, file or privileged
  operations.
- Supplied text is fenced so it cannot terminate the data section early.
- No employer flattery, fabricated experience, or guaranteed outcomes are
  emitted.

## 9. Error recovery

- Provider failures, timeouts, rate limits, empty and malformed output, schema
  validation failure and oversized output are mapped to safe user-facing
  messages through `src/lib/cover-letter/route-errors.ts`.
- Provider messages, stack traces and Prisma details never reach the browser.

## 10. Database migration

`prisma/migrations/20261019130000_cover_letters/migration.sql` creates
`CoverLetter` with foreign keys, cascades and indexes. It is non-destructive
and verified with `prisma migrate diff` producing an empty diff. Apply with
`npm run prisma:migrate:deploy`.

## 11. Local setup

1. Copy `.env.example` to `.env.local` and set `DATABASE_URL` to a local
   Postgres.
2. `npm install` (runs `prisma generate` via postinstall).
3. `npm run prisma:migrate:dev` to apply migrations locally.
4. `npm run monetization:initialize` to seed plans and feature entitlements.
5. `npm run dev` to start.
6. Tests: `npm test` (integration tests need `TEST_DATABASE_URL` or a local
   `DATABASE_URL` and refuse non-test databases).
7. `npm run typecheck` and `npm run build` for validation.

## 12. What this release deliberately does not include

- A second AI provider or orchestration framework.
- Automatic sending of letters to employers (the user decides when and how to
  send).
- Gamification, streaks or badges.
