# Job Seeker OS

Job Seeker OS is a personalized job-search management web app built as a portfolio-ready SaaS MVP. It helps candidates discover, score, track, and manage job applications through one structured workflow.

---

## Overview

Job Seeker OS turns a scattered, spreadsheet-driven job hunt into a focused workflow for serious candidates.

Instead of juggling notes, reminders, browser tabs, and disconnected documents, the app gives users one place to:

- save and manage job leads
- score job fit against real personal preferences
- track recruiters and contacts
- prepare for interviews
- manage follow-ups
- browse public jobs shared on the platform
- monitor search progress from a dashboard

---

## Current Features

The project currently includes:

- premium marketing landing page with responsive mobile navigation
- authenticated user dashboard with KPIs and charts
- private job tracker with database-backed CRUD
- personalized fit scoring and priority logic
- job detail workspace
- recruiter/contact CRM view
- interview pipeline view
- tailored application queue
- prep packs view
- follow-up templates view
- onboarding flow for preference setup
- job ingestion from links and pasted descriptions
- profile management page
- public jobs page (last 30 days)
- persistent PostgreSQL-backed storage
- Vercel Analytics integration
- Discord-compatible production alerting for important route failures

---

## Tech Stack

Built with modern production-ready tools:

- **Next.js 15.2.8**
- **React 19**
- **TypeScript**
- **Tailwind CSS**
- **Auth.js / NextAuth**
- **Prisma ORM**
- **PostgreSQL**
- **Recharts**
- **Lucide React**
- **Vercel Analytics**

---

## Architecture

As of the current release, Job Seeker OS is a full-stack SaaS application with:

- **Email/password authentication** using Auth.js Credentials provider
- **Protected app routes** behind login
- **PostgreSQL + Prisma** for persistent data storage
- **Private per-user job workspaces**
- **Public jobs discovery** for roles added by users in the last 30 days
- **User-driven personalized fit scoring**
- **Server-first public pages** with client components only where interactivity is needed
- **Vercel deployment** with production-ready environment setup

---

## Product Logic

### Personalized Fit Scoring

Job Seeker OS uses user preferences to score and prioritize opportunities.

Scoring is driven by factors such as:

- current and target seniority level
- primary job titles and adjacent preferred titles
- preferred regions
- preferred stack
- must-have technologies
- timezone overlap
- salary expectations
- remote preference

### Title Match Rule

Job title matching is now the strongest personalization signal.

- private dashboards only show jobs added by the signed-in user
- jobs are still scored even when title match is weak
- weaker title alignment produces a lower score
- public jobs can be added into a user workspace and scored against that user’s preferences

### Base Scoring Weights

- Core stack match — 25%
- Role alignment — 17%
- Seniority fit — 20%
- Geography eligibility — 10%
- Time-zone compatibility — 10%
- Compensation fit — 10%
- Domain relevance — 5%
- Application friction — 5%
- Signal quality — 5%

### Priority Flags

- Apply Today
- Apply This Week
- Prepare Assets
- Follow Up Due
- Interview Soon
- Monitor
- Skip

---

## Security and Reliability Notes

Current protections and operational safeguards include:

- request validation with **Zod**
- text and URL sanitization before persistence
- lightweight **per-user / per-IP rate limiting** on important endpoints
- structured API error handling
- optional Discord-compatible webhook alerts through `ALERT_WEBHOOK_URL`
- important unexpected route failures logged without noisy spam
- Prisma indexes for common job access patterns

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create local environment files

```bash
cp .env.example .env.local
cp .env.local .env
```

- `.env.local` is used by the Next.js runtime
- `.env` is used by Prisma CLI commands

### 3. Generate Prisma client

```bash
npm run prisma:generate
```

### 4. Push the schema

```bash
npm run prisma:push
```

### 5. Optionally seed sample data

```bash
npm run prisma:seed
```

### 6. Start development server

```bash
npm run dev
```

Open `http://localhost:3000`.

---

## Local Database Setup

If you are using PostgreSQL installed with Homebrew on macOS:

### Start PostgreSQL

For PostgreSQL 16:

```bash
brew services start postgresql@16
```

Check status:

```bash
brew services list
pg_isready
```

### Example local env file

```env
DATABASE_URL="postgresql://jobseekeros:YOUR_PASSWORD@localhost:5432/job_seeker_os?schema=public"
AUTH_SECRET="YOUR_SECRET"
AUTH_URL="http://localhost:3000"
```

---

## Environment Variables

Required:

- `DATABASE_URL`
- `AUTH_SECRET`
- `AUTH_URL`

Optional:

- `CORS_ORIGIN`
- `ALERT_WEBHOOK_URL`

---

## Scripts

```bash
npm run dev
npm run build
npm run start
npm run lint
npm run prisma:generate
npm run prisma:push
npm run prisma:seed
npm run prisma:studio
```

---

## Project Structure

```txt
src/
  app/
    (marketing)/
    (auth)/
    (app)/
    api/
  components/
  hooks/
  lib/
  types/
prisma/
public/
```

---

## Analytics and Metadata

The app includes **Vercel Analytics** in the root layout.

Metadata is configured with:

- default title
- title template
- description
- favicon
- apple touch icon

---

## Release History

### v6.0 — Taxonomy, Profile, Public Jobs, and Homepage UX (Current Release)

This release adds:

- footer cleanup and footer-gap fix
- floating homepage quick-jump navigation
- public jobs page for roles shared in the last 30 days
- save-to-workspace flow for public jobs
- dynamic job title taxonomy stored in the database
- searchable dropdown-style title selection with add-new support
- settings page converted away from stale autofilled text fields
- profile page moved away from hardcoded values to real user-backed data
- private dashboards now rely only on user-owned jobs
- no seeded job data in starter workspaces
- title match emphasized in score calculation
- improved ingestion heuristics for title, company, metadata, and stack extraction

### v5.0 — Onboarding + Job Ingestion

This release added:

- onboarding flow inside the authenticated app
- onboarding completion persistence
- onboarding-aware first-run dashboard CTA
- secure ingestion from job links and pasted descriptions
- parser-driven job-form prefilling
- safer URL handling for ingestion
- route-level alerting added to important new endpoints

### v4.0 — Landing Page Redesign / Marketing Polish

This release added:

- premium landing page redesign
- richer section storytelling
- lazy-loaded generated demo media
- mobile marketing navigation
- improved footer and responsive public-page UX foundation

### v3.0 — Job CRUD + Detail Workspace

This release added:

- database-backed job CRUD
- reusable job form
- richer job detail workspace
- profile-aware fit recalculation on save
- input validation and sanitization for job endpoints
- lightweight CORS handling
- endpoint rate limiting
- important event/error logging with optional webhook alerting
- extra Prisma indexes for common job queries

### v2.0 — Auth + Database

This release added:

- email/password authentication via Auth.js Credentials provider
- PostgreSQL database backend with Prisma ORM
- protected routes and user session management
- seeded starter workspace on user registration
- persistent user data for jobs, contacts, templates, and preferences
- user-driven personalized fit scoring based on profile settings
- logo/favicon system for production branding
- Vercel deployment readiness

### v1.0 — Frontend MVP

This release included:

- marketing landing page and demo view
- authenticated dashboard with KPI cards and weekly trends
- job tracker with mock scoring and priority badges
- CRM contacts view
- interview pipeline tracker
- application queue management
- prep packs and templates views
- profile and settings pages
- browser local storage persistence
- responsive design with Tailwind CSS and Lucide icons

---

## Planned Features

Upcoming work includes:

- stronger AI-assisted fit explanations
- smarter public job recommendations
- daily best-fit jobs shortlist
- email reminders and notifications
- browser extension for quick job capture
- deeper workflow polish for job detail and prep systems

---