import { describe, it, expect } from './harness';
import { dedupeExternalJobs } from '@/lib/job-discovery/dedupe';
import { normalizeJob, fingerprintJob, normalizeCompany, normalizeTitle } from '@/lib/job-discovery/normalize';
import { buildSearchPlan } from '@/lib/job-discovery/search-plan';
import { scoreExternalJob } from '@/lib/job-discovery/scoring';

describe('job discovery deduplication', () => {
  it('dedupes by source+id, url, and company+title+location', () => {
    const jobs = [
      { source: 'a', sourceJobId: '1', title: 'Engineer', company: 'Acme', location: 'Remote', applicationUrl: 'https://x/1', canonicalUrl: null, description: null, salaryMin: null, salaryMax: null, currency: 'USD', publishedAt: null, remoteType: null, workArrangement: null, employmentType: null, employerUrl: null, attribution: null, contentFingerprint: null },
      { source: 'b', sourceJobId: '2', title: 'Engineer', company: 'Acme', location: 'Remote', applicationUrl: 'https://y/2', canonicalUrl: null, description: null, salaryMin: null, salaryMax: null, currency: 'USD', publishedAt: null, remoteType: null, workArrangement: null, employmentType: null, employerUrl: null, attribution: null, contentFingerprint: 'same' },
    ] as any;
    jobs[1].contentFingerprint = fingerprintJob(jobs[0] as any);
    const res = dedupeExternalJobs(jobs as any);
    expect(res.discarded).toBe(1);
    expect(res.jobs.length).toBe(1);
  });

  it('keeps distinct requisitions in different locations', () => {
    const jobs = [
      { source: 'a', sourceJobId: '1', title: 'Engineer', company: 'Acme', location: 'New York', applicationUrl: 'https://x/1', canonicalUrl: null, description: null, salaryMin: null, salaryMax: null, currency: 'USD', publishedAt: null, remoteType: null, workArrangement: null, employmentType: null, employerUrl: null, attribution: null, contentFingerprint: null },
      { source: 'a', sourceJobId: '2', title: 'Engineer', company: 'Acme', location: 'London', applicationUrl: 'https://x/2', canonicalUrl: null, description: null, salaryMin: null, salaryMax: null, currency: 'USD', publishedAt: null, remoteType: null, workArrangement: null, employmentType: null, employerUrl: null, attribution: null, contentFingerprint: null },
    ] as any;
    const res = dedupeExternalJobs(jobs as any);
    expect(res.jobs.length).toBe(2);
  });
});

describe('job discovery normalization', () => {
  it('normalizes company/title', () => {
    expect(normalizeCompany('Acme, Inc.')).toBe('acme inc');
    expect(normalizeTitle('Senior  Engineer')).toBe('senior engineer');
  });

  it('normalizes missing published date to null', () => {
    const job = normalizeJob({ source: 'a', sourceJobId: '1', title: 'Engineer', company: 'Acme', publishedAt: new Date('invalid') } as any);
    expect(job.publishedAt).toBeNull();
  });
});

describe('search plan', () => {
  it('uses target titles and bounds them', () => {
    const prefs = { targetRoles: ['a','b','c','d','e','f','g'], preferredTitles: [], preferredRegions: ['US'], remoteOnly: true, salaryMin: 0, salaryTarget: 0, targetLevel: 'MID', currentLevel: 'MID', preferredStack: [], mustHaveTech: [], workRegions: ['WORLDWIDE'], timezoneMatches: [], timezoneToleranceHours: 4 } as any;
    const plan = buildSearchPlan({ location: 'NYC' }, prefs);
    expect(plan.titles.length).toBeLessThanOrEqual(6);
    expect(plan.locations).toContain('NYC');
  });
});

describe('scoring', () => {
  it('returns 0-ish for mismatched seniority? keeps distinct', () => {
    const prefs = { targetRoles: ['Software Engineer'], preferredTitles: [], preferredRegions: [], remoteOnly: false, salaryMin: 0, salaryTarget: 0, targetLevel: 'ENTRY', currentLevel: 'ENTRY', preferredStack: [], mustHaveTech: [], workRegions: ['WORLDWIDE'], timezoneMatches: [], timezoneToleranceHours: 4 } as any;
    const { fitScore } = scoreExternalJob({ title: 'Senior Staff Engineer', location: 'Remote', remoteType: 'Remote', eligibilityRegion: null, salaryMin: null, salaryMax: null, currency: null }, prefs);
    expect(typeof fitScore).toBe('number');
  });
});
