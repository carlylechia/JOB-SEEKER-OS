'use client';

import { useEffect, useMemo, useState } from 'react';
import { ApiError, BootstrapPayload, Contact, EnrichedContact, JobFormValues, JobLead, PrepPack, QueueTask, Template, UserPreferences, UserProfileDetails } from '@/types';
import { checklistCompletion, hydrateJob } from '@/lib/scoring';

type PublicJobsResponse = { jobs: JobLead[] };

async function parseApiResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const payload = data as ApiError;
    throw new Error(payload.details?.join(', ') || payload.error || 'Request failed');
  }
  return data as T;
}

export function useJobs() {
  const [rawJobs, setRawJobs] = useState<JobLead[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [profile, setProfile] = useState<UserProfileDetails | null>(null);
  const [titleOptions, setTitleOptions] = useState<string[]>([]);
  const [onboardingCompleted, setOnboardingCompleted] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/bootstrap', { cache: 'no-store' });
        const data = await parseApiResponse<BootstrapPayload>(res);
        if (cancelled) return;
        setRawJobs(data.jobs);
        setTemplates(data.templates);
        setPreferences(data.preferences);
        setProfile(data.profile);
        setTitleOptions(data.titleOptions ?? []);
        setOnboardingCompleted(data.onboardingCompleted);
      } catch (error) {
        console.error(error);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const jobs = useMemo(() => {
    if (!preferences) return [];
    return rawJobs.map((job) => hydrateJob(job, preferences));
  }, [rawJobs, preferences]);

  const contacts = useMemo(() => jobs.flatMap((job) => job.contacts), [jobs]);
  const interviews = useMemo(() => jobs.flatMap((job) => job.interviews), [jobs]);

  const enrichedContacts = useMemo<EnrichedContact[]>(
    () =>
      jobs.flatMap((job) =>
        job.contacts.map((c) => ({
          ...c,
          jobId: job.id,
          jobTitle: job.title,
          jobCompany: job.company,
        })),
      ),
    [jobs],
  );

  const queueTasks = useMemo<QueueTask[]>(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const fiveDaysAgo = new Date(today);
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    const tasks: QueueTask[] = [];

    for (const job of jobs) {
      if (['ARCHIVED', 'OFFER'].includes(job.status)) continue;

      const base = {
        jobId: job.id,
        company: job.company,
        title: job.title,
        priority: job.priorityFlag,
        fitScore: job.score.fitScore,
        fitTier: job.score.fitTier,
      };

      // Follow-up NOW (overrides other follow-up tasks)
      if (job.nextFollowUp) {
        const due = new Date(job.nextFollowUp);
        if (due <= today) {
          tasks.push({
            ...base,
            taskId: `followup-now-${job.id}`,
            type: 'FOLLOW_UP_NOW',
            label: 'Follow up now',
            description: `Follow-up due for ${job.company}`,
            dueDate: job.nextFollowUp,
          });
          continue;
        }
      }

      if (['LEAD', 'SAVED'].includes(job.status)) {
        tasks.push({
          ...base,
          taskId: `apply-${job.id}`,
          type: 'APPLY',
          label: 'Apply to this job',
          description: `${job.title} at ${job.company} is waiting for your application`,
        });
      } else if (['APPLYING', 'APPLIED'].includes(job.status)) {
        const lastActivity = job.dateApplied
          ? new Date(job.dateApplied)
          : null;
        const stale = !lastActivity || lastActivity <= fiveDaysAgo;
        if (stale) {
          tasks.push({
            ...base,
            taskId: `followup-${job.id}`,
            type: 'FOLLOW_UP',
            label: 'Follow up',
            description: `No activity for 5+ days on ${job.company}`,
          });
        }
      } else if (job.status === 'INTERVIEWING') {
        tasks.push({
          ...base,
          taskId: `prepare-${job.id}`,
          type: 'PREPARE',
          label: 'Prepare for interview',
          description: `Interview prep needed for ${job.company}`,
        });
      } else if (job.status === 'REJECTED') {
        // No tasks for rejected
      }
    }

    // Sort: FOLLOW_UP_NOW > PREPARE > APPLY > FOLLOW_UP
    const order: Record<QueueTask['type'], number> = {
      FOLLOW_UP_NOW: 0,
      PREPARE: 1,
      APPLY: 2,
      FOLLOW_UP: 3,
    };
    return tasks.sort((a, b) => order[a.type] - order[b.type] || b.fitScore - a.fitScore);
  }, [jobs]);

  const dashboard = useMemo(() => {
    const total = jobs.length;
    const applied = jobs.filter((j) => ['APPLIED', 'INTERVIEWING', 'OFFER'].includes(j.status)).length;
    const interviewsCount = jobs.filter((j) => j.interviews.length > 0).length;
    const offers = jobs.filter((j) => j.status === 'OFFER').length;
    const avgFit = total ? Math.round((jobs.reduce((sum, j) => sum + j.score.fitScore, 0) / total) * 10) / 10 : 0;
    const responseRate = applied ? Math.round((interviewsCount / applied) * 100) : 0;
    const topPriority = [...jobs].sort((a, b) => b.score.fitScore - a.score.fitScore).slice(0, 5);
    const queue = [...jobs]
      .filter((j) => ['A', 'B'].includes(j.score.fitTier) && !['ARCHIVED', 'REJECTED', 'OFFER'].includes(j.status))
      .sort((a, b) => checklistCompletion(b) + b.score.fitScore - (checklistCompletion(a) + a.score.fitScore));
    const weeklyTrend = [
      { week: 'W1', leads: jobs.filter((j) => j.dateFound <= new Date().toISOString().slice(0, 10)).length, applied, interviews: interviewsCount },
    ];
    return { total, applied, interviewsCount, offers, avgFit, responseRate, topPriority, queue, weeklyTrend };
  }, [jobs]);

  function getJob(id: string) {
    return jobs.find((j) => j.id === id);
  }

  function updateTemplate(template: Template) {
    setTemplates((prev) => {
      const exists = prev.some((t) => t.id === template.id);
      return exists ? prev.map((t) => (t.id === template.id ? template : t)) : [template, ...prev];
    });
  }

  async function updatePreferences(nextPreferences: UserPreferences, options?: { onboardingCompleted?: boolean }) {
    setPreferences(nextPreferences);
    if (options?.onboardingCompleted !== undefined) setOnboardingCompleted(options.onboardingCompleted);
    await fetch('/api/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...nextPreferences, onboardingCompleted: options?.onboardingCompleted ?? onboardingCompleted }),
    });
  }

  async function saveProfile(nextProfile: Omit<UserProfileDetails, 'profileCompleted'>) {
    const res = await fetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nextProfile),
    });
    const payload = await parseApiResponse<{ profile: UserProfileDetails }>(res);
    setProfile(payload.profile);
    return payload.profile;
  }

  async function createJob(values: JobFormValues) {
    const res = await fetch('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    const payload = await parseApiResponse<{ job: JobLead }>(res);
    setRawJobs((prev) => [payload.job, ...prev]);
    return payload.job;
  }

  async function updateJob(id: string, values: JobFormValues) {
    const res = await fetch(`/api/jobs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    const payload = await parseApiResponse<{ job: JobLead }>(res);
    setRawJobs((prev) => prev.map((job) => (job.id === id ? payload.job : job)));
    return payload.job;
  }

  async function deleteJob(id: string) {
    const res = await fetch(`/api/jobs/${id}`, { method: 'DELETE' });
    await parseApiResponse<{ ok: true }>(res);
    setRawJobs((prev) => prev.filter((job) => job.id !== id));
  }

  async function createTitle(name: string) {
    const res = await fetch('/api/job-titles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const payload = await parseApiResponse<{ title: string; options: string[] }>(res);
    setTitleOptions(payload.options);
    return payload.title;
  }

  async function patchStatus(jobId: string, status: JobLead['status']) {
    const res = await fetch(`/api/jobs/${jobId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    const payload = await parseApiResponse<{ job: JobLead }>(res);
    setRawJobs((prev) => prev.map((j) => (j.id === jobId ? payload.job : j)));
    return payload.job;
  }

  async function addContact(jobId: string, contact: Omit<Contact, 'id'>) {
    const res = await fetch(`/api/jobs/${jobId}/contacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(contact),
    });
    const payload = await parseApiResponse<{ job: JobLead }>(res);
    setRawJobs((prev) => prev.map((j) => (j.id === jobId ? payload.job : j)));
    return payload.job;
  }

  async function updateContact(jobId: string, contactId: string, contact: Omit<Contact, 'id'>) {
    const res = await fetch(`/api/jobs/${jobId}/contacts/${contactId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(contact),
    });
    const payload = await parseApiResponse<{ job: JobLead }>(res);
    setRawJobs((prev) => prev.map((j) => (j.id === jobId ? payload.job : j)));
    return payload.job;
  }

  async function removeContact(jobId: string, contactId: string) {
    const res = await fetch(`/api/jobs/${jobId}/contacts/${contactId}`, { method: 'DELETE' });
    const payload = await parseApiResponse<{ job: JobLead }>(res);
    setRawJobs((prev) => prev.map((j) => (j.id === jobId ? payload.job : j)));
    return payload.job;
  }

  async function updatePrepPack(jobId: string, prepPack: PrepPack) {
    const res = await fetch(`/api/jobs/${jobId}/prep`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(prepPack),
    });
    const payload = await parseApiResponse<{ job: JobLead }>(res);
    setRawJobs((prev) => prev.map((j) => (j.id === jobId ? payload.job : j)));
    return payload.job;
  }

  async function updateChecklist(jobId: string, checklist: JobLead['checklist']) {
    const res = await fetch(`/api/jobs/${jobId}/checklist`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(checklist),
    });
    const payload = await parseApiResponse<{ job: JobLead }>(res);
    setRawJobs((prev) => prev.map((j) => (j.id === jobId ? payload.job : j)));
    return payload.job;
  }

  async function getPublicJobs() {
    const res = await fetch('/api/public-jobs', { cache: 'no-store' });
    const payload = await parseApiResponse<PublicJobsResponse>(res);
    if (!preferences) return payload.jobs;
    return payload.jobs.map((job) => hydrateJob(job, preferences));
  }

  async function savePublicJob(id: string) {
    const res = await fetch(`/api/public-jobs/${id}/save`, { method: 'POST' });
    const payload = await parseApiResponse<{ job: JobLead }>(res);
    setRawJobs((prev) => [payload.job, ...prev]);
    return payload.job;
  }

  return {
    jobs,
    templates,
    contacts,
    enrichedContacts,
    queueTasks,
    interviews,
    dashboard,
    preferences,
    profile,
    titleOptions,
    onboardingCompleted,
    getJob,
    updateTemplate,
    updatePreferences,
    saveProfile,
    createJob,
    updateJob,
    deleteJob,
    patchStatus,
    addContact,
    updateContact,
    removeContact,
    updatePrepPack,
    updateChecklist,
    createTitle,
    getPublicJobs,
    savePublicJob,
    isLoading,
  };
}
