# Job Seeker OS

Job Seeker OS is a full-stack job search operating system for candidates who want more structure than a spreadsheet and more clarity than a generic tracker.

It combines AI-assisted fit scoring, a daily action queue, pipeline tracking, recruiter CRM, onboarding, public job discovery, and auth/account workflows into one application.

## What It Does

Job Seeker OS gives users one place to:

- capture and manage job leads
- score roles against personal preferences
- prioritize the best next action each day
- track pipeline movement from saved lead to offer
- manage recruiter and referral relationships
- prepare for interviews with structured prep packs
- browse and import public jobs into a private workspace
- maintain momentum with streaks, reminders, and notifications

## Current Product Surface

### Core app

- AI fit scoring with explainable sub-signals
- private job workspace with CRUD and detail views
- daily smart queue for ranked next actions
- drag-and-drop application pipeline
- per-job recruiter/contact CRM
- follow-up scheduling and reminders
- dashboard with KPI cards, weekly trends, top priorities, streaks, and upcoming items
- interview prep workspace and reusable follow-up templates

### Intake and onboarding

- multi-step onboarding flow with autosaved progress
- onboarding skip and complete flows
- resume upload and parsing
- profile picture upload support
- preference-driven scoring setup for titles, stack, salary, timezone, and remote fit
- job ingestion from pasted descriptions and job URLs

### Auth and account flows

- email/password auth with Auth.js
- LinkedIn sign-in
- email verification flow
- forgot password and reset password flows
- protected app routes with per-user workspaces

### Public and marketing surface

- redesigned landing page and demo experience
- public jobs browser for recent platform jobs
- save-to-workspace flow for public jobs
- Vercel Analytics integration

## Tech Stack

- Next.js 15
- React 19
- TypeScript
- Tailwind CSS
- Auth.js / NextAuth
- Prisma ORM
- PostgreSQL
- Zod
- Recharts
- Lucide React
- Vercel Analytics
- Resend

## Architecture Notes

- Server-rendered App Router application with focused client-side interactivity where needed
- JWT session strategy via Auth.js
- Prisma + PostgreSQL persistence for users, profiles, jobs, notifications, templates, and public job data
- per-user workspaces for private data isolation
- public job discovery with authenticated import into private workspaces
- request validation, sanitization, and lightweight rate limiting on important endpoints
- observability hooks for important route failures and product events

## Scoring Model

Job fit is personalized using profile and preference data such as:

- target job titles
- current and target seniority
- preferred stack and technologies
- location and timezone overlap
- remote preference
- salary expectations
- job signal quality and friction

Priority states are then used to surface what matters now, including:

- apply today
- apply this week
- follow up due
- interview soon
- prepare assets
- monitor
- skip

## Security and Reliability

- schema validation with Zod
- sanitized text, URL, and array inputs before persistence
- lightweight per-user and per-IP rate limiting on key routes
- structured error handling for API responses
- optional webhook-based alerting for important failures
- database indexes for common query paths

## Local Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create environment files

```bash
cp .env.example .env.local
cp .env.local .env
```

### 3. Configure environment variables

Minimum local setup:

```env
DATABASE_URL="postgresql://jobseekeros:password@localhost:5432/job_seeker_os?schema=public"
AUTH_SECRET="replace-with-a-long-random-secret"
AUTH_URL="http://localhost:3000"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

If you want email flows locally, also set:

```env
RESEND_API_KEY="re_xxxxxxxxx"
EMAIL_FROM="Job Seeker OS <noreply@yourdomain.com>"
EMAIL_REPLY_TO="support@yourdomain.com"
```

If you want LinkedIn auth locally, also set:

```env
LINKEDIN_CLIENT_ID="your-linkedin-client-id"
LINKEDIN_CLIENT_SECRET="your-linkedin-client-secret"
```

Optional:

- `CORS_ORIGIN`
- `ALERT_WEBHOOK_URL`

### 4. Generate Prisma client

```bash
npm run prisma:generate
```

### 5. Push the schema

```bash
npm run prisma:push
```

### 6. Optionally seed local data

```bash
npm run prisma:seed
```

### 7. Start the app

```bash
npm run dev
```

Open `http://localhost:3000`.

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

## Demo

The demo route highlights the current product surface:

- dashboard and queue workflows
- fit scoring
- pipeline tracking
- recruiter CRM
- interview prep
- streaks, notifications, and ingestion flows
- auth and onboarding improvements

## Status

This repository is actively evolving. Recent branch work expanded:

- onboarding and resume parsing
- notification and streak systems
- LinkedIn auth and password recovery
- queue workflows and dashboard depth
- marketing storytelling and product walkthroughs
- favicon and branding consistency

The next releases are expected to be much more AI-intensive, including:

- smart resume building
- AI job fetching and ranking
- AI-assisted auto-apply workflows
- smarter suggestions across queue, scoring, and execution
