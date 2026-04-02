'use client';

import { useEffect, useMemo, useState } from 'react';
import { JobLead, Template, UserPreferences } from '@/types';
import { checklistCompletion, hydrateJob } from '@/lib/scoring';

type BootstrapPayload = {
  jobs: JobLead[];
  templates: Template[];
  preferences: UserPreferences;
};

export function useJobs() {
  const [rawJobs, setRawJobs] = useState<JobLead[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch('/api/bootstrap', { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to load workspace');
        const data = (await res.json()) as BootstrapPayload;
        if (cancelled) return;
        setRawJobs(data.jobs);
        setTemplates(data.templates);
        setPreferences(data.preferences);
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
      { week: 'W1', leads: 3, applied: 2, interviews: 1 },
      { week: 'W2', leads: 4, applied: 3, interviews: 1 },
      { week: 'W3', leads: 5, applied: 4, interviews: 2 },
      { week: 'W4', leads: 6, applied: 3, interviews: 2 },
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

  async function updatePreferences(nextPreferences: UserPreferences) {
    setPreferences(nextPreferences);
    await fetch('/api/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nextPreferences),
    });
  }

  return { jobs, templates, contacts, interviews, dashboard, preferences, getJob, updateTemplate, updatePreferences, isLoading };
}
