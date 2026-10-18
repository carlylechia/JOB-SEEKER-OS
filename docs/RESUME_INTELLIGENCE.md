# Resume Intelligence — teChia Jobs

Turns a resume a user has already uploaded into a structured, editable career
profile they confirm before anything is saved.

The principle the whole feature is built on:

> Extract facts, show the evidence, let the user decide, and persist only
> validated, authorized changes.

---

## 1. How it works

```
stored resume (private blob)
   │
   ├─ 1. ownership ────────► documents.ts   loads by { id, userId }
   ├─ 2. entitlement ─────► requireEntitlement('AI_RESUME_PARSER')
   ├─ 3. format + text ───► extract-text.ts  magic bytes, bounded parsers
   ├─ 4. dedupe ───────────► hashResumeText   unchanged text reuses its result
   ├─ 5. usage ────────────► consumeUsage     advisory lock, idempotency key
   ├─ 6. extraction ───────► ai-client.ts     strict Structured Outputs, no tools
   ├─ 7. verification ─────► verify.ts        re-check evidence against the text
   └─ 8. persist ──────────► ResumeExtraction  draft only; profile untouched
                                    │
                             review interface
                                    │
                    user edits, accepts, rejects, resolves
                                    │
                      applyReviewedExtraction (one transaction)
                                    │
                confirmed values → relational career tables
```

Steps 1–5 all happen **before** any money is spent. No database transaction or
row lock is held while the provider is called.

## 2. Supported file types

| Format | Parser | Notes |
| --- | --- | --- |
| PDF | `unpdf` (pdf.js, serverless build) | Embedded text only. No OCR. |
| DOCX | `mammoth` (`extractRawText`) | Body text only. Images are not rendered, macros never exist in a `.docx` payload. |
| TXT / TEXT | built-in UTF-8 decoder | BOMs (UTF-8, UTF-16LE/BE) handled. |

**Not supported, refused by signature with a specific reason:** legacy `.doc`
(OLE2), `.rtf`, `.odt`, `.pages`, archives, and executables.

### Format is decided from bytes, never from the filename

The filename and the browser-supplied `Content-Type` are both chosen by the
caller. Verified behaviour:

| Upload | Result |
| --- | --- |
| DOCX named `resume.pdf` | parsed as DOCX |
| PDF named `resume.docx` | parsed as PDF |
| text named `resume.pdf` | refused — "may have been renamed" |
| `.doc` binary | refused as legacy Word |
| executable named `.pdf` | refused |

Storage names are generated server-side. Display names are sanitised and are
never used as a path or an access-control identifier.

## 3. Limits

All in `src/lib/resume/limits.ts`. Nothing scatters these numbers.

| Limit | Value | Why |
| --- | --- | --- |
| File size | 5 MB | Fits a designed PDF and the serverless budget |
| Extracted text | 24,000 chars | ~6k tokens; far more than a real resume |
| Minimum usable text | 40 chars / 20 alphanumerics | Low, so a genuinely sparse resume is still readable |
| PDF pages | 25 (50 refused outright) | A 50-page PDF is not a resume |
| DOCX pages | 40 | Page breaks in the body |
| ZIP expansion | 120× ratio, 64 MB absolute | A `.docx` is a ZIP; bombs are refused before decompression |
| Provider timeout | 45 s | Bounded inside the function budget |
| Storage fetch timeout | 15 s | A wedged blob must not stall the request |

**Truncation is recorded.** The review interface says a resume was longer than
we analyse in one pass, rather than implying full coverage.

## 4. AI provider configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | Yes, in production | Server-side only. **Never** as `NEXT_PUBLIC_*` — anything public ships to the browser. |
| `RESUME_INTELLIGENCE_MODEL` | No | Defaults to `gpt-4o-mini`. Read in exactly one place (`ai-client.ts`). |

Without a key the endpoint returns a clear configuration error and logs
`resume_extraction_provider_failed`. It **never** simulates a successful
extraction.

### Why OpenAI, and why this model

The repository had no AI provider at all, so this release introduces the first
one. `ai-client.ts` is the only module that knows OpenAI exists — the service,
routes and tests depend on a `ResumeAiProvider` interface, so the next AI
feature reuses this seam instead of adding a second SDK.

`gpt-4o-mini` supports Structured Outputs and the Responses API, and was chosen
for a bounded extraction task by measuring extraction accuracy against a resume
with a known ground truth: it matched `gpt-4.1-mini` and `gpt-5.4-mini` on all
18 checked fields while costing 5.8x less per analysis.

### Structured output

Uses `responses.parse` with a strict JSON Schema, so the provider guarantees
shape rather than merely valid JSON. We validate again on our side anyway:
*"the provider said it conforms"* is not a guarantee.

The Zod contract is deliberately **pure** — no `.refine()`, `.transform()` or
`.catch()` — because strict Structured Outputs cannot express those. Judgement
happens in server-side code instead. Verified against the provider converter:
19/19 required properties, `additionalProperties: false`.

**The schema is `.strict()`.** Zod's default strips unknown keys, which would
silently discard an unexpected field. Here an unknown field is an error,
because it means the contract has drifted.

## 5. Entitlements

Two keys in the existing `FEATURE_ENTITLEMENTS` registry. No parallel plan
logic exists.

| Key | Plans | Gates |
| --- | --- | --- |
| `AI_RESUME_PARSER` | PRO, PREMIUM | Starting an analysis (the paid provider call) |
| `CAREER_PROFILE_INTELLIGENCE` | PRO, PREMIUM | Reading and saving the career profile |

| User | Result |
| --- | --- |
| Pro (active) | Full access |
| Premium (active) | Full access |
| Pro trial (running) | Full access, resolved from timestamps |
| Pro trial (elapsed) | 403 — resolved from `trialEndsAt`, not from the stored `TRIALING` status |
| Free | 403 + upgrade prompt |
| Admin | Full access, existing exemption |

**Resume upload stays Free.** Only the analysis is gated, so gating the AI
operation never makes existing upload functionality inaccessible.

A user who downgrades keeps all of their confirmed data; they lose access to
rebuild it, and regain it on upgrade.

## 6. Usage and cost control

Uses the existing `consumeUsage` mechanism — same table, same advisory lock,
same idempotency support. No second credit system.

| Situation | Provider calls | Credits |
| --- | --- | --- |
| First analysis | 1 | 1 |
| Asked again, resume unchanged | 0 | 0 |
| Explicit "run again" | 1 | 1 |
| Retry after a failure | 1 | 0 (same idempotency key) |
| Two concurrent identical requests | 1 | 1 |
| Free user, or expired trial | 0 | 0 |
| Admin | 1 | 0 |

The idempotency key is `resume-extract:<extractionId>`, derived from the
document version, so a retry is not charged twice. A deliberate re-analysis
uses a distinct `:forced` suffix and is charged.

Limits come from the existing `PLAN_LIMITS.aiCredits` — the single pool
shared with job analysis and resume optimisation. No new quota was invented.

### Reuse and concurrency

The unique index on `ResumeExtraction(resumeId, contentHash, schemaVersion)`
does two jobs:

- **Dedupe** — an unchanged document reuses its completed result.
- **Lock** — a second concurrent request gets `409 DUPLICATE_REQUEST` instead
  of starting a parallel provider call.

Reuse is checked *before* the row is claimed, so a completed result is never
overwritten to `PROCESSING` before being returned.

A run that was killed mid-request (serverless eviction) is taken over after two
minutes rather than blocking that document version forever.

`contentHash` is a SHA-256 of the **normalised text**, not the raw bytes, so a
re-exported identical resume still reuses its result. It is scoped to
`(user, resume, version)`, so one user's cached extraction is never served to
another.

### Accounting semantics, stated honestly

A failed attempt **still consumes its credit**. The provider call was made and
may have cost money, so reporting "no cost occurred" would be false. A *retry*
of the same document version is not charged again.

## 7. Privacy

Resume contents are highly personal. Controls in place:

- Resumes are **private** Vercel blobs, fetched server-to-server with the store
  token. The browser never receives a storage URL.
- Only the **extracted text** of the chosen document is sent — not the account,
  job history, or any other personal data.
- A plain-language notice is shown before a first analysis, naming the actual
  provider.
- **Raw resume text is never persisted.** Verification runs before the
  extraction is stored, so evidence is checked at the only moment the source is
  available.
- Logs carry identifiers and sizes. Never resume content, extracted JSON,
  credentials, tokens, or API keys.
- Nothing is sent to analytics or Discord.
- No training or fine-tuning of user resume content.
- Every API response is `private, no-store`.

### Prompt injection

A resume is untrusted input. Three defences:

1. **The prompt establishes DATA.** The only verb given is "extract", and the
   specific attacks are named. The document is fenced between markers.
2. **No tools.** No function calling, no web search, no code interpreter. The
   model can only return the object we asked for.
3. **Nothing it returns is trusted.** Every value is re-validated and
   re-checked against the source text before persistence.

A test fixture contains a full `=== SYSTEM OVERRIDE ===` block instructing the
model to invent qualifications, mark unevidenced claims as verified, read
`/etc/passwd` and call an external URL. It is carried through as ordinary
content, and no field exists that could carry it out.

## 8. Evidence and uncertainty

The model's self-reported confidence is not treated as verified truth. Evidence
is re-derived from the document:

| Level | Meaning |
| --- | --- |
| `SUPPORTED` | A verbatim snippet was found in the resume |
| `NEEDS_REVIEW` | Inferred, ambiguous, or a snippet that could not be found |
| `SUGGESTED` | Proposed by the model; not in the resume at all |

A claim whose snippet cannot be located is downgraded regardless of what the
model claimed about itself. A claim with no snippet and no reason to doubt it is
still `NEEDS_REVIEW`, because absence of evidence is not evidence.

Skills are additionally tagged `STATED` / `SUPPORTED` / `INFERRED`, and
**inferred skills start unticked in the review**. An inferred skill can never be
auto-promoted to a verified one.

Contradictions in the document itself are surfaced, not resolved: two date
ranges for one role, or a range that runs backwards, both appear as a conflict
for the user to settle.

## 9. Merge behaviour

**Nothing is overwritten silently.** Where a profile field already holds a
value, the review shows both and the user chooses `keep` / `use this` /
`clear`.

| Situation | Behaviour |
| --- | --- |
| Profile field populated | Shown alongside the candidate; user picks |
| Section confirmed with items | Section replaced from what was included |
| Section confirmed empty | **Existing data left alone** |
| Skills | Accumulate, never replace |
| Resume email | Shown for review, **never written to the account** |
| Stale review (second tab saved first) | `409 CONFLICT`, nothing written |

A resume is a snapshot of one point in time; it does not get to replace a newer,
deliberately-set profile value.

Concurrent saves use a compare-and-swap on `careerProfileVersion`, so a stale
tab cannot clobber a newer one.

## 10. Observability

Reuses `logImportantInfo` / `logImportantError`. Discord alerts fire only on
`error` level, so a successful parse never alerts.

| Event | Meaning |
| --- | --- |
| `resume_parse_started` | Run began |
| `resume_parse_succeeded` | Completed; records model and truncation |
| `resume_parse_reused` | Cached result served; no call, no charge |
| `resume_parse_failed` | Terminal failure with a code |
| `resume_parse_denied` | Entitlement refused the request |
| `resume_parse_usage_denied` | Credit limit reached |
| `resume_parse_admin_bypass` | Admin exemption applied (not charged) |
| `career_profile_review_saved` | Confirmed data persisted, with counts |
| `career_profile_save_denied` | Entitlement refused a save |
| `resume_extraction_provider_failed` | Provider error; raises a Discord alert |
| `resume_extraction_invalid_output` | Refusal or schema miss; **no** alert |
| `resume_extraction_parse_failed` | Parser could not read the document |
| `resume_storage_read_failed` | Stored file could not be read |

## 11. API

All routes require a session. **There is no `userId` parameter anywhere** — so
there is nothing for a caller to swap. Every response is `private, no-store`.

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/resume/intelligence` | Documents, extractions, access flags, privacy notice, model |
| `POST` | `/api/resume/intelligence` | Analyse; body `{ resumeId?, force? }` |
| `GET` | `/api/resume/intelligence/[id]` | Review payload with current profile for comparison |
| `POST` | `/api/resume/intelligence/[id]/apply` | Save the confirmed selection |

| Status | Code | When |
| --- | --- | --- |
| 400 | `BAD_REQUEST` | Malformed body |
| 401 | `UNAUTHENTICATED` | No session |
| 403 | `PLAN_REQUIRED` | Free plan or expired trial |
| 403 | `USAGE_LIMIT_EXCEEDED` | Monthly credit exhausted |
| 404 | `NOT_FOUND` | No resume, or not accessible |
| 409 | `DUPLICATE_REQUEST` | An identical run is in flight |
| 409 | `CONFLICT` | Profile changed since the review was opened |
| 413 | `PAYLOAD_TOO_LARGE` | Over the file ceiling |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Unsupported or mismatched format |
| 422 | `NO_USABLE_TEXT` | No readable text |
| 429 | `RATE_LIMITED` | Burst limit |
| 503 | `AI_UNAVAILABLE` | Provider down or unconfigured |

Another user's document or extraction returns `404`, identical to one that does
not exist — the response never confirms that a private resume is real.

### Failure codes

Stored failures keep a **code only**; the user-facing copy lives in
`EXTRACTION_ERROR_MESSAGES` and can change without a migration.

`UNSUPPORTED_FORMAT`, `CORRUPT_FILE`, `NO_TEXT_FOUND`, `IMAGE_ONLY_PDF`,
`TOO_LARGE`, `PARSE_FAILED`, `AI_NOT_CONFIGURED`, `AI_RATE_LIMITED`,
`AI_TIMEOUT`, `AI_REFUSED`, `AI_EMPTY_RESPONSE`, `AI_INVALID_RESPONSE`,
`AI_UNAVAILABLE`.

Provider messages, request ids and stack traces never reach the browser.

## 12. Migrations

`prisma/migrations/20261018114814_resume_intelligence/migration.sql`

Generated with `prisma migrate dev`, inspected, applied with
`prisma migrate deploy`. **Entirely additive** — no `DROP`, no destructive
`ALTER`.

- 5 nullable or defaulted columns on `UserProfile`
- 6 new tables: `ResumeDocument`, `ResumeExtraction`, `CareerRecordSource`,
  `CareerExperience`, `CareerEducation`, `CareerSkill`, `CareerProject`,
  `CareerCredential`
- indexes on the actual access patterns, plus the dedupe/lock unique index

The backfill is an `INSERT ... SELECT` guarded by `NOT EXISTS`. Verified against
a database with real rows: 6 users before and after, 5 profiles before and
after, and re-running inserts 0 rows. Profiles whose `resumeUrl` is an empty
string are correctly excluded.

```bash
npm run prisma:migrate:deploy
```

**Do not use `prisma db push` in production, and do not run migrations from a
preview deployment.**

## 13. Local development

```bash
npm run prisma:generate
npm run prisma:migrate:deploy
```

```env
OPENAI_API_KEY="sk-xxxxxxxxx"
# Optional
# RESUME_INTELLIGENCE_MODEL="gpt-4o-mini"
```

Without a key, upload and career profile work normally and analysis returns a
clear "not available right now" message. No test needs a key.

Test commands:

```bash
npm run typecheck
npm test
npm run build
```

## 14. Diagnosing a failed extraction

| Symptom | Cause | Fix |
| --- | --- | --- |
| "not available right now" | Missing or rejected key | Check `OPENAI_API_KEY` in the deployment |
| "service is busy" | Provider rate limit | Retry; the credit is not consumed |
| "took too long" | Provider timeout | Retry |
| "looks like a scan or image" | PDF with no text layer | Export a text-based PDF, or paste into a `.txt` |
| "does not look like a PDF" | Extension/content mismatch | Upload the original document |
| "legacy .doc not supported" | OLE2 binary | Re-save as PDF or DOCX |
| "too large" | Page count or ZIP expansion | Compress or shorten the document |
| Always `NEEDS_REVIEW` | Evidence snippets not found | Expected for inferred data; check the resume text |

Logs carry `resumeId`, `extractionId`, model and truncation state — never
content.

## 15. Security summary

- Server-side validation of auth, ownership, entitlement, input shape, document
  identity and usage — on every endpoint
- Resume upload stays Free; only the AI operation is gated
- Private resumes never become public URLs
- `userId`, `role` and `plan` are derived server-side and ignored from input
- Format decided from magic bytes; unsupported types refused by signature
- Archive bombs refused before decompression
- AI output schema-validated and re-verified against the source text
- Prompt injection treated as untrusted data, with no tools available
- Logs exclude resume content, extracted JSON, credentials and tokens
- Optimistic concurrency prevents silent overwrite

### Known remaining risks

- The resume hash does not include the AI model, so a completed extraction is
  reused across a model change. Versioning by contract is handled; versioning by
  model is not. Acceptable today because reuse is free and a user can force a
  re-run.
- Local development resume uploads are written under `public/`. This is
  pre-existing and development-only; production uses private blobs.
- Extraction runs synchronously inside the request, bounded by the file and text
  limits and a 45-second provider timeout. A future durable queue is a separate
  change and was deliberately not introduced here.

## 16. Further reading

- `docs/AUDIT_RESUME_INTELLIGENCE.md` — what existed before, and why each
  decision was made
- `docs/ARCHITECTURE.md` — monetization, entitlements, usage, scheduled jobs
- `docs/DEPLOYMENT.md` — production runbook