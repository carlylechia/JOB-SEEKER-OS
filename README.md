# Job Seeker OS

Job Seeker OS is a personalized job-search management web app built as a portfolio-ready SaaS MVP. It helps candidates discover, score, track, and manage job applications through one structured workflow.

## What is included in this first version

This first version is a polished frontend MVP with:

- marketing landing page
- dashboard with KPIs and charts
- job tracker with fit scoring and priority logic
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

### Fit scoring weights

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

- authentication is stubbed for this first version
- data is stored in local storage instead of a real database
- editing flows are intentionally light in this first zip
- mobile app is not yet implemented
