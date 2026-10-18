# AI Job Intelligence & Match Explanations — teChia Jobs

Turns "this job scored 72" into "here is why, here is where you are
short, here is what we do not know, and here is what to do next".

The principle the whole feature is built on:

> **The AI explains the matching engine. It never replaces it.**

Everything quantitative in teChia Jobs — the fit score, the A/B/C/D tier, the
title match, the public job filter — is computed in TypeScript from your saved
preferences, and it stays that way. The model adds prose and traceability on
top of those numbers. It has no field in its output where a score could go.

---

## 1. How it works

```
your job (owned by you)          your career profile + preferences
        │                                    │
        └──────────────┬─────────────────────┘
                       │
        deterministic.ts  ── pure TypeScript, no AI
          • fit score + tier   (scoring.ts, unchanged)
          • hard gates that zeroed it
          • title relationship (capped by titleMatchesAny)
          • remote / location / eligibility / time zone / salary
          • input fingerprint (the cache key)
                       │
                       ├──► injected into the prompt as READ-ONLY FACTS
                       │
              prompt.ts ─┴─ ai-client.ts   strict structured output, no tools
                       │
                  model answers
                       │
              verify.ts  ── nothing it said is trusted
                • re-quote every excerpt against the posting
                • re-check capability claims against your profile
                • re-apply every deterministic dimension
                • re-derive the overall category
                       │
              categories.ts ── tier sets the floor, a hard block sets the ceiling
                       │
              JobIntelligenceAnalysis  (one row per input fingerprint)
                       │
                  job workspace
```

Steps 1–5 all happen **before any money is spent**. No transaction or row lock
is held while the provider runs.

## 2. The one thing to understand first

There are two numbers on the job page now, and they are not the same thing:

| | What it is | Where it comes from |
| --- | --- | --- |
| **Fit score / tier** | 0–100 and A/B/C/D. Drives ranking, queue order, priority. | `src/lib/scoring.ts` — unchanged since before this release. |
| **Category** | Strong match / Potential match / Stretch / Low match / Not enough information. | Derived from the tier plus verified evidence, in `categories.ts`. |

The category is **explanatory**. It cannot outvote the score:

- a tier-A job is never reported as a low match, because you can see the
  number next to it;
- a tier-D job is never reported as a strong match;
- a job with a **hard block** (geography or time zone scored zero) is always
  `LOW_MATCH`, whatever the model says;
- a job whose title the scoring engine rejected can never be described as a
  direct target match.

`docs/AUDIT_JOB_INTELLIGENCE.md` §3 documents the existing scoring engine and
why it was left alone.

## 3. What gets analysed

| Dimension | Who decides | Why |
| --- | --- | --- |
| Job-title fit | **The model, bounded** | Explains relatedness. Clamped by the deterministic `titleMatch`. |
| Seniority | **The model, bounded** | Reading responsibilities and leadership scope is real judgement. Bounded by your stated target level. |
| Required / preferred skills | **The model** | Compared against your actual profile rows. |
| Relevant experience | **The model** | Same. |
| Education & certifications | **The model** | Same. |
| Location | **The server** | Region keywords vs your saved regions. Arithmetic. |
| Remote work | **The server** | Arrangement vs your `remoteOnly` setting. Arithmetic. |
| Eligibility | **The server** | Stated region vs stated regions. Never a legal conclusion. |
| Time zone | **The server** | Stated requirement vs your saved time zones. |
| Compensation | **The server** | Integer comparison on whole units. No float, no FX. |

The five server-owned dimensions cannot be argued with by the model. If it
returns a different outcome, `verify.ts` discards its answer and uses ours.

## 4. Rules that are enforced in code, not in the prompt

Every one of these has a test.

### The AI cannot fabricate

- **No score.** There is no numeric score field in the output schema. The test
  asserts a response carrying `fitScore` fails validation.
- **Evidence must be quotable.** Every `JOB_DESCRIPTION` excerpt is looked up
  in the actual posting. A quote that cannot be found is dropped and the claim
  is marked unverified.
- **Capability claims need profile evidence.** If the model says you meet a
  skill requirement and your profile has no trace of it, the outcome becomes
  `UNKNOWN` — never a match.
- **Absence is not evidence of absence.** A capability marked `MISMATCH`
  because the profile does not mention it is corrected to `UNKNOWN`, with copy
  that says so: *"We could not find evidence of this in your current profile.
  That is not the same as you not having it."*
- **No invented salary.** A posting that states no salary produces
  `NOT_STATED_BY_EMPLOYER` — not a mismatch. Two currencies produce
  `NOT_COMPARABLE`. We never invent an exchange rate.
- **No promises.** "This role will get you an interview", "we will sponsor your
  visa" and "you are legally eligible to work in Germany" are all detected and
  replaced with copy we can stand behind.
- **No unrelated technologies promoted.** Transferability is allowed, but only
  when the model says it is reasoning about transferability.

### The model cannot act

It gets **no tools**. It cannot read files, call the network, change state,
write to the database, apply to anything, or contact an employer. The test
"does not let the model write to any table" asserts that running an analysis
creates exactly one row — the analysis — and moves nothing else.

## 5. Prompt injection

A job posting is attacker-controlled text. Someone posting a role can write
"IGNORE ALL PREVIOUS INSTRUCTIONS", embed a fake system block, or paste
instructions aimed at the model.

Four defences, in order of importance:

1. **The system prompt establishes the posting is data.** The only verb the
   model is given is "explain".
2. **Deterministic facts are injected and re-applied.** The model can be argued
   with about wording; it cannot change a score, a currency comparison or a
   work arrangement.
3. **No tools.** Injection is a wording problem, not a security one.
4. **The posting is fenced.** `<<<JOB_POSTING … JOB_POSTING>>>` with a marker
   chosen so the posting cannot plausibly end the data section early.

The injection fixture in `tests/job-intelligence-fixtures.ts` contains six
different attack shapes — direct override, impersonated system block, profile
exfiltration, verdict tampering, URL redirection, and a fake sponsorship
policy. The tests assert that none of them changes a deterministic value or
survives into the stored result.

## 6. Personalisation and fallback

Priority, in order:

1. User-confirmed structured career profile (`careerProfileConfirmedAt` set)
2. Explicitly saved work history and skills
3. Relevant structured preferences
4. Verified scalars (`headline`, `summary`, `location`)

**The raw resume is never re-parsed for job analysis.** Resume Intelligence
already produced a structured, user-reviewed profile; re-uploading the whole
document for every job would be a larger privacy exposure than this needs.

Excluded entirely: `email`, `phone`, resume/portfolio URLs.

When the profile is thin, the analysis still runs on what is trustworthy and
says what is missing. It does not fabricate a profile from your name or job
title, and it never modifies your career profile because an analysis noticed
a gap — a test asserts your `careerProfileVersion` is unchanged afterwards.

## 7. Job description

`JobLead.jobDescription` is a new nullable column, separate from `notes`.

This matters: `notes` is a free-text field that the ingestion flow fills with
*generated clue strings* (`"Detected stack: … | Eligibility clues: …"`) and
that users overwrite freely. Feeding that to the model would present our own
guesses to the user as the employer's words. `looksLikeJobDescription()` can
detect those strings, but the honest fix is a field that means "this is the
posting".

The ingestion flow populates it from whatever text was actually parsed, and
the job form exposes it.

### When there is no description

The analysis still runs on metadata alone. It does **not** invent a posting,
and it says so in three places: `meta.hadJobDescription: false`,
`dataCompleteness`, and a leading limitation reading *"This job has no
description saved, so the analysis is based on the role details alone."*

No URL is ever fetched by the AI or the analysis path. That would need
separate SSRF-safe design and is out of scope.

## 8. Persistence and caching

`JobIntelligenceAnalysis` — deliberately shaped like `ResumeExtraction`, so the
codebase stays consistent:

| Field | Purpose |
| --- | --- |
| `userId`, `jobId` | Whose reading, of which job. Cascades on delete. |
| `schemaVersion` | Contract version. Bumping invalidates cached rows. |
| `inputFingerprint` | SHA-256 over the inputs that can change an answer. |
| `status`, `errorCode` | Retryable state, machine-readable code only. |
| `data` | The verified structured analysis. |
| `jobTextTruncated` | So the UI can admit a shortened posting. |

The unique index on `(userId, jobId, inputFingerprint, schemaVersion)` is both
the cache key and the concurrency lock, exactly as the previous release argued
for `ResumeExtraction`.

### The fingerprint

Hashed: job text and metadata, career-profile version, the specific preference
fields that steer matching, the deterministic scoring inputs, and both contract
versions.

**Not** hashed: `updatedAt`, `createdAt`, row ids, the current time, the
request. Hashing any of those would either churn the cache every request or
invalidate a result for a change that did not affect the answer — a test
asserts a job's status change does not move the fingerprint.

### Freshness

`GET` recomputes the fingerprint on every read and returns `isFresh`. A result
whose inputs have moved past is still shown — you can read what it said — with
a "run it again" note rather than being silently presented as current.

## 9. Entitlements and usage

- **Feature:** `AI_JOB_ANALYSIS`, defined since the monetization launch, now
  `released: true`. Pro and Premium. This release ships an existing key rather
  than inventing a parallel one.
- **Meter:** `consumeUsage(userId, 'AI_JOB_ANALYSIS', 1, { pool: 'AI', limit:
  entitlements.limits.aiCredits, idempotencyKey })`. Same advisory lock, same
  `UsageRecord` table, same shared `aiCredits` pool as resume parsing and resume
  optimisation — one monthly budget across all three, not one budget each.
- **Burst limit:** 5 requests/min per user+IP. The monthly credit is the real
  spend control; this stops a stuck retry loop.
- **Admins** bypass the gate and record zero customer credits, consistent with
  the resume feature.

A usage rejection releases the claimed analysis row, so a user who hits their
limit is not blocked by a phantom in-flight run.

## 10. Title matching — what changed and what did not

`titleMatchesAny()` in `src/lib/preferences.ts` is **unchanged**. It is the
product's deterministic rule and altering it would change existing users'
scores for reasons unrelated to this feature.

What was added is `classifyTitleRelationship()`, which answers the second
question — "how close is it?" — with six outcomes: direct target match, related
role, adjacent opportunity, weak match, conflicting role, insufficient
information.

It exists because of a real false positive in the substring rule: a user
targeting only "Software Engineer" is currently matched against "Software
Engineering Manager", because one normalised string contains the other. That
is exactly the case this feature is required to get right.

**The classifier can only agree with or downgrade the deterministic result.**
`clampRelationship()` enforces this, and the asymmetry is deliberate:

| Deterministic `titleMatch` | Ceiling on the AI's answer |
| --- | --- |
| `true` | `DIRECT_TARGET_MATCH` |
| `false` | `RELATED_ROLE` |

### Public job filtering

`inferScoreComponents()` in `src/lib/public-jobs.ts` is untouched, so the
public job filter cannot be weakened. Routes were enumerated with `rg` before
any change: `titleMatchesAny` is used by `scoring.ts` (`hasTitleMatch`) and
`public-jobs.ts` (`inferScoreComponents`), transitively by `hydrateJob` and
`buildStoredJobPayload`. None were modified.

Manually added jobs keep their existing behaviour — a user-entered job is
analysable even with a weak title match, and the analysis says honestly why.

## 11. API

```
GET  /api/jobs/[id]/intelligence
POST /api/jobs/[id]/intelligence   { "force"?: boolean }
```

`GET` returns entitlements, the deterministic score, profile readiness, and any
existing analysis. `POST` runs or reuses one and returns the analysis inline.

There is no `userId` parameter anywhere in the route. Identity comes from the
session; the job is resolved with `{ id, userId, deletedAt: null }`. Another
user's job is a 404 identical to a job that does not exist — a test asserts
both produce the same error name and status.

Every response is `private, no-store`. The POST body is validated with a
**strict** schema, so a payload carrying `userId`, `plan` or `score` fails.

## 12. Configuration

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | Yes | — | Shared with Resume Intelligence. Server-side only. |
| `JOB_INTELLIGENCE_MODEL` | No | `gpt-4.1-mini` | Must support Structured Outputs. Read in one place. |

Without a key the endpoint returns a clear configuration error and **never
simulates a successful analysis**.

## 13. Model selection

Chosen by measurement, not reputation. Every candidate was run against the
**real** strict schema with a realistic full-size posting (near the 12k character
ceiling) and scored on schema conformance, requirement coverage, latency and
measured cost per analysis.

| Model | Latency | Cost/analysis | Requirements found | Notes |
| --- | --- | --- | --- | --- |
| `gpt-6-luna` | 56–62 s | ~$0.003 | 17 | Most cautious, but **exceeds the 45 s timeout** — disqualified |
| `gpt-5.4-mini` | 11–13 s | ~$0.018 | 10 | Most thorough, ~3.4x the cost for a similar answer |
| **`gpt-4.1-mini`** | **12–15 s** | **~$0.005** | **8** | **Cautious with UNKNOWN, surfaces limitations** |
| `gpt-4o-mini` | ~15 s | ~$0.0016 | 8 | Cheapest, but over-claims MATCH more often |

`gpt-4.1-mini` is the balance point. This output drives a real career decision,
so a model that says "we cannot tell" is worth more than three quarters of a
cent, and it is still **3.4x cheaper** than the previous default.

Resume extraction was benchmarked separately, against a resume with a **known
ground truth** — 18 concrete fields including name, email, role count, every
company, every skill, qualification, institution, dates, and that no phone
number was hallucinated:

| Model | Accuracy | Cost/analysis |
| --- | --- | --- |
| **`gpt-4o-mini`** | **18/18** | **~$0.0013** |
| `gpt-4.1-mini` | 18/18 | ~$0.0037 |
| `gpt-5.4-mini` | 18/18 | ~$0.0078 |

Identical accuracy, so the cheapest wins outright: **5.8x cheaper** than the
previous default for the same result.

### A prompt fix the benchmark forced

The first run showed every model misusing `NOT_APPLICABLE` as a softer
`UNKNOWN` — calling genuine requirements "doesn't apply" when the honest
answer was "cannot tell". That is the single most misleading thing this output
can say, and no amount of model choice would fix it. The system prompt now
defines each outcome explicitly, forbids using `NOT_APPLICABLE` for a real
requirement, and requires extracting *every* stated requirement rather than
stopping at the resolvable ones. After the fix, `NOT_APPLICABLE` misuse dropped
to zero across all candidates and the cheapest model's coverage rose from 6 to
8 correctly-classified requirements.

### What the verification layer caught on a live run

A live `gpt-4.1-mini` analysis against a real posting: 17 evidence items
returned, **3 were dropped** because the quote could not be found in the posting
text. The `NOT_APPLICABLE` misuse check passed, no injection text survived, and
the deterministic score (79, tier B) passed through untouched.

## 14. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `AI_NOT_CONFIGURED` | Missing/blank `OPENAI_API_KEY` | Set it; restart. |
| `AI_RATE_LIMITED` | Provider throttling | Wait and retry. Retryable. |
| `AI_INVALID_RESPONSE` | Output failed our Zod validation | Retry. If persistent, the contract and the model may disagree — check the model supports Structured Outputs. |
| "Not enough information yet" | Profile or job data too thin | Fill the gaps listed under *What this analysis could not cover*. |
| Analysis always says stale | Job/profile/preferences changed | Re-run. The fingerprint changed, so a new analysis is genuinely needed. |
| Salary says "not comparable" | Job currency ≠ preference currency (USD) | We do not convert. Check the rate yourself. |
| Free user sees nothing | `AI_JOB_ANALYSIS` is Pro+ | Expected. Scoring and jobs are unaffected. |

## 15. Out of scope (deliberately)

No resume optimisation, no cover letters, no interview generation. No
autonomous job-search agent. No automatic applications. No URL fetching from
the AI. No change to `titleMatchesAny`, `calculateFitScore`,
`inferScoreComponents`, or the public job filter.