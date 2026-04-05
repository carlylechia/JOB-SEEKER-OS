"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { JobForm } from "@/components/jobs/job-form";
import { PageHeader } from "@/components/shared/page-header";
import { PriorityBadge } from "@/components/shared/priority-badge";
import { ScoreBadge } from "@/components/shared/score-badge";
import { StatusBadge } from "@/components/shared/status-badge";
import { useJobs } from "@/hooks/use-job-data";
import { checklistCompletion } from "@/lib/scoring";
import { JobFormValues } from "@/types";
import { useState } from "react";

export default function JobDetailsPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { getJob, updateJob, deleteJob, titleOptions, createTitle, isLoading } =
    useJobs();
  const [isEditing, setIsEditing] = useState(false);
  const job = getJob(params.id);

  if (isLoading) return <div className="card-pad">Loading job…</div>;
  if (!job) return <div className="card-pad">Job not found.</div>;

  async function handleUpdate(values: JobFormValues) {
    if (job) {
      await updateJob(job.id, values);
      setIsEditing(false);
    } else {
      console.log("Job not found in db!");
    }
  }

  async function handleDelete() {
    if (job) {
      await deleteJob(job.id);
      router.push("/jobs");
    } else {
      console.log("Job not found in db!");
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
            <div className="card-pad">
              <h3 className="text-lg font-semibold">Linked contacts</h3>
              <div className="mt-4 space-y-3">
                {job.contacts.length ? (
                  job.contacts.map((contact) => (
                    <div
                      key={contact.id}
                      className="rounded-xl border border-line p-3"
                    >
                      <div className="font-medium">{contact.name}</div>
                      <div className="muted">
                        {contact.title} · {contact.relationshipType}
                      </div>
                      {contact.notes ? (
                        <div className="mt-2 text-sm text-muted">
                          {contact.notes}
                        </div>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <div className="muted">No contacts linked yet.</div>
                )}
              </div>
            </div>
          </div>
          <div className="space-y-6">
            <div className="card-pad">
              <h3 className="text-lg font-semibold">Score breakdown</h3>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {Object.entries(job.score)
                  .filter(([k]) => !["fitScore", "fitTier"].includes(k))
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
              </div>
            </div>
            <div className="card-pad">
              <h3 className="text-lg font-semibold">Submission checklist</h3>
              <div className="mt-2 text-sm text-muted">
                Completion: {checklistCompletion(job)}%
              </div>
              <div className="mt-4 grid gap-2">
                {Object.entries(job.checklist).map(([key, value]) => (
                  <div
                    key={key}
                    className="flex items-center justify-between rounded-xl border border-line p-3"
                  >
                    <span>{key}</span>
                    <span
                      className={`badge ${value ? "bg-emerald-500/15 text-emerald-300" : "bg-white/10 text-white"}`}
                    >
                      {value ? "Done" : "Pending"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="card-pad">
              <h3 className="text-lg font-semibold">Prep pack</h3>
              <div className="mt-4 space-y-3 text-sm">
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
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
