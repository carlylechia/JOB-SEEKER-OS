'use client';

import Link from 'next/link';
import { useState } from 'react';
import { PageHeader } from '@/components/shared/page-header';
import { useJobs } from '@/hooks/use-job-data';
import { Contact, EnrichedContact } from '@/types';

const RELATIONSHIP_TYPES = ['RECRUITER', 'HIRING_MANAGER', 'REFERRAL', 'NETWORK', 'OTHER'];
const EMPTY_FORM = { name: '', company: '', title: '', relationshipType: 'RECRUITER', outreachDate: '', responseDate: '', nextFollowUp: '', notes: '' };

type ContactFormData = Omit<Contact, 'id'>;

function ContactModal({
  initial,
  jobId,
  jobOptions,
  selectedJobId,
  onSelectJob,
  onSave,
  onClose,
  saving,
}: {
  initial: ContactFormData;
  jobId?: string;
  jobOptions: { id: string; label: string }[];
  selectedJobId: string;
  onSelectJob: (id: string) => void;
  onSave: (data: ContactFormData) => Promise<void>;
  onClose: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<ContactFormData>(initial);

  function set(field: keyof ContactFormData, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await onSave(form);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="card-pad w-full max-w-lg space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">{jobId ? 'Edit contact' : 'Add contact'}</h3>
          <button type="button" onClick={onClose} className="text-muted hover:text-ink text-xl leading-none">×</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          {!jobId && (
            <div>
              <label className="muted text-sm block mb-1">Linked job</label>
              <select className="input" value={selectedJobId} onChange={(e) => onSelectJob(e.target.value)} required>
                <option value="">Select a job…</option>
                {jobOptions.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}
              </select>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="muted text-sm block mb-1">Name *</label>
              <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} required placeholder="Full name" />
            </div>
            <div>
              <label className="muted text-sm block mb-1">Company</label>
              <input className="input" value={form.company} onChange={(e) => set('company', e.target.value)} placeholder="Company" />
            </div>
            <div>
              <label className="muted text-sm block mb-1">Title / Role</label>
              <input className="input" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="E.g. Engineering Recruiter" />
            </div>
            <div>
              <label className="muted text-sm block mb-1">Relationship</label>
              <select className="input" value={form.relationshipType} onChange={(e) => set('relationshipType', e.target.value)}>
                {RELATIONSHIP_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
              </select>
            </div>
            <div>
              <label className="muted text-sm block mb-1">Outreach date</label>
              <input className="input" type="date" value={form.outreachDate ?? ''} onChange={(e) => set('outreachDate', e.target.value)} />
            </div>
            <div>
              <label className="muted text-sm block mb-1">Next follow-up</label>
              <input className="input" type="date" value={form.nextFollowUp ?? ''} onChange={(e) => set('nextFollowUp', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="muted text-sm block mb-1">Notes</label>
            <textarea className="input" rows={3} value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} placeholder="Any notes about this contact..." />
          </div>
          <div className="flex gap-3 pt-2">
            <button className="btn-primary flex-1" type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save contact'}
            </button>
            <button className="btn-secondary" type="button" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ContactsPage() {
  const { jobs, enrichedContacts, addContact, updateContact, removeContact, isLoading } = useJobs();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<EnrichedContact | null>(null);
  const [selectedJobId, setSelectedJobId] = useState('');
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');

  if (isLoading) return <div className="card-pad">Loading contacts…</div>;

  const jobOptions = jobs.map((j) => ({ id: j.id, label: `${j.company} — ${j.title}` }));

  const filtered = enrichedContacts.filter((c) =>
    `${c.name} ${c.company} ${c.title} ${c.jobCompany}`.toLowerCase().includes(query.toLowerCase()),
  );

  async function handleSave(data: Omit<Contact, 'id'>) {
    setSaving(true);
    try {
      if (editing) {
        await updateContact(editing.jobId, editing.id, data);
      } else {
        if (!selectedJobId) return;
        await addContact(selectedJobId, data);
      }
      setShowModal(false);
      setEditing(null);
      setSelectedJobId('');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(c: EnrichedContact) {
    if (!confirm(`Remove ${c.name} from ${c.jobCompany}?`)) return;
    await removeContact(c.jobId, c.id);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contacts CRM"
        subtitle="Track recruiters, hiring managers, and referrals across all your jobs."
        action={
          <button className="btn-primary" type="button" onClick={() => { setEditing(null); setShowModal(true); }}>
            Add contact
          </button>
        }
      />

      <div className="card-pad">
        <input className="input max-w-sm" placeholder="Search contacts…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {filtered.length === 0 ? (
        <div className="card-pad text-center py-10">
          <div className="text-3xl mb-3">👤</div>
          <div className="font-semibold">{query ? 'No matching contacts' : 'No contacts yet'}</div>
          <div className="muted mt-1 text-sm">Add contacts through jobs or via the button above.</div>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Title</th>
                <th>Type</th>
                <th>Linked job</th>
                <th>Outreach</th>
                <th>Follow-up</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((contact) => (
                <tr key={`${contact.jobId}-${contact.id}`}>
                  <td className="font-medium">{contact.name}</td>
                  <td>{contact.title || '—'}</td>
                  <td>
                    <span className="badge bg-white/10 text-white text-xs">
                      {contact.relationshipType.replace('_', ' ')}
                    </span>
                  </td>
                  <td>
                    <Link href={`/jobs/${contact.jobId}`} className="hover:text-accent text-sm">
                      {contact.jobCompany} — {contact.jobTitle}
                    </Link>
                  </td>
                  <td>{contact.outreachDate || '—'}</td>
                  <td>{contact.nextFollowUp || '—'}</td>
                  <td>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="btn-secondary text-xs py-1"
                        onClick={() => { setEditing(contact); setShowModal(true); }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn-secondary text-xs py-1 text-red-400 hover:border-red-400/40"
                        onClick={() => handleDelete(contact)}
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <ContactModal
          initial={editing ? { name: editing.name, company: editing.company, title: editing.title, relationshipType: editing.relationshipType, outreachDate: editing.outreachDate, responseDate: editing.responseDate, nextFollowUp: editing.nextFollowUp, notes: editing.notes } : EMPTY_FORM}
          jobId={editing?.jobId}
          jobOptions={jobOptions}
          selectedJobId={selectedJobId}
          onSelectJob={setSelectedJobId}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setEditing(null); }}
          saving={saving}
        />
      )}
    </div>
  );
}

