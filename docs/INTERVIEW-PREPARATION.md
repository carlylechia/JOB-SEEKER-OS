# Interview Intelligence & Preparation Packs

teChia Jobs — Pro Release 6.

This document describes the interview preparation feature: how users create
employer-specific, role-specific preparation packs, what the pack contains, how
company research is bounded and cited, how practice and mock interviews work,
and how the feature is authorised, metered, persisted and operated.

## 1. Workflow

There are three entry points:

1. **From a saved job.** Open `/jobs/[id]` and choose **Create AI prep pack**.
   The job, company, posting URL and description are copied into the pack.
2. **From the prep workspace.** Open `/interview-prep` for the pack list, or
   `/interview-prep/new` to start from a saved job, import a public job URL, or
   enter the role manually.
3. **From the dashboard or Queue.** Preparation recommendations deep-link to the
   relevant pack or to a new pack for a job that is approaching interview stage.

The new-pack form captures:

- employer, role title, location, posting URL and job description;
- optional official company website, careers page and up to four additional
  research URLs;
- interview date/time, or a coarse timing horizon when no exact date exists;
- interview type: a high-level track (behavioural, technical, case study,
  role/company, or mixed) plus the precise format/context (recruiter screen,
  hiring manager, behavioral, technical, system design, project discussion,
  problem solving, situational, final round, questions to ask, or balanced);
- optional interview language, interviewer/panel details, invitation notes,
  concerns and focus topics.

The type selection is not cosmetic. It changes the question mix, coaching,
answer frameworks, fallback tasks and feedback rubric emphasis. A behavioural
pack builds an example bank around real past experience; a technical pack tests
reasoning, debugging and trade-offs; a case-study pack practises structured
analysis; a role/company pack focuses on motivation and employer understanding;
a mixed pack deliberately spans several formats. The user-selected context is
persisted as the source of truth and is never overwritten by provider output.

A pack can be saved as a **draft** without spending a credit. Generation, and
later regeneration, are explicit paid AI operations. Opening, reading and
practising a saved pack never consumes credits, even after a plan lapses.

## 2. What a pack contains

The workspace has nine tabs:

| Tab | Contents |
|---|---|
| Briefing | Role summary, top priorities, strongest evidence, gaps, sourced company facts and one next action. |
| Company | Company overview, products, customers, mission, values, culture notes, recent developments and role context. Every claim carries `SOURCE` or `INFERENCE` basis and source indexes where applicable. |
| Role | Responsibilities, requirements, competencies, likely challenges and an occupational-family classification. Requirements show whether evidence was found, its source, confidence and a preparation action. |
| Evidence | A bank of the candidate's own examples, what each supports, missing details and whether the profile item is confirmed. |
| Questions | Predicted interview questions with category, difficulty, competency, why it matters, related requirement, relevant candidate evidence, coaching, answer structure, pitfalls and follow-up questions. |
| Plan | A time-based preparation plan grouped by horizon, with completion state. Tasks are generated but also fall back deterministically so the plan is never empty. |
| Mock interview | A persisted sequence of questions selected from the pack by focus (full, behavioral, role-specific, company/motivation, weak area, quick). Each answer can be evaluated for a score, strengths, improvements and a standard answer. The candidate must confirm the evaluation before advancing, or explicitly skip it after a warning. Answers, evaluations and session summaries are stored. |
| Cheat sheet | A print-friendly one-page summary of the most important facts, examples, questions to ask, logistics, reminders and unknowns. |
| Sources | The exact stored research sources, their fetch/verification status, provenance and excerpts. |

Questions are always marked as predictions. The feature never presents generated
questions as actual employer questions.

## 3. Company research and provenance

There is **no web search and no scraping service**. Research is limited to pages
the user explicitly supplies:

- the job description (always source index 0 when present);
- the company website;
- the careers page;
- up to four additional official URLs.

The server fetches each URL with hostile-input protections:

- only `http` and `https`;
- no embedded credentials and only ports 80/443;
- DNS resolution rejects loopback, private, link-local, CGNAT, multicast,
  documentation and cloud-metadata addresses (IPv4 and IPv6);
- every redirect is revalidated with the same rules, with a bounded redirect
  count;
- content types are limited to HTML, XHTML and plain text;
- response bytes, extraction size, per-request time and total research time are
  bounded;
- no JavaScript, browser, cookies or authenticated sessions are used.

Research status is one of:

- `NOT_STARTED` — no generation attempt yet;
- `COMPLETED` — every supplied source was read;
- `PARTIAL` — at least one source was read and at least one failed;
- `NOT_AVAILABLE` — no official sources were supplied;
- `FAILED` — supplied sources could not be read.

Each source records its URL, canonical URL, title, publisher, publication date,
retrieval date, excerpt, fetch status (`FETCHED`, `FAILED`, `USER_SUPPLIED`) and
verification (`SOURCE_BACKED`, `UNVERIFIED`, `USER_SUPPLIED`). Failed sources
remain visible with an error code and a plain-language limitation; they are not
silently replaced with invented facts.

Generated company claims use a strict basis:

- `SOURCE` claims must cite at least one usable source index. A `SOURCE` claim
  with no valid source is dropped.
- `INFERENCE` claims are allowed only where the model is explicitly reasoning
  from the job description or supplied material, and are labelled as inference.

When research is unavailable, pack generation still proceeds from the job
description and the candidate's profile, and the limitations say exactly that.

## 4. Question bank and answer coaching

Question categories include technical fundamentals, applied problem solving,
architecture and trade-offs, behavioral, communication, ownership,
collaboration, handling ambiguity, debugging, project decisions, role scenarios
and employer questions.

The selected interview track controls deterministic question ranking and
fallback material even when the provider proposes a generic mix. For example, a
technical mock ranks technical fundamentals, applied reasoning, architecture,
debugging and project decisions ahead of behavioural questions, while a
behavioural mock ranks behavioural, collaboration, ownership and ambiguity
questions first. The provider still authors the questions, but the server keeps
the pack aligned with the format the candidate chose.

Each question includes:

- a category, difficulty, competency and priority;
- why the interview question matters and which requirement it tests;
- the candidate's relevant evidence, only when it appears in their confirmed
  profile or structured resume;
- coaching: what the interviewer assesses, key points, a practice exercise and a
  structure-only wording placeholder;
- a suggested answer framework (`STAR`, `TECHNICAL`, `ARCHITECTURE`, or none);
- what a strong answer shows, common pitfalls and bounded follow-ups.

Frameworks are prompts, not scripts to memorise. A placeholder contains
bracketed structure, never a fabricated personal story.

## 5. Practice, feedback and mock interviews

Submitting a written answer creates a numbered attempt. Attempts are preserved;
a second answer to the same question is marked `REVISION`. Saving an answer is
free and does not require a live paid plan beyond reading the pack.

Feedback is a separate, metered AI operation. The rubric is category-aware:
only dimensions that make sense for the question are scored. A written answer
that is too short yields `INSUFFICIENT_EVIDENCE` rather than a guess. Feedback
includes:

- an honest overall **score out of 10**, anchored to a fixed rubric
  (0–2 off-topic/broken, 3–4 partial, 5–6 competent but thin, 7–8 strong,
  9–10 exceptional);
- a short **score rationale** explaining why that score was awarded;
- **what worked** and **what to improve**, written about the candidate's actual
  words;
- a prominent **standard/model answer** to the exact question, ready to say
  aloud. Personal facts that are not in the candidate's evidence use
  `[bracketed placeholders]`; the model must never invent an employer, metric,
  project or outcome;
- what was missing, a structure suggestion, a stronger structure, bounded
  follow-up practice and an optional adaptive follow-up.

Feedback evidence quotes are checked against the submitted answer. A quote that
does not appear is removed. Feedback never guarantees an outcome or predicts a
hiring decision.

Mock sessions are server-selected and persisted. A session stores its mode,
ordered question IDs, status, timestamps and a summary derived from the latest
attempt per question. Starting a session is free; evaluation remains metered per
answer. Starting a new session closes any previous active session for the pack.
The default mock focus follows the pack's interview type, and the server ranks
questions using that type before priority.

The mock UI enforces a deliberate review step:

1. the candidate writes and submits an answer;
2. they choose **Evaluate answer with AI** (the answer is saved first if needed);
3. the evaluation appears score-first, with the standard answer;
4. they choose **Save evaluation & continue** to advance. The evaluation is
   already persisted; this action confirms they have read it.

A **Skip without evaluation** path exists but always shows a confirmation
warning that the answer will not receive a score or standard answer. Any
written answer is still saved first, because saving is free; only the metered
evaluation is skipped. A saved answer is never auto-advanced just because it was
submitted. Session summaries show the average score across the latest scored
attempt per question and how many questions were scored.

Feedback generation is idempotent. Re-requesting an existing scored evaluation
returns it without a provider call or a charge. Feedback generated before
scoring existed can be repaired once for free using the same idempotency key;
only a genuinely new answer consumes another credit. Question-attempt reads can
be scoped with an optional `sessionId`, so a mock session only sees its own
answers and cannot be advanced by attempts from an older session.

## 6. Preparation plan and readiness

The plan is time-based: `WITHIN_24_HOURS`, `TWO_THREE_DAYS`, `WITHIN_A_WEEK`,
`MORE_THAN_A_WEEK` or `UNKNOWN`. An exact interview date takes precedence over
the coarse timing supplied by the user. Moving the date recalculates horizons
and order while preserving completed tasks.

The model may propose tasks, but a deterministic fallback fills gaps so a pack
always has a usable plan. Tasks cover priorities such as practicing high-value
questions, preparing evidence, confirming logistics, reading supplied sources,
addressing a stated concern, running a mock interview and choosing questions to
ask the employer.

Readiness is a descriptive summary of persisted work:

- preparation coverage (completed tasks / active tasks);
- practice evidence (questions attempted, feedback received, mock sessions
  completed);
- research completeness;
- unresolved evidence gaps;
- unresolved high-priority tasks;
- explicit limitations.

Levels are `STARTING`, `BUILDING`, `PRACTISING` and `WELL_PREPARED`. None of them
is a prediction of the employer's decision, and the API/UI state that
limitation.

## 7. Personalisation and anti-fabrication safeguards

- Candidate context comes from the existing confirmed career profile, job
  preferences and an optional structured resume. There is no parallel career
  profile.
- The full resume file is not sent to the provider. Only a bounded text extract
  from the structured resume and profile is used.
- A candidate evidence quote is kept only when it appears in that evidence
  corpus. Unsupported quotes are removed even when the rest of the question
  survives.
- The model receives no tools, browsing, code execution or file access.
- Job descriptions, profiles, resumes, answers, interviewer notes and research
  pages are treated as untrusted data, fenced in the prompt and never as
  instructions.
- Full answers, resumes, profiles, prompts and feedback are not logged.
- The model cannot invent company sources: `SOURCE` claims without a valid
  index are dropped by server-side verification.
- When candidate evidence is thin, the pack says personalisation is limited
  rather than filling the gap with invented experience.

## 8. Data model

The feature extends the existing interview-prep tables rather than creating a
parallel tracker:

- `InterviewPrepPack` — user-owned, optionally linked to a `JobLead`. Stores a
  snapshot of employer, role, location, posting URL, description, research URLs,
  interview metadata, status, research status, input fingerprint, dedupe key,
  validated section content, guidance, limitations, progress counters and
  timestamps. A unique `dedupeKey` prevents duplicate generation for identical
  inputs. It is derived from the same identity as the
  `(userId, jobId, inputFingerprint)` composite unique index and is rewritten
  whenever regeneration stores a new fingerprint. Creation also falls back to
  that composite index so packs written before the key existed stay reusable.
- `InterviewResearchSource` — one row per retained source, with position,
  provenance, fetch status, verification and excerpt.
- `InterviewQuestion` — versioned questions. Regeneration deactivates the old
  set instead of deleting it, so attempt history stays attached to the version
  it was taken against.
- `InterviewPracticeAttempt` — numbered answers, version reference, kind,
  optional parent/follow-up, feedback JSON and rubric key. Feedback JSON now
  carries `score`, `scoreRationale` and `modelAnswer` alongside the rubric
  dimensions and coaching fields; the columns themselves are unchanged.
- `InterviewPracticeSession` — persisted mock session with mode, question IDs,
  status, summary and timestamps. The summary JSON includes `averageScore` and
  `scoredAttempts` for the latest attempt per question.
- `InterviewPrepTask` — plan task with stable key, horizon, priority, category,
  estimated minutes and completion state.

All user-facing relations cascade on delete. Indexes cover ownership-scoped
reads, pack lists, interview dates and per-question history.

Pack statuses are `DRAFT`, `RESEARCHING`, `GENERATING`, `READY`,
`PARTIALLY_READY`, `FAILED` and `ARCHIVED`. A partially ready pack is one with a
usable but thin question bank or plan; it remains fully readable.

## 9. API surface

| Route | Purpose |
|---|---|
| `GET /api/interview-prep` | List the caller's packs and entitlement metadata. |
| `POST /api/interview-prep` | Create or reuse a pack; generate immediately or save a draft. |
| `GET /api/interview-prep/[packId]` | Full workspace payload: content, questions, sources, tasks, sessions, readiness and practiced IDs. |
| `PATCH /api/interview-prep/[packId]` | Update metadata, interview details, research sources or archive/restore. |
| `DELETE /api/interview-prep/[packId]` | Archive a pack; history is kept. |
| `POST /api/interview-prep/[packId]/regenerate` | Regenerate with force, metered. |
| `GET/POST /api/interview-prep/[packId]/questions/[questionId]` | Load a question and attempts (optionally scoped with `?sessionId=`), or submit an answer. |
| `POST /api/interview-prep/[packId]/attempts/[attemptId]/feedback` | Metered, idempotent evaluation for one attempt. |
| `GET /api/interview-prep/[packId]/progress` | Persisted progress and readiness. |
| `POST/GET /api/interview-prep/[packId]/sessions` | Start or list mock sessions. `mode` is optional and defaults from the pack's interview type. |
| `GET/PATCH /api/interview-prep/[packId]/sessions/[sessionId]` | Load a session or complete it. |
| `PATCH /api/interview-prep/[packId]/tasks/[taskId]` | Complete or reopen a preparation task. |
| `POST /api/interview-prep/import-url` | Bounded, SSRF-safe import of a public job posting for review. |

Every route resolves identity from the server session. There is no `userId`
request parameter. Ownership is part of every query, so another user's pack is a
404 rather than a 403. Per-user/per-IP rate limits apply to all routes.

## 10. AI provider and model configuration

- Provider: OpenAI Responses API, `responses.parse` with `zodTextFormat`
  structured outputs. No tools, web search or code interpreter.
- Model: `gpt-4.1-mini`, overridable server-side with `INTERVIEW_PREP_MODEL`.
  Read in one place: `src/lib/interview-prep/ai-client.ts`.
- Timeout: 45 seconds, no automatic retries that could double-charge.
- Every output is re-validated by `src/lib/interview-prep/verify.ts`, even
  though the provider enforces a schema.
- Missing configuration fails closed before any credit is consumed.

## 11. Entitlements and usage accounting

- Feature key: `AI_INTERVIEW_PREP` (Pro and Premium), centralised in
  `src/lib/billing/plans.ts`.
- Generation, regeneration and feedback draw on the existing shared `aiCredits`
  allowance — one AI ledger, not a new one.
- Reading a saved pack, task completion, session creation, session completion
  and answer submission are free.
- Order of operations: authenticate → entitlement → resolve inputs → fingerprint
  → resolve provider → reserve usage (atomic, idempotent) → provider → verify →
  persist.
- Identical inputs reuse a completed pack without charging twice.
- Re-requesting an existing scored evaluation returns it without charging.
  Legacy unscored feedback is re-evaluated once for free through the original
  `interview-feedback:${attemptId}` idempotency key.
- Admins bypass customer credits; all bypasses are logged.
- Expired trials fail closed through timestamp-derived entitlement checks, not a
  cron job.

## 12. Integrations

- **Job detail** (`/jobs/[id]`) lists prep packs linked to that job and offers
  one-click generation.
- **Queue / dashboard** deep-link preparation recommendations to the relevant
  pack or the new-pack form. Queue statuses recognise `READY` and
  `PARTIALLY_READY`.
- **Career Coach** receives a bounded summary of active preparation work rather
  than a second copy of the pack.
- **Entitlements** use the existing plan/feature registry; the feature is
  released for Pro and Premium.
- **Migration/deploy** use the existing Prisma migration and deploy pipeline.

## 13. Error recovery

Provider failures, timeouts, rate limits, refusals, empty/malformed output,
schema failures and oversized output map to safe user-facing messages through
`src/lib/interview-prep/route-errors.ts`. Provider details, stack traces and
Prisma errors never reach the browser.

Known domain failures include invalid input, missing job data, unreadable job
URL, duplicate generation in flight, usage limits, missing entitlement, too-short
answers and missing or mismatched sessions. A question or answer submitted with
a session ID must belong to that session; otherwise it is a 404 rather than
silently polluting another mock. Failed packs retain their status and a
machine-readable `errorCode`; a retry does not discard practice history.

## 14. Database migration

The interview-type tracks, scoring fields and model answers reuse existing
columns: pack `context`, attempt `feedback` JSON and session `summary` JSON. No
new migration is required for this release.

The feature itself was introduced by
`prisma/migrations/20261029120000_interview_prep_intelligence/migration.sql`.

It extends `InterviewPrepPack`, `InterviewQuestion` and
`InterviewPracticeAttempt`, adds `InterviewResearchSource`,
`InterviewPrepTask` and `InterviewPracticeSession`, and adds indexes and
cascades. Existing interview-prep rows are preserved; legacy `ACTIVE` pack
statuses are normalised to `READY`. The migration is non-destructive.

Validated locally with:

```bash
npm run prisma:migrate:status
npx prisma validate
npx prisma migrate diff --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma --exit-code
```

All three produced no drift. Apply with `npm run prisma:migrate:deploy`; never use
`prisma db push` in production.

## 15. Local setup and validation

1. Copy `.env.example` to `.env.local` and point `DATABASE_URL` at local Postgres.
2. `npm install` (runs `prisma generate` via postinstall).
3. `npm run prisma:migrate:dev`.
4. `npm run monetization:initialize` to seed plans and feature entitlements.
5. `OPENAI_API_KEY` is required for real generation; `INTERVIEW_PREP_MODEL` is
   optional.
6. `npm run dev` to start.
7. Validation: `npm run typecheck`, `npm test`, `npm run lint`, `npm run build`.
   Integration tests need a local test database and refuse non-test databases.

## 16. Deployment and troubleshooting

- Deploy applies migrations via `npm run prisma:migrate:deploy` before health
  verification.
- Set `OPENAI_API_KEY` server-side only. Never expose it as `NEXT_PUBLIC_*`.
- `INTERVIEW_PREP_MODEL` may be set per environment; it must support Structured
  Outputs.
- `ALERT_WEBHOOK_URL` receives important provider/pack failures.
- `AI_NOT_CONFIGURED`: the OpenAI key is missing or rejected.
- `USAGE_LIMIT_EXCEEDED`: the period's shared AI credit allowance is exhausted.
- `AI_TIMEOUT` / `AI_RATE_LIMITED`: retryable provider conditions; the pack is
  marked failed and can be regenerated.
- Company research missing or failed is expected when no official sources were
  supplied; add URLs in pack settings and regenerate.
- A pack marked “Inputs changed” means the job/profile/resume fingerprint moved;
  the saved pack is unchanged until regenerated.

## 17. What this release deliberately does not include

- Web search, search APIs, crawling or paid scraping services.
- Audio/video recording, transcription or real-time voice interviews.
- A separate AI usage ledger or a second orchestration framework.
- A parallel task manager or career-profile system.
- Guaranteed interview outcomes, employability predictions, streaks or badges.
- Localisation infrastructure; the feature UI is currently English, while the
  interview-language field can request another output language.
