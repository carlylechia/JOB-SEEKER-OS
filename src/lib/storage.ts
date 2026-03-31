import { demoJobs, demoTemplates } from './demo-data';
import { JobLead, Template } from '@/types';

const JOBS_KEY = 'job-seeker-os.jobs';
const TEMPLATES_KEY = 'job-seeker-os.templates';

export function getStoredJobs(): JobLead[] {
  if (typeof window === 'undefined') return demoJobs;
  const raw = localStorage.getItem(JOBS_KEY);
  if (!raw) {
    localStorage.setItem(JOBS_KEY, JSON.stringify(demoJobs));
    return demoJobs;
  }
  return JSON.parse(raw);
}

export function saveStoredJobs(jobs: JobLead[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(JOBS_KEY, JSON.stringify(jobs));
}

export function getStoredTemplates(): Template[] {
  if (typeof window === 'undefined') return demoTemplates;
  const raw = localStorage.getItem(TEMPLATES_KEY);
  if (!raw) {
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(demoTemplates));
    return demoTemplates;
  }
  return JSON.parse(raw);
}

export function saveStoredTemplates(templates: Template[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
}
