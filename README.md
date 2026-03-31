# Job Seeker OS

Job Seeker OS is a personalized job-search management web app built as a portfolio-ready SaaS MVP. It helps candidates discover, score, track, and manage job applications through one structured workflow.

## What is included in this first zip

This first version is a polished frontend MVP with:

- marketing landing page
- dashboard with KPIs and charts
- job tracker with personalized fit scoring and priority logic
- job detail workspace
- recruiter/contact CRM view
- interview pipeline view
- tailored application queue
- prep packs view
- follow-up templates view
- profile and settings pages
- demo data with browser local persistence
- Prisma schema placeholder for the future full backend

## Tech stack

- Next.js 15
- TypeScript
- Tailwind CSS
- Recharts
- Lucide React

## Why local storage in this first version

To get a portfolio-ready product working immediately, this version uses seeded demo data and browser local storage for state persistence. The repository already includes the data model direction and Prisma schema foundation so the next iteration can move to PostgreSQL and authentication.

## Getting started

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Build

```bash
npm run build
npm run start
```

## Project structure

```txt
src/
  app/
    (marketing)/
    (auth)/
    (app)/
  components/
  hooks/
  lib/
  types/
prisma/
```

## Key product logic

### Personalized fit scoring

This version now reads user preferences from the Settings page and recalculates job rankings based on target level, preferred regions, preferred titles, salary floor, remote preference, and must-have tech.

### Base scoring weights

- Core stack match — 25%
- Role alignment — 15%
- Seniority fit — 15%
- Geography eligibility — 10%
- Time-zone compatibility — 10%
- Compensation fit — 10%
- Domain relevance — 5%
- Application friction — 5%
- Signal quality — 5%

### Priority flags

- Apply Today
- Apply This Week
- Prepare Assets
- Follow Up Due
- Interview Soon
- Monitor
- Skip

## Current limitations

- personalization is stored in local storage rather than a shared backend profile

- authentication is stubbed for this first version
- data is stored in local storage instead of a real database
- editing flows are intentionally light in this first zip
- mobile app is not yet implemented

## Next steps (In subsequent releases)

1. add Auth.js / NextAuth
2. connect Prisma to PostgreSQL
3. move local state to database-backed CRUD
4. add richer forms and editing flows
5. add email reminders and browser extension ingestion
6. (deploy to Vercel)
