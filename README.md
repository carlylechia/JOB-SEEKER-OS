# Job Seeker OS

Job Seeker OS is a personalized job-search management web app built as a portfolio-ready SaaS MVP. It helps candidates discover, score, track, and manage job applications through one structured workflow.

---

## Overview

Job Seeker OS is designed to turn a messy, spreadsheet-driven job hunt into a focused system.

Instead of tracking opportunities across scattered notes, documents, and tabs, the app gives users one place to:

- save and manage job leads
- score job fit against their personal profile
- track recruiters and contacts
- prepare for interviews
- manage follow-ups
- monitor progress through a clear dashboard
- ingest job links and pasted descriptions faster

---

## Current Features

The project currently includes:

- marketing landing page with modern product storytelling
- authenticated user dashboard with KPIs and charts
- onboarding flow for job-search preferences
- job tracker with personalized fit scoring and priority logic
- job ingestion from job links or pasted descriptions
- job detail workspace
- recruiter/contact CRM view
- interview pipeline view
- tailored application queue
- prep packs view
- follow-up templates view
- profile and settings pages
- persistent database-backed storage
- responsive navigation for both app and marketing pages
- Vercel Analytics integration

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
- **User-driven personalized fit scoring**
- **Onboarding-based preference capture** for better first-run relevance
- **Responsive app shell** with authenticated and marketing navigation split cleanly
- **Server-first public pages** with client components only where interactivity is needed
- **Vercel deployment** with production-ready environment setup

---

## Product Logic

### Personalized Fit Scoring

Job Seeker OS uses user preferences to score and prioritize opportunities.

Scoring is driven by factors such as:

- target seniority level
- preferred regions
- preferred titles
- salary expectations
- remote preference
- timezone compatibility
- must-have tech stack requirements

### Base Scoring Weights

- Core stack match — 25%
- Role alignment — 15%
- Seniority fit — 15%
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

This release continues the backend protections and operational safeguards already in place:

- request validation with **Zod**
- text and URLs sanitized before persistence
- lightweight **per-user / per-IP rate limiting** on important endpoints
- structured API error handling
- Discord-compatible webhook alerts for important unexpected production issues via `ALERT_WEBHOOK_URL`
- important CRUD and ingestion failures logged without noisy spam
- Prisma indexes added for common job access patterns

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

- `.env.local` is used by the Next.js app runtime
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

Open:

```txt
http://localhost:3000
```

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

### Create your local environment file

Example:

```env
DATABASE_URL="postgresql://jobseekeros:YOUR_PASSWORD@localhost:5432/job_seeker_os?schema=public"
AUTH_SECRET="YOUR_SECRET"
AUTH_URL="http://localhost:3000"
```

Then copy it for Prisma:

```bash
cp .env.local .env
```

---

## Environment Variables

Required:

- `DATABASE_URL`
- `AUTH_SECRET`
- `AUTH_URL`

Optional:

- `CORS_ORIGIN` — only if cross-origin API access is needed
- `ALERT_WEBHOOK_URL` — Discord-compatible webhook for important production issue alerts

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
    marketing/
    jobs/
    onboarding/
  hooks/
  lib/
  types/
prisma/
public/
```

---

## Analytics and Metadata

The app includes **Vercel Analytics** in the root layout.

It also configures metadata with:

- default title
- title template
- description
- favicon
- apple touch icon

This keeps branding and observability consistent in production.

---

## Release History

### v5.0 — Onboarding + Job Ingestion (Current Release)

This release adds:

- onboarding flow for user-specific search preferences
- first-run preference capture after account creation
- job ingestion from links and pasted descriptions
- parser-driven prefill into the job form
- secure ingestion route with validation, rate limiting, and alerting
- dashboard onboarding CTA for incomplete profiles
- Discord-compatible alert formatting in observability utilities

### v4.0 — Landing Page Redesign + Marketing Polish

This release added:

- redesigned landing page with stronger product positioning
- smoother section flow and premium visual hierarchy
- hero carousel and richer public storytelling
- professional footer and smoother landing-page transitions
- server-first marketing architecture with small client components only where needed

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

**Transition from frontend MVP to SaaS-ready application**

This release added:

- Email/password authentication via Auth.js Credentials provider
- PostgreSQL database backend with Prisma ORM
- Protected routes and user session management
- Seeded starter workspace on user registration
- Persistent user data for jobs, contacts, templates, and preferences
- User-driven personalized fit scoring based on profile settings
- Logo/favicon system for production branding
- Vercel deployment readiness

### v1.0 — Frontend MVP

**Initial portfolio-ready prototype**

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

- stronger job-detail workflow polish
- AI-assisted fit explanations
- email reminders and notifications
- browser extension for quick job capture
- smart daily best-fit job recommendations

---

## Long-Term Product Direction

Job Seeker OS is gradually evolving across three layers:

1. **Workflow layer**  
   Track and manage the job search process

2. **Decision layer**  
   Score and prioritize opportunities

3. **Intelligence layer**  
   Recommend what to apply to next and explain why

---