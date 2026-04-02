import { PageHeader } from '@/components/shared/page-header';
import Link from 'next/link';

export default function NewJobPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Add Job Lead" subtitle="Database-backed auth is live in this release. Structured job add/edit forms land in the next release." />
      <div className="card-pad space-y-4">
        <p className="text-muted">This auth+database release focuses on secure accounts, user workspaces, seeded data, and persistent preferences. The next feature branch will add the full job form and editing workflow.</p>
        <div className="flex gap-3">
          <Link href="/jobs" className="btn-primary">Back to jobs</Link>
          <Link href="/settings" className="btn-secondary">Update scoring preferences</Link>
        </div>
      </div>
    </div>
  );
}
