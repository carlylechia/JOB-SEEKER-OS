# Audit — Professional Documents and One-Page Resumes

Branch: `feat/pro-document-quality-one-page-resumes`  
Base: `origin/main` at `a80419e`  
Audit date: 2026-10-23

## What is already present on this base

The current branch includes the monetization/entitlement foundation, Resume
Intelligence, Job Intelligence, the structured resume builder and job-specific
resume optimization, AI application materials, and the career queue. These are
present in the source tree and database schema; this work does not assume that a
separate planned release is still outstanding.

The structured resume flow is separate from uploaded `ResumeDocument` files.
`StructuredResume` stores validated JSON and has independent source-resume and
target-job relations. Copies are deep copies with fresh entry IDs. Resume
builder and optimization operations already use the central subscription and
usage services. PDF downloads load the document with both `id` and session
`userId`, are streamed on demand, and use private no-store headers.

## Current rendering and inspected outputs

`src/lib/resume-builder/templates.ts`, `layout.ts`, `serve.ts`, and `pdf.ts`
provide three templates and a single measured, top-left-coordinate layout used
by both the browser preview and `pdf-lib`. The PDF uses locally bundled Inter
TTF fonts. The only page size is A4 (595.28 × 841.89 points), with fixed 46 pt
margins. The renderer adds one PDF page for each layout page and returns that
page count. It does not reopen the serialized PDF to independently inspect the
page tree.

Before changes, synthetic typical and long resumes were exported to PDF and
rendered with macOS Quick Look for visual inspection. All three templates
produced one page for the typical fixture; the long classic fixture produced
four pages. The inspected pages had selectable, readable text, consistent
section hierarchy, margins, aligned dates, and no visible overlap or clipping.
The modern template's filled gold name panel is more visually prominent than
the ATS Classic and Technical Minimal designs. The long fixture flowed to
multiple pages without shrinking typography. Existing PDF tests also read text
back through `unpdf` and exercise Unicode, long tokens, multi-page flow,
geometry, and orphan-heading behavior.

## Gaps and root causes

1. **No actual one-page workflow.** There is no content selector, omitted-item
   report, proposal review, restore/remove controls, or separate saved
   one-page version. The layout engine correctly paginates long resumes, so
   changing its density cannot satisfy this requirement safely.
2. **Template library is incomplete.** `templates.ts` has Classic ATS, Modern
   Professional, and Technical Minimal, but no executive/experienced design.
   The three templates share hierarchy more closely than the requested four
   use cases.
3. **Page configuration is fixed.** A4 and its margins are constants in
   `layout.ts`; neither the user nor a document can select US Letter.
4. **Letter layout is approximate and incomplete.**
   `application-materials/letter-layout.ts` wraps with average-character
   estimates rather than the embedded font metrics and turns all content into
   plain body lines. It has no structured applicant/date/recipient layout, does
   not take `subject`, and can orphan a paragraph across pages. PDF export is
   correctly owner-scoped, but only cover letters support it. Short messages
   remain plain text, as appropriate.
5. **Quality feedback is split across validation layers.** Zod protects
   structures and the PDF renderer reports unsupported characters and empty
   content, but there is no user-facing document review report for repeated
   bullets, missing role metadata, long summaries, or export page constraints.
6. **Export checks are geometric.** The renderer's reported page count is the
   number of pages it added from the layout. The route does not independently
   reopen the final PDF and verify its page tree before reporting a successful
   one-page export.
7. **No DOCX renderer or browser E2E setup exists.** PDF is the only genuine
   document export. The repository's tests use `node:test`; there is no
   Playwright configuration.

## Existing safeguards to preserve

Resume content, request bodies, and jobs are Zod-validated. AI resume
optimization has a no-tools provider, strict output contracts, evidence checks,
and server-side anti-fabrication verification. Existing application material
generation separately verifies candidate claims and uses `AI_COVER_LETTER`
with shared credit accounting. Do not add a parallel entitlement, profile
writeback, or direct client-controlled document mutation path.

No database change or export has been made during this audit. The implementation
will extend the existing structured document, measured layout, private export,
and entitlement architecture.
