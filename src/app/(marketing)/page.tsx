import Link from 'next/link';
import { BriefcaseBusiness, ChartColumnIncreasing, Users } from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="shell py-12">
      <header className="flex items-center justify-between">
        <div>
          <div className="text-xl font-semibold">Job Seeker OS</div>
          <p className="muted mt-1">A personalized operating system for modern job seekers</p>
        </div>
        <div className="flex gap-3">
          <Link className="btn-secondary" href="/demo">Live Demo</Link>
          <Link className="btn-primary" href="/dashboard">Open App</Link>
        </div>
      </header>

      <section className="grid gap-10 py-20 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
        <div>
          <span className="badge bg-accent/15 text-blue-200">Portfolio-ready SaaS MVP</span>
          <h1 className="mt-5 text-5xl font-semibold leading-tight">Track, score, and manage your job search like a system.</h1>
          <p className="mt-5 max-w-2xl text-lg text-muted">Job Seeker OS turns a messy spreadsheet-driven hunt into one clean workflow: opportunity scoring, recruiter CRM, interview prep, follow-ups, and a dashboard that tells you what to do next.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link className="btn-primary" href="/dashboard">Launch Demo Workspace</Link>
            <Link className="btn-secondary" href="/demo">View Product Overview</Link>
          </div>
        </div>
        <div className="card-pad">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-line p-4">
              <div className="text-sm text-muted">Best-fit jobs</div>
              <div className="mt-2 text-3xl font-semibold">12</div>
            </div>
            <div className="rounded-2xl border border-line p-4">
              <div className="text-sm text-muted">Avg fit score</div>
              <div className="mt-2 text-3xl font-semibold">78.4</div>
            </div>
            <div className="rounded-2xl border border-line p-4">
              <div className="text-sm text-muted">Follow-ups due</div>
              <div className="mt-2 text-3xl font-semibold">4</div>
            </div>
            <div className="rounded-2xl border border-line p-4">
              <div className="text-sm text-muted">Interviews this week</div>
              <div className="mt-2 text-3xl font-semibold">2</div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-3">
        {[
          { icon: BriefcaseBusiness, title: 'Job Tracker', text: 'Save and score roles, centralize links, and know which opportunities deserve effort.' },
          { icon: Users, title: 'Contacts CRM', text: 'Track recruiters, referrals, outreach, and follow-up timing in one place.' },
          { icon: ChartColumnIncreasing, title: 'Action Dashboard', text: 'See top-priority jobs, weekly trends, interviews, and submission readiness at a glance.' }
        ].map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.title} className="card-pad">
              <Icon className="h-8 w-8 text-accent" />
              <h3 className="mt-4 text-xl font-semibold">{item.title}</h3>
              <p className="mt-2 text-muted">{item.text}</p>
            </div>
          );
        })}
      </section>
    </div>
  );
}
