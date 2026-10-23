/**
 * Editable DOCX adapter for the structured resume document.
 *
 * Content remains the same validated ResumeContent used by the shared preview
 * and PDF layout. DOCX uses semantic paragraphs and bullets so the text stays
 * easy to edit and parse; Word-compatible apps may reflow it differently from
 * the point-positioned PDF.
 */

import {
  Document,
  ExternalHyperlink,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from 'docx';
import { normalizeResumeSectionOrder, type ResumeContent, type ResumeSectionKey } from './schema';
import { DOCUMENT_FONT_FAMILIES, PAGE_SIZES, getAccent, getTemplate, isPageSizeKey, isTemplateKey } from './templates';

type ResumeDocxOptions = {
  content: ResumeContent;
  templateKey?: string;
  pageSize?: string;
  accentKey?: string;
  sectionOrder?: readonly string[];
  compact?: boolean;
};

const twips = (points: number) => Math.round(points * 20);
const halfPoints = (points: number) => Math.round(points * 2);
const clean = (value: string | null | undefined) => value?.trim() ?? '';

export async function renderResumeDocx(options: ResumeDocxOptions): Promise<Buffer> {
  const template = getTemplate(isTemplateKey(options.templateKey) ? options.templateKey : 'classic-ats');
  const pageSize = PAGE_SIZES[isPageSizeKey(options.pageSize) ? options.pageSize : 'A4'];
  const accent = getAccent((options.accentKey ?? 'charcoal') as Parameters<typeof getAccent>[0]);
  const bodySize = Math.max(9.5, template.baseFontSize);
  const docxFont = DOCUMENT_FONT_FAMILIES.docx;
  const compact = options.compact ?? false;
  const sectionGap = compact ? 90 : template.style === 'EXECUTIVE_EXPERIENCED' ? 240 : 170;
  const entryGap = compact ? 45 : 95;
  const body = (text: string, extra: Record<string, unknown> = {}) => new Paragraph({
    children: [new TextRun({ text, font: docxFont, size: halfPoints(bodySize), color: '17191E' })],
    spacing: { after: entryGap, line: 276 },
    ...extra,
  });
  const bullet = (text: string) => new Paragraph({
    children: [new TextRun({ text, font: docxFont, size: halfPoints(bodySize), color: '17191E' })],
    bullet: { level: 0 },
    indent: { left: twips(18), hanging: twips(4) },
    spacing: { after: compact ? 35 : 65, line: 276 },
  });
  const section = (label: string) => new Paragraph({
    text: label,
    heading: HeadingLevel.HEADING_2,
    keepNext: true,
    spacing: { before: sectionGap, after: compact ? 45 : 85 },
    border: template.sectionRules ? {
      bottom: { style: 'single' as never, size: 4, color: accent.accentDeep, space: 4 },
    } : undefined,
    run: { font: docxFont, size: halfPoints(template.baseHeadingSize), bold: true, color: accent.accentDeep },
  });

  const content = options.content;
  const paragraphs: Paragraph[] = [];
  const sectionParagraphs: Record<ResumeSectionKey, Paragraph[]> = {
    summary: [], experience: [], skills: [], education: [], projects: [], credentials: [],
  };
  if (clean(content.basics.fullName)) {
    const nameSize = template.style === 'EXECUTIVE_EXPERIENCED' ? 38 : template.style === 'MODERN_PROFESSIONAL' ? 34 : 32;
    paragraphs.push(new Paragraph({
      children: [new TextRun({ text: content.basics.fullName!, font: docxFont, size: nameSize, bold: true, color: '17191E' })],
      spacing: { after: 45 },
    }));
  }
  if (clean(content.basics.headline)) {
    paragraphs.push(new Paragraph({
      children: [new TextRun({ text: content.basics.headline!, font: docxFont, size: halfPoints(bodySize + 1), color: accent.accentDeep })],
      spacing: { after: 65 },
    }));
  }

  const contactParts = [content.basics.phone, content.basics.location].filter((value): value is string => Boolean(clean(value)));
  if (contactParts.length) paragraphs.push(body(contactParts.join('  ·  '), { spacing: { after: 60 } }));
  const links = [
    content.basics.email ? { label: 'Email', url: `mailto:${content.basics.email}` } : null,
    content.basics.linkedinUrl ? { label: 'LinkedIn', url: content.basics.linkedinUrl } : null,
    content.basics.portfolioUrl ? { label: 'Portfolio', url: content.basics.portfolioUrl } : null,
    content.basics.websiteUrl ? { label: 'Website', url: content.basics.websiteUrl } : null,
  ].filter((value): value is { label: string; url: string } => Boolean(value));
  if (links.length) {
    paragraphs.push(new Paragraph({
      children: links.flatMap(({ label, url }, index) => [
        ...(index ? [new TextRun({ text: '  ·  ', font: docxFont, size: halfPoints(9.5), color: '5B616C' })] : []),
        new ExternalHyperlink({
          link: url,
          children: [new TextRun({ text: label, style: 'Hyperlink', font: docxFont, size: halfPoints(9.5), color: accent.accentDeep })],
        }),
      ]),
      spacing: { after: 100 },
    }));
  }

  if (content.summary) {
    sectionParagraphs.summary.push(section('Professional Summary'));
    sectionParagraphs.summary.push(body(content.summary));
  }
  if (content.experiences.length) {
    sectionParagraphs.experience.push(section('Professional Experience'));
    for (const entry of content.experiences) {
      const title = [entry.jobTitle, entry.company].filter(Boolean).join(' · ');
      const dates = [formatDate(entry.startDate), entry.isCurrent ? 'Present' : formatDate(entry.endDate)].filter(Boolean).join(' – ');
      sectionParagraphs.experience.push(new Paragraph({
        children: [
          new TextRun({ text: title || 'Experience', font: docxFont, size: halfPoints(bodySize + 0.3), bold: true, color: '17191E' }),
          ...(dates ? [new TextRun({ text: `  |  ${dates}`, font: docxFont, size: halfPoints(9.5), color: '5B616C' })] : []),
        ],
        keepNext: true,
        spacing: { before: entryGap, after: 40 },
      }));
      if (entry.location) sectionParagraphs.experience.push(body(entry.location, { keepNext: true, spacing: { after: 40 } }));
      for (const line of [...entry.responsibilities, ...entry.achievements]) sectionParagraphs.experience.push(bullet(line));
      if (entry.technologies.length) sectionParagraphs.experience.push(body(`Technologies: ${entry.technologies.join(', ')}`, { spacing: { after: entryGap } }));
    }
  }
  if (content.skills.length) {
    sectionParagraphs.skills.push(section('Skills'));
    const grouped = new Map<string, string[]>();
    for (const skill of content.skills) {
      const group = skill.category || '';
      grouped.set(group, [...(grouped.get(group) ?? []), skill.name]);
    }
    for (const [group, skills] of grouped) sectionParagraphs.skills.push(body(`${group ? `${group}: ` : ''}${skills.join(', ')}`));
  }
  if (content.education.length) {
    sectionParagraphs.education.push(section('Education'));
    for (const entry of content.education) {
      const qualification = [entry.qualification, entry.fieldOfStudy].filter(Boolean).join(' · ');
      const institution = [entry.institution, formatDate(entry.endDate)].filter(Boolean).join(' · ');
      sectionParagraphs.education.push(new Paragraph({
        children: [
          ...(qualification ? [new TextRun({ text: qualification, font: docxFont, size: halfPoints(bodySize), bold: true, color: '17191E' })] : []),
          ...(institution ? [new TextRun({ text: `${qualification ? '  |  ' : ''}${institution}`, font: docxFont, size: halfPoints(bodySize), color: '5B616C' })] : []),
        ],
        spacing: { after: entryGap },
      }));
      if (entry.details) sectionParagraphs.education.push(body(entry.details));
    }
  }
  if (content.projects.length) {
    sectionParagraphs.projects.push(section('Projects'));
    for (const entry of content.projects) {
      const title = [entry.name, entry.role].filter(Boolean).join(' · ');
      sectionParagraphs.projects.push(new Paragraph({
        children: [new TextRun({ text: title || 'Project', font: docxFont, size: halfPoints(bodySize), bold: true, color: '17191E' })],
        keepNext: true,
        spacing: { after: 40 },
      }));
      if (entry.description) sectionParagraphs.projects.push(body(entry.description));
      for (const result of entry.results) sectionParagraphs.projects.push(bullet(result));
      if (entry.technologies.length) sectionParagraphs.projects.push(body(`Technologies: ${entry.technologies.join(', ')}`));
      if (entry.projectUrl) sectionParagraphs.projects.push(new Paragraph({
        children: [new ExternalHyperlink({ link: entry.projectUrl, children: [new TextRun({ text: 'Project', font: docxFont, size: halfPoints(9.5), color: accent.accentDeep })] })],
        spacing: { after: entryGap },
      }));
    }
  }
  if (content.credentials.length) {
    sectionParagraphs.credentials.push(section('Certifications & Other Credentials'));
    for (const entry of content.credentials) {
      const details = [entry.issuer, formatDate(entry.issuedDate), entry.proficiency].filter(Boolean).join(' · ');
      sectionParagraphs.credentials.push(body(`${entry.name}${details ? ` — ${details}` : ''}`));
    }
  }
  for (const key of normalizeResumeSectionOrder(options.sectionOrder)) {
    paragraphs.push(...sectionParagraphs[key]);
  }
  if (!paragraphs.length) paragraphs.push(body(''));

  const doc = new Document({
    title: content.basics.fullName ? `${content.basics.fullName} resume` : 'Resume',
    styles: {
      default: {
        document: { run: { font: docxFont, size: halfPoints(bodySize), color: '17191E' } },
        heading2: {
          run: { font: docxFont, size: halfPoints(template.baseHeadingSize), bold: true, color: accent.accentDeep },
          paragraph: { spacing: { before: sectionGap, after: compact ? 45 : 85 }, keepNext: true },
        },
      },
    },
    sections: [{
      properties: { page: {
        size: { width: twips(pageSize.width), height: twips(pageSize.height) },
        margin: {
          top: twips(compact ? 38 : pageSize.margins.top),
          right: twips(compact ? 38 : pageSize.margins.right),
          bottom: twips(compact ? 38 : pageSize.margins.bottom),
          left: twips(compact ? 38 : pageSize.margins.left),
        },
      } },
      children: paragraphs,
    }],
  });
  return Packer.toBuffer(doc);
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return value;
  const month = Number(match[2]);
  return month >= 1 && month <= 12
    ? `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month - 1]} ${match[1]}`
    : value;
}
