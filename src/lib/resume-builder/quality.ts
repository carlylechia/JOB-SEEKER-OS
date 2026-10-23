import type { ResumeContent } from './schema';

export type ResumeQualityIssue = {
  code: string;
  severity: 'warning' | 'suggestion';
  title: string;
  detail: string;
};

/** Deterministic editorial checks. These inform review and never silently edit content. */
export function checkResumeQuality(content: ResumeContent, pageCount?: number): ResumeQualityIssue[] {
  const issues: ResumeQualityIssue[] = [];
  const add = (issue: ResumeQualityIssue) => issues.push(issue);
  const contact = [content.basics.email, content.basics.phone, content.basics.linkedinUrl,
    content.basics.portfolioUrl, content.basics.websiteUrl].some((value) => Boolean(value?.trim()));

  if (!content.basics.fullName) add({
    code: 'MISSING_NAME', severity: 'warning', title: 'Name is missing',
    detail: 'Add your name if you want it shown on this resume.',
  });
  if (!contact) add({
    code: 'MISSING_CONTACT', severity: 'suggestion', title: 'No contact method found',
    detail: 'Add an email, phone number, or professional link so an employer can reach you.',
  });
  if ((content.summary?.length ?? 0) > 500) add({
    code: 'LONG_SUMMARY', severity: 'suggestion', title: 'Summary may be hard to scan',
    detail: 'Consider shortening the summary to a few focused sentences.',
  });

  const placeholders = [
    content.basics.fullName, content.basics.headline, content.summary,
    ...content.experiences.flatMap((entry) => [entry.jobTitle, entry.company, ...entry.responsibilities, ...entry.achievements]),
    ...content.education.flatMap((entry) => [entry.qualification, entry.institution, entry.details]),
    ...content.projects.flatMap((entry) => [entry.name, entry.description, ...entry.results]),
    ...content.credentials.map((entry) => entry.name),
  ].filter((value): value is string => Boolean(value));
  if (placeholders.some((value) => /\b(?:lorem ipsum|your name|company name|insert (?:name|text|details)|replace me|tbd)\b|\bxxx{2,}\b/i.test(value))) {
    add({
      code: 'PLACEHOLDER_TEXT', severity: 'warning', title: 'Possible placeholder text',
      detail: 'Review text such as “Your Name” or “TBD” before sending the document.',
    });
  }

  const roleWithoutDetails = content.experiences.filter((entry) => !entry.jobTitle && !entry.company).length;
  if (roleWithoutDetails > 0) add({
    code: 'MISSING_ROLE_DETAILS', severity: 'warning', title: 'Experience entry needs a role or employer',
    detail: `${roleWithoutDetails} experience ${roleWithoutDetails === 1 ? 'entry has' : 'entries have'} neither a job title nor an employer name.`,
  });

  const seen = new Set<string>();
  let duplicates = 0;
  for (const entry of content.experiences) {
    for (const bullet of [...entry.responsibilities, ...entry.achievements]) {
      const normalized = bullet.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      if (!normalized) continue;
      if (seen.has(normalized)) duplicates += 1;
      seen.add(normalized);
    }
  }
  if (duplicates) add({
    code: 'REPEATED_BULLETS', severity: 'suggestion', title: 'Repeated experience bullets',
    detail: `${duplicates} bullet${duplicates === 1 ? '' : 's'} repeat wording found elsewhere in your experience section.`,
  });

  if (pageCount !== undefined && pageCount > 3) add({
    code: 'LONG_DOCUMENT', severity: 'suggestion', title: 'Long document',
    detail: `This resume spans ${pageCount} pages. Check that each page supports the role you are applying for.`,
  });
  return issues;
}
