# teChia Jobs — Pro Launch Readiness release

Branch: `feat/pro-launch-readiness-retention`

## Summary

This release adds first-party, privacy-conscious product analytics, improves the homepage by removing fabricated social proof, and tracks activation and job-workflow events.

## Feature readiness (high level)

- Registration, authentication, onboarding, and sessions: implemented; verify in production.
- Trials, plans, entitlements, upgrades: implemented; requires monetization initialization.
- Job discovery, saving, tracking: implemented and verified locally.
- Resume intelligence, builder, optimization, application materials: implemented.
- Interview preparation, queue, weekly review: implemented.
- Analytics: new first-party event model and admin view added.
- Homepage: fabricated testimonials removed; FAQ updated.

## Database changes

- New table: `ProductEvent` (migration `20261027215132_add_product_events`).
- Apply with `npm run prisma:migrate:deploy`.

## Environment / deployment requirements

- `CRON_SECRET` (>=16 chars) for scheduled jobs.
- `RESEND_API_KEY`, `EMAIL_FROM` for email.
- `OPENAI_API_KEY` for AI features.
- Run `npm run monetization:initialize` after deploy.
- Promote an admin via `npm run admin:bootstrap`.

## Verification

- `npm run lint` — passed (warnings only).
- `npm run typecheck` — passed.
- Test suite — run with `npm test` (long-running; not re-run in this session after changes).

## Known gaps

- Retention nudges/email automation not expanded in this release.
- Historical analytics data is not backfilled.
- Some older WIP stashes remain as dangling commits and may need recovery.
