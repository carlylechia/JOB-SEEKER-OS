# Intelligent Job Capture

The job-capture flow (`/jobs/new`) turns an unstructured posting into a fully filled job tracker record: title, company, location, compensation, requirements, contacts and source metadata. It is designed so that **AI never becomes a guessing machine**: the model is a parser, not an analyst.

## Inputs

Users may supply any combination of:

- a posting URL
- pasted text (including messy copy/paste with navigation or boilerplate)
- up to three screenshots of the job advert (JPEG, PNG or WebP)

Images are downscaled in the browser to 1600 px before upload. The server then enforces its own limits rather than trusting the client:

| Limit | Value |
| :--- | :--- |
| Maximum images | 3 |
| Maximum per image (after compression) | 2 MB |
| Maximum combined | 4.5 MB |
| Minimum size | 64 bytes (guards empty/1×1 uploads) |
| Accepted types | `image/jpeg`, `image/png`, `image/webp` |

Each image must carry its declared MIME type **and** a matching magic-byte signature. The server decodes and validates before building the request to the model. Invalid images are rejected with a user-facing 422.

## AI contract

The model receives the pasted text, the images (if any), and the system prompt in `src/lib/job-ingestion/schema.ts`. The output is constrained to a strict `zod` object using OpenAI Structured Outputs; the server does no JSON repair and does not trust the model with tools or network access.

The contract includes:

- core role fields (title, company, location, compensation, remote/hybrid/onsite, employment type, seniority, category)
- a short, job-aware `jobDescription`
- structured `requirements`, split into MUST_HAVE / NICE_TO_HAVE / RESPONSIBILITY / QUALIFICATION / BENEFIT
- `skills`, `industry`, company size, website and LinkedIn profile
- recruiter/contact rows: name, title, email, phone, LinkedIn URL and relationship type
- `applicationUrl`, `source`, `confidence` and human-readable `warnings`

If a field is not visible in the input, the model must return an empty value rather than invent one.

## Normalisation and safeguards

Model output is never written straight to the form. `src/lib/job-ingestion/normalize.ts`:

- clips and cleans every string, deduplicates requirements and skills, caps array sizes
- maps category and seniority to the canonical taxonomy (`src/lib/job-discovery/categories.ts`)
- annualises hourly/daily/weekly/monthly salaries using `annualiseSalary`; hourly uses 2,080 billable hours, monthly ×12, etc.
- swaps reversed salary bounds, rejects absurd values (>10M), requires a valid 3-letter currency
- keeps only LinkedIn URLs on `linkedin.com` / subdomains; strips other hosts
- validates contact email shape, deduplicates contacts and caps them at five
- preserves the deterministic parsers’ fallback values for anything the model leaves blank
- never accepts a fit score from the model; scoring stays server-side and deterministic

Notes written before capture are passed through unchanged. AI never edits them.

## Fallback behaviour

When AI is not configured, times out, is rate-limited, refuses the posting, or returns an unusable object, the endpoint does **not** pretend to have succeeded:

- deterministic extraction still prefills the form (title/company/location/salary/URL parsing), or
- the API returns a closed `JobIngestionAiError` code (`AI_TIMEOUT`, `AI_RATE_LIMITED`, `AI_UNAVAILABLE`, `AI_REFUSED`, `AI_INVALID_RESPONSE`, `AI_NOT_CONFIGURED`).

The result payload exposes `ai.used`, `ai.fallbackReason`, `model`, `imageCount`, `confidence`, `warnings` and `sourceMode` (`url`, `description`, `image`, `image+url`, …) so the UI can be honest about how the prefill was produced.

## Configuration

| Variable | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| `OPENAI_API_KEY` | Yes (AI path) | — | Server-side OpenAI key. Never exposed to the browser |
| `JOB_INGESTION_MODEL` | No | `gpt-4.1-mini` | Structured-Outputs-capable model for capture |
| `JOB_INGESTION_AI_TIMEOUT_MS` | No | `30000` | Timeout in ms, clamped to 5,000–60,000 |

If `OPENAI_API_KEY` is absent, image capture still validates input, but AI analysis is reported as unavailable rather than faked.

## Data model

Captured records are stored on `JobLead` with dedicated columns and indexes: `employmentType`, `seniority`, `category`, `industry`, `skills` (`String[]`), `requirements` (JSON), `companyProfile` (JSON) and `ingestionMeta` (JSON). Contact JSON rows may include `email`, `phone` and `linkedinUrl`.

The public jobs page may show these records to anonymous visitors. It intentionally selects no private fields: `notes`, profile data, scores and application history are never included in the public query.

## Known limits

- A screenshot is parsed only as far as it is legible; very small text or heavy image compression reduces extraction confidence.
- The model is bounded to what the posting says. It cannot infer salary, visa policy or company size that is not present.
- Requirements and contacts are extracted, not verified. The UI flags them as "extracted by AI — verify before outreach".
