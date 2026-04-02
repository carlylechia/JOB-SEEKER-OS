import Link from 'next/link';
import { Logo } from '@/components/shared/logo';

export default function DemoPage() {
  return (
    <div className="shell py-12">
      <div className="max-w-4xl space-y-6">
        <Logo />
        <div className="card-pad space-y-4">
          <h1 className="text-3xl font-semibold">Product overview</h1>
          <p className="text-muted">This deployed MVP already includes a personalized dashboard, tracker, queue, CRM, prep packs, and now an auth + database foundation for persistent user workspaces.</p>
          <ul className="list-disc space-y-2 pl-6 text-muted">
            <li>Secure email/password authentication</li>
            <li>PostgreSQL-backed user profiles, preferences, jobs, and templates</li>
            <li>Seeded starter workspace on registration</li>
            <li>Personalized ranking driven by saved profile settings</li>
          </ul>
          <div className="flex flex-wrap gap-3 pt-2">
            <Link href="/register" className="btn-primary">Create account</Link>
            <Link href="/login" className="btn-secondary">Sign in</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
