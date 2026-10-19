# Interview Intelligence & Preparation Packs

teChia Jobs — Pro Release 6.

This document describes the interview preparation feature: how users create
job-specific preparation packs, generate questions from real job and career
context, practise text-based answers, receive structured feedback, and how the
feature is authorised, metered, persisted and operated.

## 1. Workflow

From a saved job:

1. Open the job (`/jobs/[id]`) and choose **Create AI prep pack**, or open an
   existing pack from the Prep Packs list (`/prep`).
2. Choose an interview context: recruiter screen, hiring manager, behavioral,
   technical, system design, project discussion, problem-solving, situational,
   final round, questions to ask the employer, or a balanced pack when the
   stage is unknown.
3. The server generates a small, high-quality set of questions (at most eight)
   from the actual job description, your career profile, your selected resume
   and the job's fit score. Questions are grouped by category and difficulty,
   each with a competency, why it matters, the related requirement, a grounded
   experience suggestion (only from your confirmed profile), preparation notes
   and a suggested answer framework (STAR / technical / architecture).
4. Reopen the pack later. Select a question, read the preparation notes, write
   your answer and submit it. Submitting creates a numbered attempt; previous
   attempts are preserved.
5. Request feedback. Feedback uses a central rubric scored only on dimensions
   that make sense for the question (e.g. technical correctness for debugging,
   concrete example for behavioral). It explains what worked, what to improve,
   what may be missing, a structure suggestion and bounded follow-up practice.
6. Return later and continue. Progress (questions practised, feedback received,
   last practised date) is persisted.

## 2. Data model

Three tables extend the existing Prep Packs surface (`JobLead.prepPack` JSON
remains for free-form talking points; this is the structured counterpart):

- `InterviewPrepPack` — user-owned, job-targeted pack. Fields: title, context,
  status (ACTIVE/ARCHIVED), schema/prompt versions, `inputFingerprint` for
  staleness detection, `preparationGuidance`, `limitations`, cached progress
  counters and timestamps. One pack per `(userId, jobId, inputFingerprint)` —
  the unique index doubles as the duplicate-generation lock.
- `InterviewQuestion` — one row per question, versioned and ordinal-positioned:
  category, difficulty, competency, question text, why it matters, related
  requirement, relevant experience, prep notes, answer structure, follow-up
  question IDs, source type and source evidence. `isActive` lets a refresh
  retire the old set without detaching attempts.
- `InterviewPracticeAttempt` — one row per submitted answer: pack, question,
  question version, attempt number, answer text, feedback JSON, rubric key and
  timestamp.

All user relations cascade on delete. Indexes support ownership-scoped reads,
pack progress and per-question history.

## 3. Question and pack schema

Defined in `src/lib/interview-prep/schema.ts` as versioned strict Zod
contracts (pure: no `.refine`/`.transform`, so OpenAI strict structured
outputs can enforce them). `INTERVIEW_PREP_SCHEMA_VERSION` bumps invalidate
cached packs.

Interview contexts:
`RECRUITER_SCREEN`, `HIRING_MANAGER`, `BEHAVIORAL`, `TECHNICAL`,
`SYSTEM_DESIGN`, `PROJECT_DISCUSSION`, `PROBLEM_SOLVING`, `SITUATIONAL`,
`FINAL_ROUND`, `QUESTIONS_TO_ASK`, `BALANCED`.

Question categories:
`TECHNICAL_FUNDAMENTALS`, `APPLIED_PROBLEM_SOLVING`, `ARCHITECTURE_TRADE_OFFS`,
`BEHAVIORAL`, `COMMUNICATION`, `OWNERSHIP`, `COLLABORATION`, `HANDLING_AMBIGUITY`,
`DEBUGGING`, `PROJECT_DECISIONS`, `ROLE_SCENARIO`, `EMPLOYER_QUESTIONS`.

Difficulty: `FOUNDATION` / `APPLIED` / `ADVANCED`.

Answer framework: `STAR` / `TECHNICAL` / `ARCHITECTURE` / null (no framework
forced).

Source type: `GENERATED` / `MANUAL` / `EDITED`.

Feedback ratings: `EVIDENT` / `PARTIAL` / `NOT_EVIDENT` / `INSUFFICIENT_EVIDENCE`.

## 4. Answer framework behavior

Frameworks live in `src/lib/interview-prep/prompt.ts`
(`ANSWER_FRAMEWORK_GUIDANCE`):

- STAR (Situation, Task, Action, Result) — behavioral questions.
- Technical problem-solving — understand, clarify, explain approach,
  trade-offs, validation, result.
- Architecture and trade-offs — requirements, constraints, design,
  alternatives, trade-offs, testing and operations.

The framework is selected by question category, never forced onto every
question. Frameworks give concise prompts and reminders, not a robotic script
to memorise.

## 5. Feedback rubric

Defined centrally in `src/lib/interview-prep/service.ts`
(`rubricDimensionsForCategory`). Only dimensions relevant to a category are
scored:

- Base for all: relevance, clarity/structure, communication, completeness.
- Behavioral / project / collaboration / ownership: add concrete example,
  role skills, supported outcomes.
- Technical / applied / debugging / architecture: add technical correctness
  and reasoning/trade-offs.

A written answer too short to judge yields `INSUFFICIENT_EVIDENCE` for a
dimension rather than a guess. There is no single opaque "readiness score";
feedback is a small, visible rubric.

## 6. Persistence and versioning

- A pack is created per user, job and input fingerprint. Re-running with the
  same inputs reuses the completed pack and consumes no credit.
- Changing the job description, profile, resume or context produces a new
  fingerprint; the old pack is kept and marked stale (`isFresh: false`) rather
  than silently replaced.
- A refresh (`POST /api/interview-prep/[packId]/regenerate`) deactivates the
  old questions (`isActive: false`) and inserts new ones with an incremented
  version. Practice attempts stay attached to the question versions they were
  taken against.
- Attempts are numbered and never overwritten. A user can reopen a completed
  pack and see previous answers and feedback.

## 7. AI provider and model configuration

- Provider: OpenAI (Responses API, `responses.parse` with `zodTextFormat`
  structured outputs). No tools, no web search, no code interpreter — the
  model can only return the schema-shaped object.
- Model: `gpt-4.1-mini`, overridable via `INTERVIEW_PREP_MODEL` (read in one
  place, `src/lib/interview-prep/ai-client.ts`). Timeout 45s.
- All AI work is server-side. API keys and model config never reach the
  browser.
- Every model output is re-validated server-side (`src/lib/interview-prep/verify.ts`),
  even though the provider offers structured output.

## 8. Entitlements and usage accounting

- Feature key: `AI_INTERVIEW_PREP` (Pro and Premium), already present in the
  entitlement registry (`src/lib/billing/plans.ts`). `ADVANCED_PREPARATION`
  (Premium) is reserved for later; this release does not require it.
- Pack generation and feedback both draw on the shared `aiCredits` allowance
  — one AI allowance, not several competing ones. Plan limits: FREE 25,
  PRO/PREMIUM unlimited (centralised; do not scatter limits).
- Before any AI call: authenticate → entitlement (`requireEntitlement`) →
  resolve inputs → fingerprint → usage reservation (`consumeUsage`, atomic
  under a PG advisory lock with an idempotency key) → provider → persist.
- Reading a saved pack, reviewing feedback or navigating the UI consumes
  nothing. Duplicate concurrent or retried requests with the same idempotency
  key are not charged twice.
- Admins are exempt and consume zero customer credits. Expired trials fail
  closed (timestamp-derived, not cron-derived).

## 9. Privacy boundaries

- Practice answers are private to the authenticated user. Ownership is part of
  every query; another user's pack is a 404, never a 403.
- The raw resume is never sent to the provider — only a summary of the
  confirmed career profile (built by Resume Intelligence).
- Only the minimum authorised data is sent for each operation.
- Full answers, resumes, profiles, raw prompts and feedback are not logged.
- Practice content is not used for model training as part of this feature.
- No retention guarantees beyond what the database holds; deletion cascades
  with the user/job.

## 10. Prompt-injection safety

- The system prompt establishes that job descriptions, resumes, profiles and
  answers are untrusted third-party data, not instructions.
- The model gets no tools, so it cannot invoke network, file or privileged
  operations.
- Supplied text is fenced (`<<<... >>>`) so it cannot terminate the data
  section early.
- Generated questions are never presented as actual employer questions, and no
  employer-specific claims (visa sponsorship, "the company always asks…") are
  emitted.
- Personal-experience references are re-checked against the user's actual
  profile; unsupported ones are nulled. Feedback evidence quotes are re-checked
  against the submitted answer.

## 11. Error recovery

- Provider failures, timeouts, rate limits, empty and malformed output, schema
  validation failure and oversized output are mapped to safe user-facing
  messages through `src/lib/interview-prep/route-errors.ts`.
- Provider messages, stack traces and Prisma details never reach the browser.
- Domain errors (`PlanRequiredError`, `UsageLimitExceededError`,
  `DuplicatePrepGenerationInFlightError`, `PracticeAnswerTooShortError`)
  carry machine-readable codes clients assert on.
- Retryable failures offer a retry; non-retryable ones (e.g. no job data)
  explain what the user can do.

## 12. Database migration

`prisma/migrations/20261019120000_interview_preparation/migration.sql` creates
`InterviewPrepPack`, `InterviewQuestion` and `InterviewPracticeAttempt` with
foreign keys, cascades and indexes. It is non-destructive and was verified
against the local database with `prisma migrate diff` producing an empty
diff (zero drift). Apply with `npm run prisma:migrate:deploy`. Do not use
`prisma db push` in production.

## 13. Local setup

1. Copy `.env.example` to `.env.local` and set `DATABASE_URL` to a local
   Postgres.
2. `npm install` (runs `prisma generate` via postinstall).
3. `npm run prisma:migrate:dev` to apply migrations locally.
4. `npm run monetization:initialize` to seed plans (FREE/PRO/PREMIUM) and
   feature entitlements.
5. `npm run dev` to start.
6. Tests: `npm test` (integration tests need `TEST_DATABASE_URL` or a local
   `DATABASE_URL` and refuse non-test databases).
7. `npm run typecheck` and `npm run build` for validation.

## 14. Deployment and troubleshooting

- Deploy applies migrations via `npm run prisma:migrate:deploy` (CI runs the
  schema-drift gate first).
- Set `OPENAI_API_KEY` server-side only. Never expose as `NEXT_PUBLIC_*`.
- Set `ALERT_WEBHOOK_URL` for Discord error alerting (error level only).
- If generation fails with `AI_NOT_CONFIGURED`, the OpenAI key is missing.
- `USAGE_LIMIT_EXCEEDED` means the period's `aiCredits` allowance is used.
- Packs are cached by input fingerprint; unrelated profile edits do not
  invalidate them.

## 15. What this release deliberately does not include

- Audio/video interview recording or real-time voice conversation.
- Transcription or real-time audio services.
- A second AI orchestration framework or provider.
- A parallel task-management system alongside the existing Queue (preparation
  actions integrate with the existing queue surface).
- Gamification (streaks, badges, leaderboards) or employability predictions.
