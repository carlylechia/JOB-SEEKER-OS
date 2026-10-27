import { describe, it, expect } from './harness';
import { dedupeExternalJobs } from '@/lib/job-discovery/dedupe';
import { normalizeJob, fingerprintJob, normalizeCompany, normalizeTitle } from '@/lib/job-discovery/normalize';
import { buildSearchPlan } from '@/lib/job-discovery/search-plan';
import { scoreExternalJob } from '@/lib/job-discovery/scoring';
import { selectDiverseTop } from '@/lib/job-discovery/ranking';
import { titleMatchesAny } from '@/lib/preferences';

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

  it('uses the profile headline or skills when no target titles were selected', () => {
    const prefs = { targetRoles: [], preferredTitles: [], preferredStack: ['React', 'TypeScript'], preferredRegions: [], remoteOnly: true } as any;
    expect(buildSearchPlan({ location: 'NYC', headline: 'Frontend Engineer' }, prefs).titles).toContain('Frontend Engineer');
    expect(buildSearchPlan({ location: 'NYC', headline: null }, prefs).titles).toContain('React TypeScript');
  });
});

describe('scoring', () => {
  const preferences = {
    targetRoles: ['Software Engineer'],
    preferredTitles: [],
    preferredRegions: [],
    remoteOnly: true,
    salaryMin: 0,
    salaryTarget: 0,
    targetLevel: 'MID',
    currentLevel: 'MID',
    preferredStack: ['React', 'TypeScript'],
    mustHaveTech: [],
    workRegions: ['WORLDWIDE'],
    timezoneMatches: [],
    timezoneToleranceHours: 4,
  } as any;

  it('ranks real role and description skill matches above unrelated postings', () => {
    const matching = scoreExternalJob({
      title: 'Software Engineer',
      location: 'Remote',
      remoteType: 'Remote',
      eligibilityRegion: null,
      salaryMin: null,
      salaryMax: null,
      currency: null,
      description: 'Build software with React and TypeScript for a distributed engineering team.',
      publishedAt: new Date(),
      applicationUrl: 'https://jobs.example/apply',
      canonicalUrl: 'https://jobs.example/role',
    }, preferences);
    const unrelated = scoreExternalJob({
      title: 'Senior Staff Accountant',
      location: 'Remote',
      remoteType: 'Remote',
      eligibilityRegion: null,
      salaryMin: null,
      salaryMax: null,
      currency: null,
      description: 'Manage accounting records and financial reporting.',
      publishedAt: new Date(),
      applicationUrl: 'https://jobs.example/apply',
      canonicalUrl: 'https://jobs.example/role',
    }, preferences);

    expect(matching.fitScore).toBeGreaterThan(unrelated.fitScore);
    expect(matching.scoreFields.matchedSkills).toEqual(['React', 'TypeScript']);
  });

  it('penalizes non-remote jobs for remote-only preferences', () => {
    const result = scoreExternalJob({
      title: 'Software Engineer',
      location: 'New York, United States',
      remoteType: 'Onsite',
      eligibilityRegion: null,
      salaryMin: null,
      salaryMax: null,
      currency: null,
      description: 'React and TypeScript software engineering.',
    }, preferences);
    expect(result.scoreFields.score.geographyEligibility).toBe(1);
  });

  it('recognizes common role-title spelling variants', () => {
    expect(titleMatchesAny('Frontend Software Developer', ['Front End Software Engineer'])).toBe(true);
    expect(titleMatchesAny('Product Designer', ['Software Engineer'])).toBe(false);
  });
});

describe('recommendation ranking', () => {
  it('limits employer and title repetition while keeping the requested shortlist size', () => {
    const jobs = [
      { company: 'Acme', title: 'Engineer', fitScore: 99, publishedAt: null },
      { company: 'Acme', title: 'Engineer', fitScore: 98, publishedAt: null },
      { company: 'Acme', title: 'Engineer', fitScore: 97, publishedAt: null },
      { company: 'Beta', title: 'Designer', fitScore: 90, publishedAt: null },
      { company: 'Gamma', title: 'Analyst', fitScore: 80, publishedAt: null },
    ];
    const selected = selectDiverseTop(jobs, 5);
    expect(selected).toHaveLength(5);
    expect(selected.slice(0, 3).filter((job) => job.company === 'Acme')).toHaveLength(2);
  });
});
