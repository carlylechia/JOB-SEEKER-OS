import { describe, it, expect } from './harness';
import { dedupeExternalJobs } from '@/lib/job-discovery/dedupe';
import { normalizeJob, fingerprintJob, normalizeCompany, normalizeTitle } from '@/lib/job-discovery/normalize';
import { buildSearchPlan } from '@/lib/job-discovery/search-plan';
import { scoreExternalJob } from '@/lib/job-discovery/scoring';
import { selectDiverseTop } from '@/lib/job-discovery/ranking';
import { checkHardEligibility } from '@/lib/job-discovery/eligibility';
import { detectJobLanguage, isEnglishPosting } from '@/lib/job-discovery/language';
import { buildCandidateTitleTerms } from '@/lib/job-discovery/candidates';
import { computeListingQuality, computeSourceConfidence, computeDataConfidence, compositeRankingScore } from '@/lib/job-discovery/confidence';
import { localDateKey } from '@/lib/job-discovery/service';
import { mapAshbyJob } from '@/lib/job-discovery/catalog/providers/ashby';
import { mapGreenhouseJob } from '@/lib/job-discovery/catalog/providers/greenhouse';
import { mapJobicyJob } from '@/lib/job-discovery/catalog/providers/jobicy';
import { mapLeverPosting } from '@/lib/job-discovery/catalog/providers/lever';
import { mapUsaJobsItem } from '@/lib/job-discovery/catalog/providers/usajobs';
import { preselectedTargetJobId, sanitizeTargetJobId } from '@/lib/resume-builder/targeting';
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

describe('English-only language gate', () => {
  const english =
    'Senior Software Engineer (m/w/d). We are looking for an experienced engineer to join our team in Berlin. You will build modern web applications with TypeScript and React, work closely with product and design, and help shape our technical architecture. We offer flexible working hours, a learning budget, and a competitive salary. Apply now to become part of our international team.';

  it('keeps an English posting even when the employer uses a German title marker', () => {
    const detected = detectJobLanguage({
      title: 'Senior Software Engineer (m/w/d)',
      description: english,
    });
    expect(detected.language).toBe('en');
    expect(isEnglishPosting({ title: 'Senior Software Engineer (m/w/d)', description: english })).toBe(true);
  });

  it('rejects clearly German postings', () => {
    const detected = detectJobLanguage({
      title: 'Softwareentwickler (m/w/d)',
      description:
        'Wir suchen einen erfahrenen Softwareentwickler für unser Team. Du entwickelst moderne Webanwendungen mit TypeScript und React. Du arbeitest eng mit unserem Produktteam zusammen und gestaltest die technische Architektur. Wir bieten dir flexible Arbeitszeiten, Weiterbildung und ein attraktives Gehalt. Bewirb dich jetzt und werde Teil unseres Teams in Berlin.',
    });
    expect(detected.language).toBe('non-en');
    expect(detected.code).toBe('de');
  });

  it('rejects clearly French and Spanish postings', () => {
    const french = detectJobLanguage({
      title: 'Développeur Full Stack',
      description:
        'Nous recherchons un développeur full stack pour rejoindre notre équipe. Vous travaillerez avec les équipes produit et design dans un environnement international. Vous participerez à la conception et au développement de nouvelles fonctionnalités. Nous offrons un contrat CDI, du télétravail et des avantages compétitifs. Le poste est basé à Paris.',
    });
    const spanish = detectJobLanguage({
      title: 'Desarrollador Full Stack',
      description:
        'Buscamos un desarrollador full stack para unirse a nuestro equipo. Trabajarás con los equipos de producto y diseño en un entorno internacional. Participarás en el diseño y desarrollo de nuevas funcionalidades. Ofrecemos contrato indefinido, trabajo remoto y beneficios competitivos. El puesto está basado en Madrid.',
    });
    expect(french.language).toBe('non-en');
    expect(spanish.language).toBe('non-en');
  });

  it('treats short or missing text as unknown so it is never falsely rejected', () => {
    expect(detectJobLanguage({ title: 'Software Engineer' }).language).toBe('unknown');
    expect(isEnglishPosting({ title: 'Software Engineer', description: 'Build things.' })).toBe(true);
  });

  it('makes non-English listings fail hard eligibility', () => {
    const result = checkHardEligibility(
      {
        status: 'OPEN',
        title: 'Softwareentwickler (m/w/d)',
        description:
          'Wir suchen einen erfahrenen Softwareentwickler für unser Team. Du entwickelst moderne Webanwendungen mit TypeScript und React. Du arbeitest eng mit unserem Produktteam zusammen und gestaltest die technische Architektur. Wir bieten dir flexible Arbeitszeiten, Weiterbildung und ein attraktives Gehalt. Bewirb dich jetzt und werde Teil unseres Teams in Berlin.',
        applicationUrl: 'https://example.com/jobs/1',
        publishedAt: new Date(),
        lastSeenAt: new Date(),
        remoteType: 'Remote',
        workArrangement: 'Remote',
        employmentType: 'FULL_TIME',
        visaSponsorship: 'UNKNOWN',
      },
      {
        remoteOnly: true,
        workCountries: [],
        employmentTypes: [],
        visaSponsorshipRequired: false,
      },
    );
    expect(result.eligible).toBe(false);
    expect(result.checks.language).toBe('FAIL');
  });
});

describe('candidate title prefilter', () => {
  it('derives role tokens and phrases without seniority noise', () => {
    const terms = buildCandidateTitleTerms({
      targetRoles: ['Software Developer', 'Fullstack Developer', 'Frontend developer', 'Backend Developer', 'Software Engineer'],
      preferredTitles: ['Senior Full-Stack Engineer', 'web developer', 'Software Engineer', 'Frontend Engineer', 'Backend Engineer', 'Software Developer'],
      preferredStack: ['Typescript', 'React/Nextjs', 'Nodejs', 'Express/Nestjs'],
    });

    expect(terms).toContain('software');
    expect(terms).toContain('developer');
    expect(terms).toContain('engineer');
    expect(terms).toContain('frontend');
    expect(terms).toContain('backend');
    expect(terms).toContain('typescript');
    expect(terms).toContain('react');
    expect(terms).not.toContain('senior');
    expect(terms.length).toBeLessThanOrEqual(24);
  });

  it('is bounded and empty-safe', () => {
    expect(buildCandidateTitleTerms({})).toEqual([]);
    const bounded = buildCandidateTitleTerms(
      { targetRoles: ['Software Engineer'], preferredStack: ['TypeScript'] },
      4,
    );
    expect(bounded.length).toBeLessThanOrEqual(4);
    expect(bounded.length).toBeGreaterThan(0);
  });
});

describe('Jobicy provider mapping', () => {
  const source = {
    id: 'jobicy:feed',
    provider: 'jobicy',
    displayName: 'Jobicy',
    employerName: null,
    boardToken: null,
    careersUrl: 'https://jobicy.com',
    descriptionMode: 'full',
    attribution: 'Jobs by Jobicy',
    attributionUrl: 'https://jobicy.com',
    attributionRequired: true,
    allowStructuredData: false,
    retentionDays: 30,
  };

  it('maps a listing with attribution, salary and a plain-text description', () => {
    const mapped = mapJobicyJob(
      {
        id: 158260,
        url: 'https://jobicy.com/jobs/158260-full-stack-engineer-ai-platform',
        jobTitle: 'Full-Stack Engineer, AI Platform',
        companyName: 'Thumbtack',
        jobIndustry: ['Software Engineering'],
        jobType: ['Full-Time'],
        jobGeo: 'USA',
        jobLevel: 'Senior',
        jobDescription: '<p>Build <strong>React</strong> apps with TypeScript and Node.js.</p>',
        pubDate: '2026-10-31T17:05:04+00:00',
        salaryMin: 151300,
        salaryMax: 229900,
        salaryCurrency: 'usd',
        salaryPeriod: 'yearly',
      },
      source,
    );

    expect(mapped?.title).toBe('Full-Stack Engineer, AI Platform');
    expect(mapped?.applicationUrl).toBe('https://jobicy.com/jobs/158260-full-stack-engineer-ai-platform');
    expect(mapped?.employmentType).toBe('FULL_TIME');
    expect(mapped?.workArrangement).toBe('Remote');
    expect(mapped?.countryCodes).toEqual(['US']);
    expect(mapped?.salaryMin).toBe(151300);
    expect(mapped?.currency).toBe('USD');
    expect(mapped?.description).not.toContain('<p>');
    expect(mapped?.publishedAt).toBeInstanceOf(Date);
    expect(mapped?.attributionRequired).toBe(true);
  });

  it('drops records without an id, title or URL', () => {
    expect(mapJobicyJob({ jobTitle: 'Engineer', url: 'https://jobicy.com/jobs/1' }, source)).toBeNull();
    expect(mapJobicyJob({ id: 1, url: 'https://jobicy.com/jobs/1' }, source)).toBeNull();
    expect(mapJobicyJob({ id: 1, jobTitle: 'Engineer' }, source)).toBeNull();
  });
});

describe('resume target-job preselection', () => {
  it('accepts only a bounded opaque id', () => {
    expect(sanitizeTargetJobId('  cm123abc  ')).toBe('cm123abc');
    expect(sanitizeTargetJobId('bad id!')).toBeNull();
    expect(sanitizeTargetJobId('x'.repeat(65))).toBeNull();
    expect(sanitizeTargetJobId(null)).toBeNull();
  });

  it('selects the requested job only when it is in the eligible list', () => {
    expect(preselectedTargetJobId('job-a', [{ id: 'job-a' }, { id: 'job-b' }])).toBe('job-a');
    expect(preselectedTargetJobId('job-c', [{ id: 'job-a' }])).toBe('');
    expect(preselectedTargetJobId(null, [{ id: 'job-a' }])).toBe('');
  });
});
