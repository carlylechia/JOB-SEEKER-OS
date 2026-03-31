'use client';

import { useEffect, useMemo, useState } from 'react';
import { JobLead, Template, UserPreferences } from '@/types';
import { demoContacts, demoInterviews } from '@/lib/demo-data';
import { getStoredJobs, getStoredPreferences, getStoredTemplates, saveStoredJobs, saveStoredPreferences, saveStoredTemplates } from '@/lib/storage';
import { checklistCompletion, hydrateJob } from '@/lib/scoring';

export function useJobs() {
  const [rawJobs, setRawJobs] = useState<JobLead[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);

  useEffect(() => {
    setRawJobs(getStoredJobs());
    setTemplates(getStoredTemplates());
    setPreferences(getStoredPreferences());
  }, []);

  const jobs = useMemo(() => {
    if (!preferences) return [];
    return rawJobs.map((job) => hydrateJob(job, preferences));
  }, [rawJobs, preferences]);

  const contacts = useMemo(() => jobs.flatMap((job) => job.contacts).concat(demoContacts.filter((c) => !jobs.flatMap((j) => j.contacts).some((jc) => jc.id === c.id))), [jobs]);
  const interviews = useMemo(() => jobs.flatMap((job) => job.interviews).concat(demoInterviews.filter((i) => !jobs.flatMap((j) => j.interviews).some((ji) => ji.id === i.id))), [jobs]);

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
      .sort((a, b) => (checklistCompletion(b) + b.score.fitScore) - (checklistCompletion(a) + a.score.fitScore));
    const weeklyTrend = [
      { week: 'W1', leads: 3, applied: 2, interviews: 1 },
      { week: 'W2', leads: 4, applied: 3, interviews: 1 },
      { week: 'W3', leads: 5, applied: 4, interviews: 2 },
      { week: 'W4', leads: 6, applied: 3, interviews: 2 },
    ];
    return { total, applied, interviewsCount, offers, avgFit, responseRate, topPriority, queue, weeklyTrend };
  }, [jobs]);

  function upsertJob(job: JobLead) {
    setRawJobs((prev) => {
      const exists = prev.some((j) => j.id === job.id);
      const next = exists ? prev.map((j) => (j.id === job.id ? job : j)) : [job, ...prev];
      saveStoredJobs(next);
      return next;
    });
  }

  function getJob(id: string) {
    return jobs.find((j) => j.id === id);
  }

  function updateTemplate(template: Template) {
    setTemplates((prev) => {
      const exists = prev.some((t) => t.id === template.id);
      const next = exists ? prev.map((t) => (t.id === template.id ? template : t)) : [template, ...prev];
      saveStoredTemplates(next);
      return next;
    });
  }

  function updatePreferences(nextPreferences: UserPreferences) {
    setPreferences(nextPreferences);
    saveStoredPreferences(nextPreferences);
  }

  return { jobs, templates, contacts, interviews, dashboard, preferences, upsertJob, getJob, updateTemplate, updatePreferences };
}
