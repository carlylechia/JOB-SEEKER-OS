import { UserPreferences } from '@/types';

export const defaultPreferences: UserPreferences = {
  currentLevel: 'MID',
  targetLevel: 'MID',
  targetRoles: ['Full-Stack Engineer', 'Backend Engineer', 'Software Engineer II', 'Product Engineer'],
  preferredRegions: ['Worldwide', 'Africa', 'Europe'],
  preferredTitles: ['Engineer', 'Developer', 'Product Engineer'],
  preferredStack: ['TypeScript', 'JavaScript', 'Next.js', 'React', 'Node.js', 'NestJS', 'PostgreSQL', 'Docker'],
  mustHaveTech: ['TypeScript', 'Node.js'],
  workRegions: ['US', 'EU', 'AFRICA'],
  remoteOnly: true,
  salaryMin: 2500,
  salaryTarget: 3500,
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
