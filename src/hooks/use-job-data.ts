'use client';

import { useEffect, useMemo, useState } from 'react';
import { ApiError, BootstrapPayload, JobFormValues, JobLead, Template, UserPreferences, UserProfileDetails } from '@/types';
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
    createTitle,
    getPublicJobs,
    savePublicJob,
    isLoading,
  };
}
