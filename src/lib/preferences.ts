import { UserPreferences } from '@/types';

export const defaultTitleOptions = [
  'Software Engineer',
  'Full-Stack Engineer',
  'Backend Engineer',
  'Frontend Engineer',
  'Product Engineer',
  'Content Writer',
  'Technical Writer',
  'Product Manager',
  'Marketing Manager',
  'Sales Representative',
  'Customer Success Manager',
  'Data Analyst',
  'UI/UX Designer',
  'DevOps Engineer',
];

export const defaultTimezoneOptions = [
  'US hours / EST overlap',
  'CST overlap',
  'PST overlap',
  'CET overlap',
  'GMT / UTC overlap',
  'Africa-friendly overlap',
  'Flexible',
];

export const defaultPreferences: UserPreferences = {
  currentLevel: 'MID',
  targetLevel: 'MID',
  targetRoles: [],
  preferredRegions: [],
  preferredTitles: [],
  preferredStack: [],
  mustHaveTech: [],
  workRegions: ['WORLDWIDE'],
  timezoneMatches: [],
  remoteOnly: true,
  salaryMin: 0,
  salaryTarget: 0,
  timezoneToleranceHours: 6,
};

export function parseCommaList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function stringifyList(values: string[]): string {
  return values.join(', ');
}

export function normalizeTitle(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function titleMatchesAny(title: string, values: string[]) {
  const normalizedTitle = normalizeTitle(title);
  return values.some((value) => {
    const candidate = normalizeTitle(value);
    return candidate && (normalizedTitle.includes(candidate) || candidate.includes(normalizedTitle));
  });
}
