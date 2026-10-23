import { Document, ExternalHyperlink, Packer, Paragraph, TextRun } from 'docx';
import type { LetterApplicant } from './letter-layout';
import { DOCUMENT_FONT_FAMILIES } from '@/lib/resume-builder/templates';
import type { PageSizeKey } from '@/lib/resume-builder/templates';

const twips = (points: number) => Math.round(points * 20);

export async function renderMaterialDocx(params: {
  type: string;
  title: string;
  content: string;
  subject: string | null;
  applicant: LetterApplicant;
  company: string | null;
  jobTitle: string | null;
  pageSize: PageSizeKey;
  date?: string | null;
}): Promise<Buffer> {
  const coverLetter = params.type === 'COVER_LETTER';
  const children: Paragraph[] = [];
  const docxFont = DOCUMENT_FONT_FAMILIES.docx;
  const baseSize = 22; // 11 pt, half-point units.
  const body = (text: string) => new Paragraph({
    children: [new TextRun({ text, font: docxFont, size: baseSize, color: '17191E' })],
    spacing: { after: 170, line: 300 },
  });

  if (coverLetter) {
    if (params.applicant.name) children.push(new Paragraph({
      children: [new TextRun({ text: params.applicant.name, font: docxFont, size: 34, bold: true, color: '17191E' })],
      spacing: { after: 55 },
    }));
    const contact = [params.applicant.email, params.applicant.phone, params.applicant.location]
      .filter((value): value is string => Boolean(value?.trim()));
    if (contact.length) children.push(new Paragraph({
      children: [new TextRun({ text: contact.join('  ·  '), font: docxFont, size: 19, color: '4A505A' })],
      spacing: { after: 55 },
    }));
    const links = (params.applicant.links ?? []).filter((value) => /^https?:\/\//i.test(value));
    if (links.length) children.push(new Paragraph({
      children: links.flatMap((url, index) => [
        ...(index ? [new TextRun({ text: '  ·  ', font: docxFont, size: 19, color: '4A505A' })] : []),
        new ExternalHyperlink({ link: url, children: [new TextRun({ text: displayUrl(url), font: docxFont, size: 19, color: '155450' })] }),
      ]),
      spacing: { after: 220 },
    }));
    if (params.date) children.push(new Paragraph({
      children: [new TextRun({ text: params.date, font: docxFont, size: 20, color: '4A505A' })],
      spacing: { after: 220 },
    }));
    if (params.company) children.push(new Paragraph({
      children: [new TextRun({ text: params.company, font: docxFont, size: baseSize, bold: true, color: '17191E' })],
      spacing: { after: 45 },
    }));
    const subject = params.subject || (params.jobTitle ? `Application for ${params.jobTitle}` : null);
    if (subject) children.push(new Paragraph({
      children: [new TextRun({ text: `Re: ${subject}`, font: docxFont, size: baseSize, bold: true, color: '17191E' })],
      spacing: { after: 240 },
    }));
  } else if (params.subject) {
    // Message/email exports keep their email-like structure, with no letterhead.
    children.push(new Paragraph({
      children: [new TextRun({ text: `Subject: ${params.subject}`, font: docxFont, size: baseSize, bold: true, color: '17191E' })],
      spacing: { after: 200 },
    }));
  }

  const paragraphs = params.content
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean);
  for (const paragraph of paragraphs) children.push(body(paragraph));
  if (!children.length) children.push(body(''));

  const points = params.pageSize === 'LETTER'
    ? { width: 612, height: 792, margins: { top: 46, right: 48, bottom: 46, left: 48 } }
    : { width: 595.28, height: 841.89, margins: { top: 46, right: 46, bottom: 46, left: 46 } };
  const document = new Document({
    title: params.title,
    sections: [{
      properties: { page: {
        size: { width: twips(points.width), height: twips(points.height) },
        margin: {
          top: twips(points.margins.top), right: twips(points.margins.right),
          bottom: twips(points.margins.bottom), left: twips(points.margins.left),
        },
      } },
      children,
    }],
  });
  return Packer.toBuffer(document);
}

function displayUrl(value: string): string {
  try { return new URL(value).host.replace(/^www\./, ''); } catch { return value; }
}
