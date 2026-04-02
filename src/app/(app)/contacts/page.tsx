'use client';

import { PageHeader } from '@/components/shared/page-header';
import { useJobs } from '@/hooks/use-job-data';

export default function ContactsPage() {
  const { contacts, isLoading } = useJobs();
  if (isLoading) return <div className="card-pad">Loading contacts…</div>;

  return (
    <div className="space-y-6">
      <PageHeader title="Contacts CRM" subtitle="Track recruiters, hiring managers, referrals, and follow-ups." />
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Name</th><th>Company</th><th>Title</th><th>Type</th><th>Next follow-up</th></tr></thead>
          <tbody>
            {contacts.map((contact) => (
              <tr key={contact.id}>
                <td className="font-medium">{contact.name}</td>
                <td>{contact.company}</td>
                <td>{contact.title}</td>
                <td>{contact.relationshipType}</td>
                <td>{contact.nextFollowUp || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
