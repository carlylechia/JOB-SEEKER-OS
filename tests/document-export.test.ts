import { before, describe, expect, it } from './harness';
import mammoth from 'mammoth';
import { getDocumentProxy, extractText } from 'unpdf';
import { buildLetterLayout } from '@/lib/application-materials/letter-layout';
import { renderMaterialDocx } from '@/lib/application-materials/docx';
import { renderResumeDocx } from '@/lib/resume-builder/docx';
import { getLayoutMetrics, preparePdfEngine, renderPdfLayout } from '@/lib/resume-builder/pdf';
import { buildLayout, contactLineFor } from '@/lib/resume-builder/layout';
import { resumeDocumentDownloadHeaders } from '@/lib/resume-builder/download';
import { checkResumeQuality } from '@/lib/resume-builder/quality';
import { resumeContentSchema } from '@/lib/resume-builder/schema';
import { typicalContent, unicodeContent } from './resume-builder-fixtures';

before(async () => {
  await preparePdfEngine();
});

describe('editable document exports', () => {
  it('exports a structured resume to a readable editable DOCX', async () => {
    const bytes = await renderResumeDocx({
      content: unicodeContent(),
      templateKey: 'executive-experienced',
      pageSize: 'LETTER',
      compact: true,
    });
    const extracted = await mammoth.extractRawText({ buffer: bytes });
    expect(bytes.subarray(0, 2).toString('ascii')).toBe('PK');
    expect(extracted.value).toContain('José Müller-Þórsdóttir');
    expect(extracted.value).toContain('Principal Engineer');
    expect(extracted.value).toContain('Reykjavík, Ísland');

    const orderedResume = await renderResumeDocx({ content: typicalContent() });
    const orderedText = (await mammoth.extractRawText({ buffer: orderedResume })).value;
    expect(orderedText.indexOf('Led the migration')).toBeLessThan(orderedText.indexOf('Reduced p99 checkout latency'));

    const headers = resumeDocumentDownloadHeaders({
      resumeName: 'Jordan Ellis — One-Page',
      byteLength: bytes.byteLength,
      extension: 'docx',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    expect(headers.get('Content-Type')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(headers.get('Content-Disposition')).toContain('Jordan-Ellis-One-Page.docx');
    expect(headers.get('Cache-Control')).toContain('private, no-store');
  });

  it('masks header links and respects the saved section order in PDF and DOCX', async () => {
    const content = typicalContent();
    const order = ['skills', 'summary', 'experience', 'education', 'projects', 'credentials'] as const;
    const contact = contactLineFor(content) ?? '';
    expect(contact).toContain('Email');
    expect(contact).toContain('LinkedIn');
    if (content.basics.email) expect(contact).not.toContain(content.basics.email);
    if (content.basics.linkedinUrl) expect(contact).not.toContain(content.basics.linkedinUrl);

    const layout = buildLayout({
      content,
      templateKey: 'classic-ats',
      accentKey: 'gold',
      density: 1,
      sectionOrder: order,
    }, getLayoutMetrics());
    const blocks = layout.pages.flatMap((page) => page.blocks);
    const text = blocks.filter((block) => block.kind === 'TEXT');
    expect(text.some((block) => block.text.includes('LinkedIn') && block.href === content.basics.linkedinUrl)).toBe(true);
    expect(text.some((block) => block.text.includes('Email') && block.href === `mailto:${content.basics.email}`)).toBe(true);
    expect(text.findIndex((block) => block.text === 'SKILLS')).toBeLessThan(text.findIndex((block) => block.text === 'PROFESSIONAL SUMMARY'));

    const bytes = await renderResumeDocx({ content, sectionOrder: order });
    const exported = (await mammoth.extractRawText({ buffer: bytes })).value;
    expect(exported.indexOf('Skills')).toBeLessThan(exported.indexOf('Professional Summary'));
    expect(exported).toContain('LinkedIn');
    expect(exported).not.toContain(content.basics.linkedinUrl ?? '');
  });

  it('keeps cover letters structured and short messages free of letterhead', async () => {
    const applicant = {
      name: 'Jordan Ellis',
      email: 'jordan@example.com',
      phone: '+1 202 555 0100',
      location: 'Washington, DC',
      links: ['https://example.com'],
    };
    const letter = await renderMaterialDocx({
      type: 'COVER_LETTER',
      title: 'Application for Software Engineer',
      content: 'Dear Hiring Team,\n\nI built verified TypeScript services for a payments team.\n\nSincerely,\nJordan Ellis',
      subject: null,
      applicant,
      company: 'Northwind Systems',
      jobTitle: 'Software Engineer',
      pageSize: 'A4',
      date: 'October 23, 2026',
    });
    const letterText = (await mammoth.extractRawText({ buffer: letter })).value;
    expect(letterText).toContain('Jordan Ellis');
    expect(letterText).toContain('jordan@example.com');
    expect(letterText).toContain('Northwind Systems');
    expect(letterText).toContain('Re: Application for Software Engineer');
    expect(letterText).toContain('Dear Hiring Team');

    const message = await renderMaterialDocx({
      type: 'LINKEDIN_CONNECTION',
      title: 'Recruiter note',
      content: 'Hello Maya, I would like to connect about the backend role.',
      subject: null,
      applicant,
      company: 'Northwind Systems',
      jobTitle: 'Software Engineer',
      pageSize: 'A4',
    });
    const messageText = (await mammoth.extractRawText({ buffer: message })).value;
    expect(messageText).toContain('Hello Maya');
    expect(messageText).not.toContain('Jordan Ellis');
    expect(messageText).not.toContain('Northwind Systems');
  });

  it('reports proportionate deterministic review suggestions without editing content', () => {
    const source = typicalContent();
    const content = resumeContentSchema.parse({
      ...source,
      basics: { ...source.basics, fullName: null, email: null, phone: null, linkedinUrl: null, portfolioUrl: null, websiteUrl: null },
      summary: 'Your Name. '.repeat(60),
      experiences: [
        { ...source.experiences[0], responsibilities: [source.experiences[0].achievements[0]] },
        { ...source.experiences[1], jobTitle: null, company: null, responsibilities: [source.experiences[0].achievements[0]] },
      ],
    });
    const before = structuredClone(content);
    const issues = checkResumeQuality(content, 4);
    const codes = issues.map((issue) => issue.code);
    expect(codes).toContain('MISSING_NAME');
    expect(codes).toContain('MISSING_CONTACT');
    expect(codes).toContain('LONG_SUMMARY');
    expect(codes).toContain('PLACEHOLDER_TEXT');
    expect(codes).toContain('MISSING_ROLE_DETAILS');
    expect(codes).toContain('REPEATED_BULLETS');
    expect(codes).toContain('LONG_DOCUMENT');
    expect(content).toEqual(before);
  });
});

describe('measured cover-letter PDF layout', () => {
  it('uses real font metrics, the selected page geometry, and actual page flow', async () => {
    const metrics = getLayoutMetrics();
    const short = buildLetterLayout({
      content: 'Dear Hiring Team,\n\nI have built reliable services and can support this role with verified experience.\n\nSincerely,\nJordan Ellis',
      metrics,
      pageSize: 'LETTER',
      applicant: { name: 'Jordan Ellis', email: 'jordan@example.com', location: 'Washington, DC' },
      date: 'October 23, 2026',
      company: 'Northwind Systems',
      jobTitle: 'Software Engineer',
    });
    expect(short.pages[0].width).toBe(612);
    expect(short.pages[0].height).toBe(792);
    const shortPdf = await renderPdfLayout(short);
    expect(shortPdf.pageCount).toBe(1);
    const shortProxy = await getDocumentProxy(new Uint8Array(shortPdf.bytes));
    const extracted = await extractText(shortProxy, { mergePages: true });
    expect(extracted.text).toContain('Jordan Ellis');
    expect(extracted.text).toContain('Northwind Systems');
    expect(extracted.text).toContain('Dear Hiring Team');

    const long = buildLetterLayout({
      content: Array.from({ length: 24 }, (_, index) => `Paragraph ${index + 1}: ${'Verified application experience and relevant work. '.repeat(12)}`).join('\n\n'),
      metrics,
      pageSize: 'A4',
    });
    const longPdf = await renderPdfLayout(long);
    expect(longPdf.pageCount).toBeGreaterThan(1);
  });
});
