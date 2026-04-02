# Job Seeker OS

Job Seeker OS is a personalized job-search management web app built as a portfolio-ready SaaS MVP. It helps candidates discover, score, track, and manage job applications through one structured workflow.

## Features

Job Seeker OS includes:

- marketing landing page
- authenticated user dashboard with KPIs and charts
- job tracker with personalized fit scoring and priority logic
- job detail workspace
- recruiter/contact CRM view
- interview pipeline view
- tailored application queue
- prep packs view
- follow-up templates view
- profile and settings pages
- persistent data storage across sessions

## Tech stack

Built with modern, production-ready tools:

- Next.js 15
- TypeScript
- Tailwind CSS
- Auth.js (for authentication)
- Prisma ORM
- PostgreSQL
- Recharts (for dashboard visualizations)
- Lucide React (for icons)

## Data Persistence

As of v2.0, Job Seeker OS uses PostgreSQL with Prisma ORM for all data persistence. Initialize the database with `npm run prisma:push` and optionally seed sample data with `npm run prisma:seed`.

## Development

```bash
npm run dev
```

Open `http://localhost:3000`.

## Production Build

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

## Architecture

As of v2.0, Job Seeker OS is a full-stack SaaS application with:

- **Email/password authentication** using Auth.js with Credentials provider
- **Protected app routes** behind login walls
- **PostgreSQL + Prisma** for persistent data storage
- **Seeded starter workspace** created on user registration
- **User-driven fit scoring** based on saved profile preferences

## Setup

```bash
npm install
cp .env.example .env.local
npm run prisma:generate
npm run prisma:push
npm run dev
```

**Required environment variables:**
```env
DATABASE_URL="postgresql://[user]:[password]@[host]:5432/job_seeker_os?schema=public"
AUTH_SECRET="[generate-a-random-string]"
AUTH_URL="http://localhost:3000"
```

To seed initial demo data:
```bash
npm run prisma:seed
```

## Planned Features

- Structured job add/edit forms
- Enhanced job ingestion from links
- Email reminders and notifications
- Browser extension for quick job capture
- AI-assisted fit explanations

## Release History

### v2.0 — Auth + Database (Current)
**Transition from MVP to SaaS-ready application**

- Email/password authentication via Auth.js Credentials provider
- PostgreSQL database backend with Prisma ORM
- Protected routes and user session management
- Seeded starter workspace on user registration
- Persistent user data: jobs, contacts, templates, preferences
- User-driven personalized fit scoring based on profile settings
- Logo/favicon system for future custom branding
- Vercel and production deployment ready

**Setup:** See [Setup](#setup) section above.

### v1.0 — Frontend MVP
**Initial portfolio-ready prototype**

- Marketing landing page and demo view
- Authenticated dashboard with KPI cards and weekly trends
- Job tracker with mock scoring and priority badges
- CRM contacts view
- Interview pipeline tracker
- Application queue management
- Prep packs and templates views
- Profile and settings pages
- Browser local storage for session persistence
- Responsive design with Tailwind CSS and Lucide icons
