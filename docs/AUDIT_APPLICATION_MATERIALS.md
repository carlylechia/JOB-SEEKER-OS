# Audit — AI Cover Letters & Application Materials

Written before any implementation code, against commit `5809932` (`feat: introduce
Resume Builder and Job-Specific Optimization (#20)`).

This release asks for a feature that has no prior art in this repository. What
follows is what actually exists, what can be reused, and what genuinely does not —
so the design below is traceable to the codebase rather than to a plan document.

---

## 1. Stack and conventions

| Concern | What is actually there |
|---|---|
| Framework | Next.js 15.5.27, App Router, React 19.0.0 |
| Language | TypeScript 5.8.2, `strict: true`, path alias `@/* → ./src/*` |
| Styling | Tailwind 3.4.17 with teChia Jobs semantic tokens |
| ORM | Prisma 6.16.1, PostgreSQL |
| Validation | Zod 3.24 (`.strict()` on every request contract) |
| AI | `openai` 7.38, `responses.parse()` + `zodTextFormat()` |
| Tests | Node's built-in runner via a local harness. **No Playwright.** |
| Lint | `npm run lint` → `next lint`, which is deprecated and has **no ESLint config** |

Component style is almost entirely client components fetching their own data.
There is no shared Button/Card/Input/Badge component; the design system is a set
of CSS component classes (`btn-primary`, `card-pad`, `input`, `select`, `badge`,
`title`, `muted`) in `src/app/globals.css`.

---

## 2. Prerequisite releases

| Release | Merged? | Consequence for this release |
|---|---|---|
| Resume Intelligence (#13) | Yes | Confirmed career profile is available as verified context. |
| AI Job Intelligence (#14) | Yes | Validated job analysis is available as an optional grounding source. |
| Resume Builder (#20) | Yes — merged upstream **during this audit** | `StructuredResume` and the PDF renderer are available. |

The Resume Builder landing mid-audit is worth recording: the initial audit ran
against `61843bf`, where `feat/pro-resume-builder-optimization` was unmerged and
`src/app/api/resumes/**` did not exist. The branch was cut from `main` after the
fetch that brought in `5809932`, so the feature integrates with tailored resumes
and reuses the PDF renderer rather than working around their absence.

---

## 3. What exists to reuse

### 3.1 Entitlements — a key already exists

`src/lib/billing/plans.ts` already defines:

```ts
AI_COVER_LETTER: {
  plans: ['PRO', 'PREMIUM'],
  label: 'AI cover letters',
  released: false,          // ← this release ships it
  description: 'Draft tailored cover letters for each application.',
},
```

**Decision: ship `AI_COVER_LETTER`. Do not add `AI_APPLICATION_MESSAGE`.**
Two keys with identical plan grants and an identical `aiCredits` budget would be
a second name for one capability — exactly the "parallel entitlement system" the
brief warns against. The label and description are widened to cover messages
because this release ships both.

Usage draws on `PLAN_LIMITS.aiCredits`, the budget already shared by
`AI_RESUME_PARSER`, `AI_JOB_ANALYSIS` and `RESUME_OPTIMIZATION`. One AI
allowance, not several competing ones.

### 3.2 Templates — a real, user-owned feature

`FollowUpTemplate` (`userId`, `type`, `name`, `subject`, `body`, `isDefault`)
with categories `intro`, `follow_up`, `thank_you`, `check_in`, `referral`.
Surfaced at `/templates` and delivered by `getUserWorkspace()` via
`/api/bootstrap`, where it is merged with the hardcoded `demoTemplates` in
`src/lib/demo-data.ts`.

**There is no template CRUD API.** Templates are read-only to the user today.
This release therefore does not add one — inventing a template-management system
would be the "competing messaging/template system" the brief rules out. What it
does add is AI generation *from* a template, with the generated result stored as
its own artefact.

### 3.3 The AI pattern to mirror

`src/lib/job-intelligence/` is the closest analogue and is used as the template
for every layer:

```
requireEntitlement()        → entitlements.ts, timestamp-derived
consumeUsage()              → usage.ts, advisory lock + idempotency key
claim row by unique index   → the row is the lock, not a read-then-write
provider call               → no transaction open, bounded timeout
verify()                    → re-check every claim against real source text
persist verified result     → never the raw model output
```

The provider boundary has **no tools**, schema-constrained output, and a closed
set of error codes. That is what makes prompt injection a wording problem rather
than a security problem, and it is retained here without modification.

### 3.4 Application context — there is no Application model

The pipeline is **derived** from `JobLead.status`; there is no application
entity. The available real application facts are:

- `JobLead.status`, `dateApplied`, `nextFollowUp`
- `JobLead.contacts` (JSON) — the recruiter/hiring contact
- `JobLead.interviews` (JSON) — actual scheduled interviews, if any
- `JobLead.jobDescription` — the employer's text, untrusted input

`APPLICATION_RECORD` as an evidence source therefore means "the stored fields of
this user's job lead", and interview context means "a row in this user's own
`interviews` array". Nothing is inferred: a follow-up message cannot claim an
application was submitted unless `dateApplied` or a post-submission status says
so.

### 3.5 PDF export — a renderer now exists

Before #20 there was no PDF generation in the repository at all. #20 added
`pdf-lib` + embedded Inter, and crucially `renderPdfLayout(layout)` consumes a
generic `LayoutDocument` (`TEXT`/`RULE`/`FILL` blocks in PDF points) rather than a
resume-shaped structure. A cover-letter layout is therefore a pure function that
emits the same block format, and reuses `preparePdfEngine()`,
`getLayoutMetrics()` and `renderPdfLayout()` unchanged. **No second PDF stack.**

Plain-text download covers every material type; PDF is offered for cover letters
only, because that is the only material anyone prints.

### 3.6 Ownership and error conventions

Jobs resolve with `{ id, userId, deletedAt: null }`, so another user's row is a
404 identical to a missing one. Every AI response is `privateNoStore`, every
domain error maps to `{ error: { code, message, ...safeMeta } }`, and anything
unrecognised is re-thrown to `handleRoute` for a logged generic 500.

---

## 4. What does not exist, and what was done instead

| Expected | Reality | Decision |
|---|---|---|
| An application record | Pipeline is derived from `JobLead.status` | Bind materials to `JobLead`; snapshot stage/dates into generation metadata. Documented as a dependency. |
| Template CRUD | Read-only | Consume templates as generation input; store results separately. |
| A second entitlement key | `AI_COVER_LETTER` exists | Ship it. |
| Rich-text editing | Plain-text editor used everywhere in the app | `<textarea>` that preserves line breaks. No new editor dependency. |
| Toast/modal/tabs components | None exist | Follow the app's established inline-status pattern rather than introducing a UI library. |
| Playwright | Not installed | Automated coverage uses the existing `node:test` harness. E2E is not claimed. |
| ESLint config | Does not exist in any branch | `npm run lint` cannot run. Pre-existing; not introduced here. |

---

## 5. Anti-fabrication design

The governing requirement: **the model must never invent a personal fact.** The
control is not the prompt — a prompt is advice. The controls are:

1. **Greeting and sign-off are server-derived.** The model never writes them. A
   known contact name produces `Dear <name>`, otherwise `Hello,`. An invented
   "Dear Jane," is structurally impossible.
2. **Subject and company are checked** against known values.
3. **Every numeric claim is scanned.** Any number, percentage or multiplier in
   the prose that does not appear in the source corpus causes the sentence to be
   dropped and reported as a review note. "Increased revenue by 60%" cannot
   survive if 60% is not in the profile.
4. **Every employment-claim sentence must name a known organisation.**
5. **Excerpts are re-quoted** against the real job text and profile text. An
   excerpt that cannot be found is dropped and the claim is marked unverified.
6. **Capability claims are re-checked** against the actual profile, reusing the
   technique already established in `job-intelligence/verify.ts`.
7. **Promise, absence and legal-determination claims are neutralised**, reusing
   the pattern families from that same file.

The rule throughout: when a claim cannot be supported, it is **removed from the
draft and surfaced for review** — never stored as if verified, and never left
silently in the prose where the user might send it without noticing.

---

## 6. Anti-injection design

User instructions, job descriptions, company text and pasted conversation
snippets are all untrusted and are wrapped in an explicit data fence. The model
gets **no tools**, so it cannot read files, call URLs, write to the database,
change a plan, or send anything. Trusted server code owns persistence,
authorisation, usage accounting and every external integration. Generation is an
explicit user action and never runs during page rendering.

---

## 7. Summary of what was built

`src/lib/application-materials/` — contracts, limits, context, prompt, provider
boundary, verification, service, request/wire contracts, error mapping, letter
layout. `ApplicationMaterial` in Prisma with revision chaining. Four API routes.
One workspace screen, plus a launcher on the job detail page and an entry point
from Templates.

Nothing in this release sends a message, submits an application, or touches a
messaging account.
