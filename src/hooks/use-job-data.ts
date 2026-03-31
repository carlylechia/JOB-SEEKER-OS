'use client';

import { useEffect, useMemo, useState } from 'react';
import { JobLead, Template } from '@/types';
import { demoContacts, demoInterviews } from '@/lib/demo-data';
import { getStoredJobs, getStoredTemplates, saveStoredJobs, saveStoredTemplates } from '@/lib/storage';
import { checklistCompletion, hydrateJob } from '@/lib/scoring';

export function useJobs() {
  const [jobs, setJobs] = useState<JobLead[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);

  useEffect(() => {
    setJobs(getStoredJobs().map(hydrateJob));
    setTemplates(getStoredTemplates());
  }, []);

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
    const queue = [...jobs].filter((j) => ['A', 'B'].includes(j.score.fitTier) && j.status !== 'ARCHIVED').sort((a, b) => (checklistCompletion(b) + b.score.fitScore) - (checklistCompletion(a) + a.score.fitScore));
    const weeklyTrend = [
      { week: 'W1', leads: 3, applied: 2, interviews: 1 },
      { week: 'W2', leads: 4, applied: 3, interviews: 1 },
      { week: 'W3', leads: 5, applied: 4, interviews: 2 },
      { week: 'W4', leads: 6, applied: 3, interviews: 2 },
    ];
    return { total, applied, interviewsCount, offers, avgFit, responseRate, topPriority, queue, weeklyTrend };
  }, [jobs]);

  function upsertJob(job: JobLead) {
    const hydrated = hydrateJob(job);
    setJobs((prev) => {
      const exists = prev.some((j) => j.id === hydrated.id);
      const next = exists ? prev.map((j) => (j.id === hydrated.id ? hydrated : j)) : [hydrated, ...prev];
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

  return { jobs, templates, contacts, interviews, dashboard, upsertJob, getJob, updateTemplate };
}
