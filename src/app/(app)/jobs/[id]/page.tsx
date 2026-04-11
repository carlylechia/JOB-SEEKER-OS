"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { JobForm } from "@/components/jobs/job-form";
import { PageHeader } from "@/components/shared/page-header";
import { PriorityBadge } from "@/components/shared/priority-badge";
import { ScoreBadge } from "@/components/shared/score-badge";
import { StatusBadge } from "@/components/shared/status-badge";
import { useJobs } from "@/hooks/use-job-data";
import { checklistCompletion } from "@/lib/scoring";
import { Checklist, Contact, JobFormValues, JobStatus } from "@/types";

const ALL_STATUSES: JobStatus[] = ['LEAD', 'SAVED', 'APPLYING', 'APPLIED', 'INTERVIEWING', 'OFFER', 'REJECTED', 'ARCHIVED'];
const RELATIONSHIP_TYPES = ['RECRUITER', 'HIRING_MANAGER', 'REFERRAL', 'NETWORK', 'OTHER'];

// Statuses where the full application has been submitted — auto-complete the checklist
const AUTO_COMPLETE_STATUSES: JobStatus[] = ['APPLIED', 'INTERVIEWING', 'OFFER'];

const CHECKLIST_LABELS: Record<keyof Checklist, string> = {
  resumeTailored:      'Resume tailored for this role',
  pdfChecked:          'PDF formatting checked',
  coverLetterReady:    'Cover letter ready',
  portfolioAdded:      'Portfolio / work samples added',
  videoDone:           'Video introduction done',
  compensationChecked: 'Compensation & package reviewed',
  eligibilityChecked:  'Eligibility & visa confirmed',
  submitted:           'Application submitted',
};

export default function JobDetailsPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { getJob, updateJob, deleteJob, patchStatus, addContact, removeContact, updateChecklist, titleOptions, createTitle, isLoading } = useJobs();
  const [isEditing, setIsEditing] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [showContactForm, setShowContactForm] = useState(false);
  const [contactForm, setContactForm] = useState<Omit<Contact, 'id'>>({ name: '', company: '', title: '', relationshipType: 'RECRUITER', outreachDate: '', notes: '' });
  const [savingContact, setSavingContact] = useState(false);
  const [followUpDate, setFollowUpDate] = useState('');
  const [savingFollowUp, setSavingFollowUp] = useState(false);
  const [checklistSaving, setChecklistSaving] = useState(false);

  const job = getJob(params.id);

  if (isLoading) return <div className="card-pad">Loading job…</div>;
  if (!job) return <div className="card-pad">Job not found.</div>;

  async function handleUpdate(values: JobFormValues) {
    if (job) {
      await updateJob(job.id, values);
      setIsEditing(false);
    }
  }

  async function handleDelete() {
    if (job) {
      await deleteJob(job.id);
      router.push("/jobs");
    }
  }

  async function handleStatusChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setStatusUpdating(true);
    try {
      await patchStatus(job!.id, e.target.value as JobStatus);
    } finally {
      setStatusUpdating(false);
    }
  }

  async function handleSetFollowUp(e: React.FormEvent) {
    e.preventDefault();
    if (!followUpDate) return;
    setSavingFollowUp(true);
    try {
      await updateJob(job!.id, { ...(job as any), nextFollowUp: followUpDate });
      setFollowUpDate('');
    } finally {
      setSavingFollowUp(false);
    }
  }

  async function handleAddContact(e: React.FormEvent) {
    e.preventDefault();
    setSavingContact(true);
    try {
      await addContact(job!.id, { ...contactForm, company: contactForm.company || job!.company });
      setContactForm({ name: '', company: '', title: '', relationshipType: 'RECRUITER', outreachDate: '', notes: '' });
      setShowContactForm(false);
    } finally {
      setSavingContact(false);
    }
  }

  async function handleToggleChecklist(key: keyof Checklist) {
    if (!job || AUTO_COMPLETE_STATUSES.includes(job.status)) return;
    setChecklistSaving(true);
    try {
      const updated = { ...job.checklist, [key]: !job.checklist[key] };
      await updateChecklist(job.id, updated);
    } finally {
      setChecklistSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={job.title}
        subtitle={job.company}
        action={
          <div className="flex gap-3">
            {job.jobUrl ? (
              <Link className="btn-secondary" href={job.jobUrl} target="_blank">
                Open listing
              </Link>
            ) : null}
            <button
              className="btn-primary"
              type="button"
              onClick={() => setIsEditing((prev) => !prev)}
            >
              {isEditing ? "Close editor" : "Edit lead"}
            </button>
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        <ScoreBadge score={job.score.fitScore} tier={job.score.fitTier} />
        <PriorityBadge priority={job.priorityFlag} />
        <StatusBadge status={job.status} />
      </div>

      {isEditing ? (
        <JobForm
          mode="edit"
          job={job}
          onSubmit={handleUpdate}
          onDelete={handleDelete}
          titleOptions={titleOptions}
          onCreateTitle={createTitle}
        />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-6">
            {/* Quick Actions */}
            <div className="card-pad">
              <h3 className="text-lg font-semibold mb-4">Quick actions</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                {/* Status change */}
                <div>
                  <div className="muted text-sm mb-1">Move to status</div>
                  <select
                    className="input"
                    value={job.status}
                    disabled={statusUpdating}
                    onChange={handleStatusChange}
                  >
                    {ALL_STATUSES.map((s) => (
                      <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>
                    ))}
                  </select>
                </div>
                {/* Follow-up date */}
                <form onSubmit={handleSetFollowUp} className="flex flex-col gap-1">
                  <div className="muted text-sm">Set follow-up date</div>
                  <div className="flex gap-2">
                    <input
                      className="input flex-1"
                      type="date"
                      value={followUpDate}
                      onChange={(e) => setFollowUpDate(e.target.value)}
                    />
                    <button className="btn-secondary" type="submit" disabled={!followUpDate || savingFollowUp}>
                      {savingFollowUp ? '…' : 'Set'}
                    </button>
                  </div>
                  {job.nextFollowUp && (
                    <div className="text-xs text-muted">Current: {job.nextFollowUp}</div>
                  )}
                </form>
              </div>
            </div>

            <div className="card-pad">
              <h3 className="text-lg font-semibold">Role details</h3>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="muted">Source</div>
                  <div>{job.source || "—"}</div>
                </div>
                <div>
                  <div className="muted">Location</div>
                  <div>{job.location || "—"}</div>
                </div>
                <div>
                  <div className="muted">Timezone</div>
                  <div>{job.timezoneRequirement || "—"}</div>
                </div>
                <div>
                  <div className="muted">Eligibility</div>
                  <div>{job.eligibilityRegion || "—"}</div>
                </div>
                <div>
                  <div className="muted">Compensation</div>
                  <div>
                    {job.salaryMin || "—"}
                    {job.salaryMax ? ` - ${job.salaryMax}` : ""} {job.currency}
                  </div>
                </div>
                <div>
                  <div className="muted">Date found</div>
                  <div>{job.dateFound}</div>
                </div>
                <div>
                  <div className="muted">Next follow-up</div>
                  <div>{job.nextFollowUp || "—"}</div>
                </div>
                <div>
                  <div className="muted">Status</div>
                  <div>{job.status}</div>
                </div>
              </div>
            </div>
            <div className="card-pad">
              <h3 className="text-lg font-semibold">Notes</h3>
              <p className="mt-3 whitespace-pre-wrap text-muted">
                {job.notes || "No notes yet."}
              </p>
            </div>

            {/* Contacts */}
            <div className="card-pad">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">Linked contacts</h3>
                <button
                  type="button"
                  className="btn-secondary text-sm"
                  onClick={() => setShowContactForm((p) => !p)}
                >
                  {showContactForm ? 'Cancel' : '+ Add contact'}
                </button>
              </div>

              {showContactForm && (
                <form onSubmit={handleAddContact} className="mb-4 space-y-3 rounded-xl border border-line p-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="muted text-xs block mb-1">Name *</label>
                      <input className="input" required placeholder="Full name" value={contactForm.name} onChange={(e) => setContactForm((p) => ({ ...p, name: e.target.value }))} />
                    </div>
                    <div>
                      <label className="muted text-xs block mb-1">Title / Role</label>
                      <input className="input" placeholder="E.g. Engineering Recruiter" value={contactForm.title} onChange={(e) => setContactForm((p) => ({ ...p, title: e.target.value }))} />
                    </div>
                    <div>
                      <label className="muted text-xs block mb-1">Relationship</label>
                      <select className="input" value={contactForm.relationshipType} onChange={(e) => setContactForm((p) => ({ ...p, relationshipType: e.target.value }))}>
                        {RELATIONSHIP_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="muted text-xs block mb-1">Outreach date</label>
                      <input className="input" type="date" value={contactForm.outreachDate ?? ''} onChange={(e) => setContactForm((p) => ({ ...p, outreachDate: e.target.value }))} />
                    </div>
                  </div>
                  <div>
                    <label className="muted text-xs block mb-1">Notes</label>
                    <textarea className="input" rows={2} value={contactForm.notes ?? ''} onChange={(e) => setContactForm((p) => ({ ...p, notes: e.target.value }))} />
                  </div>
                  <button className="btn-primary" type="submit" disabled={savingContact}>
                    {savingContact ? 'Saving…' : 'Add contact'}
                  </button>
                </form>
              )}

              <div className="space-y-3">
                {job.contacts.length ? (
                  job.contacts.map((contact) => (
                    <div key={contact.id} className="rounded-xl border border-line p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-medium">{contact.name}</div>
                          <div className="muted text-sm">
                            {contact.title} · {contact.relationshipType.replace('_', ' ')}
                          </div>
                          {contact.notes ? (
                            <div className="mt-2 text-sm text-muted">{contact.notes}</div>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          className="text-xs text-red-400 hover:text-red-300"
                          onClick={() => removeContact(job.id, contact.id)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="muted text-sm">No contacts linked yet.</div>
                )}
              </div>
            </div>
          </div>
          <div className="space-y-6">
            <div className="card-pad">
              <h3 className="text-lg font-semibold">Score breakdown</h3>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {Object.entries(job.score)
                  .filter(([k]) => !["fitScore", "fitTier", "titleMatch"].includes(k))
                  .map(([key, value]) => (
                    <div
                      key={key}
                      className="rounded-xl border border-line p-3"
                    >
                      <div className="muted">{key}</div>
                      <div className="mt-1 text-xl font-semibold">
                        {value}/5
                      </div>
                    </div>
                  ))}
                {job.score.titleMatch !== undefined && (
                  <div className="rounded-xl border border-line p-3">
                    <div className="muted">titleMatch</div>
                    <div className="mt-1">
                      <span className={`badge ${job.score.titleMatch ? "bg-emerald-500/15 text-emerald-300" : "bg-white/10 text-white"}`}>
                        {job.score.titleMatch ? "Match" : "No match"}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="card-pad">
              {(() => {
                const isAutoCompleted = AUTO_COMPLETE_STATUSES.includes(job.status);
                const effectiveChecklist = isAutoCompleted
                  ? (Object.fromEntries(Object.keys(job.checklist).map((k) => [k, true])) as Checklist)
                  : job.checklist;
                const completedCount = Object.values(effectiveChecklist).filter(Boolean).length;
                const total = Object.values(effectiveChecklist).length;
                const pct = Math.round((completedCount / total) * 100);
                const allDone = pct === 100;

                return (
                  <>
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="text-lg font-semibold">Submission checklist</h3>
                      {checklistSaving && <span className="text-xs text-muted animate-pulse">Saving…</span>}
                    </div>

                    {/* Progress bar */}
                    <div className="mt-2 flex items-center gap-3">
                      <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
                        <div
                          className={`h-2 rounded-full transition-all duration-500 ${allDone ? 'bg-emerald-500' : 'bg-accent'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className={`text-sm font-semibold tabular-nums ${allDone ? 'text-emerald-400' : 'text-ink'}`}>
                        {pct}%
                      </span>
                    </div>

                    {/* Auto-complete banner */}
                    {isAutoCompleted && (
                      <div className="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/8 px-3 py-2 text-xs text-emerald-300">
                        ✓ Status is <strong>{job.status.charAt(0) + job.status.slice(1).toLowerCase()}</strong> — all items are marked complete automatically. Move the job back to <em>Applying</em> or earlier to edit individually.
                      </div>
                    )}

                    {/* Checklist items */}
                    <div className="mt-4 grid gap-2">
                      {(Object.keys(effectiveChecklist) as Array<keyof Checklist>).map((key) => {
                        const checked = effectiveChecklist[key];
                        const label = CHECKLIST_LABELS[key] ?? key;
                        return (
                          <button
                            key={key}
                            type="button"
                            disabled={isAutoCompleted || checklistSaving}
                            onClick={() => handleToggleChecklist(key)}
                            className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors
                              ${checked
                                ? 'border-emerald-500/30 bg-emerald-500/8 hover:bg-emerald-500/12'
                                : 'border-line bg-white/3 hover:bg-white/6'}
                              ${isAutoCompleted ? 'cursor-default' : 'cursor-pointer'}
                              disabled:opacity-75`}
                          >
                            {/* Custom checkbox */}
                            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors
                              ${checked ? 'border-emerald-500 bg-emerald-500' : 'border-white/30 bg-transparent'}`}
                            >
                              {checked && (
                                <svg className="h-3 w-3 text-white" viewBox="0 0 12 10" fill="none">
                                  <path d="M1 5l3.5 3.5L11 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              )}
                            </span>
                            <span className={`flex-1 text-sm ${checked ? 'line-through text-muted' : 'text-ink'}`}>
                              {label}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {!isAutoCompleted && (
                      <p className="mt-3 text-xs text-muted">Click any item to toggle. Changes save automatically.</p>
                    )}
                  </>
                );
              })()}
            </div>
            <div className="card-pad">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">Prep pack</h3>
                <Link href="/prep" className="btn-secondary text-sm">Open prep editor</Link>
              </div>
              <div className="space-y-3 text-sm">
                <div>
                  <span className="text-muted">Why this role: </span>
                  {job.prepPack.whyThisRole || "—"}
                </div>
                <div>
                  <span className="text-muted">Top fit points: </span>
                  {job.prepPack.topFitPoints || "—"}
                </div>
                <div>
                  <span className="text-muted">Technical focus: </span>
                  {job.prepPack.technicalFocus || "—"}
                </div>
                <div>
                  <span className="text-muted">Questions to ask: </span>
                  {job.prepPack.questionsToAsk || "—"}
                </div>
                <div>
                  <span className="text-muted">Prep status: </span>
                  <span className="badge bg-white/10 text-white ml-1">{job.prepPack.prepStatus}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
