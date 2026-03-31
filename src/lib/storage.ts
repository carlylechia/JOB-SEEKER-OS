import { demoJobs, demoTemplates } from './demo-data';
import { defaultPreferences } from './preferences';
import { JobLead, Template, UserPreferences } from '@/types';

const JOBS_KEY = 'job-seeker-os.jobs';
const TEMPLATES_KEY = 'job-seeker-os.templates';
const PREFERENCES_KEY = 'job-seeker-os.preferences';

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

export function getStoredPreferences(): UserPreferences {
  if (typeof window === 'undefined') return defaultPreferences;
  const raw = localStorage.getItem(PREFERENCES_KEY);
  if (!raw) {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(defaultPreferences));
    return defaultPreferences;
  }
  return { ...defaultPreferences, ...JSON.parse(raw) };
}

export function saveStoredPreferences(preferences: UserPreferences) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
}
