import { describe, it, expect } from './harness';
import { normalizeJobCategory, normalizeSeniority } from '@/lib/job-discovery/categories';
import { annualiseSalary, parseSalaryText } from '@/lib/job-discovery/salary';
import { parseRssDate, parseRssItems, splitCompanyFromTitle, splitCreator } from '@/lib/job-discovery/rss';
import { mapRemotiveJob } from '@/lib/job-discovery/catalog/providers/remotive';
import { mapWorkingNomadsJob } from '@/lib/job-discovery/catalog/providers/workingnomads';
import { mapWeWorkRemotelyItem } from '@/lib/job-discovery/catalog/providers/weworkremotely';
import { mapJobspressoItem } from '@/lib/job-discovery/catalog/providers/jobspresso';
import {
  ImageValidationError,
  MAX_INGESTION_IMAGES,
  toDataUrl,
  validateIngestionImages,
} from '@/lib/job-ingestion/images';
import { normalizeModelIngestion, normalizeModelContacts, normalizeRequirements } from '@/lib/job-ingestion/normalize';
import type { ModelIngestion } from '@/lib/job-ingestion/schema';

const source = {
  id: 'test:feed',
  provider: 'test',
  displayName: 'Test',
  employerName: null,
  boardToken: null,
  careersUrl: 'https://example.com',
  descriptionMode: 'full',
  attribution: 'Jobs by Test',
  attributionUrl: 'https://example.com',
  attributionRequired: true,
  allowStructuredData: false,
  retentionDays: 30,
} as any;

function model(overrides: Partial<ModelIngestion> = {}): ModelIngestion {
  return {
    title: 'Senior Backend Engineer',
    company: 'Acme',
    companyWebsite: '',
    companyLinkedinUrl: '',
    companySize: '',
    industry: 'Software',
    location: 'Remote (Europe)',
    remoteType: 'Fully Remote',
    employmentType: 'FULL_TIME',
    seniority: 'SENIOR',
    category: 'ENGINEERING',
    salaryMin: 90000,
    salaryMax: 120000,
    currency: 'eur',
    salaryPeriod: 'annual',
    timezoneRequirement: 'CET ±2',
    eligibilityRegion: 'Europe',
    visaSponsorship: 'UNKNOWN',
    description: 'Build APIs with TypeScript and PostgreSQL.',
    skills: ['TypeScript', 'PostgreSQL'],
    requirements: [
      { text: '5+ years of backend experience', kind: 'MUST_HAVE' },
      { text: '5+ years of backend experience', kind: 'MUST_HAVE' },
      { text: 'Own the public API', kind: 'RESPONSIBILITY' },
    ],
    contacts: [],
    applicationUrl: 'https://acme.example/jobs/1',
    source: 'Acme careers',
    confidence: 0.91,
    warnings: [],
    ...overrides,
  };
}

describe('job taxonomy', () => {
  it('maps titles, provider categories and tags into canonical buckets', () => {
    expect(normalizeJobCategory('', 'Senior Data Engineer')).toBe('DATA');
    expect(normalizeJobCategory('Software Development', 'Product Designer')).toBe('DESIGN');
    expect(normalizeJobCategory('', 'Account Executive')).toBe('SALES');
    expect(normalizeJobCategory('', '')).toBe('OTHER');
  });

  it('infers seniority without over-reading short titles', () => {
    expect(normalizeSeniority(null, 'Staff Platform Engineer')).toBe('LEAD');
    expect(normalizeSeniority(null, 'Junior Developer')).toBe('ENTRY');
    expect(normalizeSeniority('SENIOR', 'Engineer')).toBe('SENIOR');
    expect(normalizeSeniority(null, 'Engineer')).toBe('UNKNOWN');
  });
});

describe('salary text parsing', () => {
  it('parses ranges, currencies and periods', () => {
    expect(parseSalaryText('$120k – $150k a year')).toEqual({
      min: 120_000,
      max: 150_000,
      currency: 'USD',
      period: 'annual',
    });
    expect(parseSalaryText('€60,000 - €80,000 per year')).toEqual({
      min: 60_000,
      max: 80_000,
      currency: 'EUR',
      period: 'annual',
    });
    expect(parseSalaryText('$50/hour')).toEqual({
      min: 50,
      max: 50,
      currency: 'USD',
      period: 'hourly',
    });
  });

  it('leaves missing compensation unknown and annualises known periods', () => {
    expect(parseSalaryText(null)).toEqual({ min: null, max: null, currency: 'USD', period: 'unknown' });
    expect(annualiseSalary(50, 'hourly')).toBe(104_000);
    expect(annualiseSalary(5_000, 'monthly')).toBe(60_000);
    expect(annualiseSalary(null, 'annual')).toBeNull();
  });
});

describe('RSS parsing', () => {
  const xml = `<?xml version="1.0"?>
    <rss><channel><item>
      <title><![CDATA[Acme: Senior Engineer]]></title>
      <link>https://example.com/jobs/1</link>
      <guid>job-1</guid>
      <description><![CDATA[<p>Build &amp; ship</p>]]></description>
      <content:encoded><![CDATA[<p>Full description</p>]]></content:encoded>
      <pubDate>Mon, 02 Nov 2026 10:00:00 GMT</pubDate>
      <category>Programming</category>
      <region>Worldwide</region>
      <dc:creator>Acme &#9874; Remote</dc:creator>
    </item></channel></rss>`;

  it('parses CDATA, entities and nested tags', () => {
    const items = parseRssItems(xml);
    expect(items.length).toBe(1);
    expect(items[0].title).toBe('Acme: Senior Engineer');
    expect(items[0].description).toContain('Build & ship');
    expect(items[0].content).toContain('Full description');
    expect(items[0].region).toBe('Worldwide');
    expect(parseRssDate(items[0].pubDate)?.toISOString()).toBe('2026-11-02T10:00:00.000Z');
  });

  it('splits company from title and creator safely', () => {
    expect(splitCompanyFromTitle('Acme: Senior Engineer')).toEqual({
      company: 'Acme',
      title: 'Senior Engineer',
    });
    expect(splitCompanyFromTitle('Engineer: Platform')).toEqual({
      company: '',
      title: 'Engineer: Platform',
    });
    expect(splitCreator('Acme ⚒ Remote')).toEqual({ company: 'Acme', location: 'Remote' });
  });
});

describe('free job providers', () => {
  it('maps Remotive listings with salary, tags and attribution', () => {
    const job = mapRemotiveJob(
      {
        id: 42,
        url: 'https://remotive.com/jobs/42',
        title: 'Senior Data Engineer',
        company_name: 'Acme',
        category: 'Data',
        tags: ['Python', 'SQL'],
        job_type: 'full_time',
        publication_date: '2026-11-01T10:00:00Z',
        candidate_required_location: 'Europe',
        salary: '$100k - $130k',
        description: '<p>Build data pipelines.</p>',
      },
      source,
    );
    expect(job?.sourceJobId).toBe('42');
    expect(job?.category).toBe('DATA');
    expect(job?.employmentType).toBe('FULL_TIME');
    expect(job?.salaryMin).toBe(100_000);
    expect(job?.skills).toEqual(['Python', 'SQL']);
    expect(job?.attributionRequired).toBe(true);
  });

  it('maps Working Nomads and drops incomplete records', () => {
    const job = mapWorkingNomadsJob(
      {
        url: 'https://workingnomads.com/jobs/1',
        title: 'Product Designer',
        company_name: 'Beta',
        category_name: 'Design',
        tags: 'Figma, UX',
        location: 'Remote',
        pub_date: '2026-11-02T08:00:00Z',
      },
      source,
    );
    expect(job?.category).toBe('DESIGN');
    expect(job?.skills).toEqual(['Figma', 'UX']);
    expect(mapWorkingNomadsJob({ title: 'No URL' }, source)).toBeNull();
  });

  it('maps We Work Remotely RSS items', () => {
    const job = mapWeWorkRemotelyItem(
      {
        title: 'Acme: Senior Frontend Engineer',
        link: 'https://weworkremotely.com/jobs/1',
        guid: 'wwr-1',
        description: '',
        content: '<p>React and TypeScript.</p>',
        pubDate: '2026-11-01T10:00:00Z',
        category: 'Programming',
        region: 'Worldwide',
        creator: '',
      },
      source,
      'Programming',
    );
    expect(job?.company).toBe('Acme');
    expect(job?.title).toBe('Senior Frontend Engineer');
    expect(job?.category).toBe('ENGINEERING');
    expect(job?.description).toContain('React');
  });

  it('maps Jobspresso items and removes the feed footer', () => {
    const job = mapJobspressoItem(
      {
        title: 'Backend Developer',
        link: 'https://jobspresso.co/jobs/1',
        guid: 'js-1',
        description: '',
        content: '<p>Build APIs.</p><p>The post Backend Developer appeared first on Jobspresso.</p>',
        pubDate: '2026-11-01T10:00:00Z',
        category: '',
        region: '',
        creator: 'Acme ⚒ Remote',
      },
      source,
    );
    expect(job?.company).toBe('Acme');
    expect(job?.location).toBe('Remote');
    expect(job?.description).not.toContain('appeared first on');
  });
});

describe('AI ingestion image validation', () => {
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.alloc(96, 0x20),
  ]);
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(96, 0x20),
  ]);
  const jpegUrl = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
  const pngUrl = `data:image/png;base64,${png.toString('base64')}`;

  it('accepts JPEG and PNG data URLs with matching signatures', () => {
    const images = validateIngestionImages([jpegUrl, pngUrl]);
    expect(images.length).toBe(2);
    expect(images[0].mimeType).toBe('image/jpeg');
    expect(images[1].mimeType).toBe('image/png');
    expect(toDataUrl(images[0])).toBe(jpegUrl);
  });

  it('rejects unsupported, mismatched and oversized payloads', () => {
    const expectImageError = (fn: () => unknown) => {
      let thrown: unknown;
      try {
        fn();
      } catch (error) {
        thrown = error;
      }
      expect(thrown instanceof ImageValidationError).toBe(true);
    };

    expectImageError(() =>
      validateIngestionImages(['data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==']),
    );
    expectImageError(() => validateIngestionImages([`data:image/png;base64,${jpeg.toString('base64')}`]));
    expectImageError(() =>
      validateIngestionImages(Array.from({ length: MAX_INGESTION_IMAGES + 1 }, () => jpegUrl)),
    );
  });

  it('returns no images for empty input', () => {
    expect(validateIngestionImages(undefined)).toEqual([]);
    expect(validateIngestionImages([])).toEqual([]);
  });
});

describe('AI ingestion normalization', () => {
  it('merges model output over deterministic fallbacks and annualises salary', () => {
    const result = normalizeModelIngestion(model(), {
      text: 'Senior Backend Engineer at Acme. Build APIs with TypeScript.',
      jobUrl: 'https://acme.example/jobs/1',
      fallback: {
        prefill: {
          title: 'Fallback title',
          company: 'Fallback company',
          remoteType: 'Remote',
          salaryMin: '',
          salaryMax: '',
          currency: 'USD',
          jobDescription: 'Fallback description',
          notes: 'Private note',
        },
        signals: ['Deterministic parser found a job URL'],
        previewText: 'Fallback preview',
      },
    });

    expect(result.prefill.title).toBe('Senior Backend Engineer');
    expect(result.prefill.company).toBe('Acme');
    expect(result.prefill.salaryMin).toBe('90000');
    expect(result.prefill.salaryMax).toBe('120000');
    expect(result.prefill.currency).toBe('EUR');
    expect(result.prefill.notes).toBe('Private note');
    expect(result.prefill.requirements?.mustHave).toEqual(['5+ years of backend experience']);
    expect(result.confidence).toBeGreaterThan(0.9);
    expect(result.confidence < 0.92).toBe(true);
    expect(result.signals.some((signal) => signal.includes('AI extracted engineering'))).toBe(true);
  });

  it('falls back to deterministic values for unknown model fields', () => {
    const result = normalizeModelIngestion(
      model({
        title: '',
        company: '',
        description: '',
        category: 'OTHER',
        seniority: 'UNKNOWN',
        remoteType: 'Unknown',
        employmentType: 'UNKNOWN',
        salaryMin: null,
        salaryMax: null,
        currency: '',
        salaryPeriod: 'unknown',
        skills: [],
        requirements: [],
        contacts: [],
        source: '',
      }),
      {
        text: 'We are hiring a Junior Designer in London.',
        fallback: {
          prefill: {
            title: 'Junior Designer',
            company: 'Fallback Co',
            remoteType: 'Hybrid',
            jobDescription: 'Fallback description',
            salaryMin: '40000',
            salaryMax: '50000',
            currency: 'GBP',
          },
          signals: [],
          previewText: '',
        },
      },
    );

    expect(result.prefill.title).toBe('Junior Designer');
    expect(result.prefill.company).toBe('Fallback Co');
    expect(result.prefill.remoteType).toBe('Hybrid');
    expect(result.prefill.salaryMin).toBe('40000');
    expect(result.prefill.salaryMax).toBe('50000');
    expect(result.prefill.currency).toBe('GBP');
    expect(result.prefill.category).toBe('DESIGN');
    expect(result.prefill.seniority).toBe('ENTRY');
    expect(result.prefill.source).toBe('Pasted description');
  });

  it('deduplicates requirements and sanitises contacts', () => {
    expect(
      normalizeRequirements(
        model({
          requirements: [
            { text: 'TypeScript', kind: 'MUST_HAVE' },
            { text: ' typescript ', kind: 'MUST_HAVE' },
            { text: 'React', kind: 'NICE_TO_HAVE' },
          ],
        }),
      ),
    ).toEqual({
      mustHave: ['TypeScript'],
      niceToHave: ['React'],
      responsibilities: [],
      qualifications: [],
      benefits: [],
    });

    const contacts = normalizeModelContacts(
      model({
        contacts: [
          {
            name: 'Ada Lovelace',
            title: 'Recruiter',
            email: 'ada@acme.example',
            linkedinUrl: 'https://www.linkedin.com/in/ada',
            phone: '+44 20 0000 0000',
            relationshipType: 'recruiter',
          },
          {
            name: '',
            title: '',
            email: 'not-an-email',
            linkedinUrl: '',
            phone: '',
            relationshipType: '',
          },
          {
            name: 'Eve',
            title: '',
            email: '',
            linkedinUrl: 'https://evil.example/in/eve',
            phone: '',
            relationshipType: '',
          },
        ],
      }),
      'Acme',
    );

    expect(contacts.length).toBe(2);
    expect(contacts[0].email).toBe('ada@acme.example');
    expect(contacts[0].linkedinUrl).toContain('linkedin.com');
    expect(contacts[0].relationshipType).toBe('RECRUITER');
    expect(contacts[1].linkedinUrl).toBeUndefined();
  });
});
