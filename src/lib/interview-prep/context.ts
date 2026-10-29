/**
 * Candidate context for interview preparation.
 *
 * The pack must be personal without becoming a second career-profile system.
 * This module reads the existing confirmed profile, job preferences and
 * structured resume, then builds the bounded text sent to the provider.
 *
 * Rules:
 *  - Nothing is inferred from a name or job title.
 *  - Confirmed and unconfirmed profile data stay visibly separate.
 *  - A resume is secondary evidence, used only when the structured profile is
 *    thin or when the user has not created one.
 *  - The full evidence corpus is kept separately so quotes can be re-checked
 *    against what the candidate actually supplied.
 */

import { prisma } from '@/lib/prisma';
import { getUserPreferences } from '@/lib/db-helpers';
import { resumeContentToText } from '@/lib/resume-builder/optimization/verify';
import type { ResumeContent } from '@/lib/resume-builder/schema';
import {
  INTERVIEW_PREP_MAX_PROFILE_CHARS,
  INTERVIEW_PREP_MAX_RESUME_CHARS,
} from './limits';

export type CandidateCompleteness = 'COMPLETE' | 'PARTIAL' | 'MINIMAL' | 'EMPTY';

export type CandidateContext = {
  profileText: string;
  resumeText: string;
  /** Combined text quotes are verified against. */
  evidenceText: string;
  hasEvidence: boolean;
  confirmed: boolean;
  completeness: CandidateCompleteness;
  profileVersion: number;
  resumeId: string | null;
  resumeRevision: number;
  skillNames: string[];
  projectNames: string[];
  experienceTitles: string[];
};

function tidy(value: string | null | undefined, max = 300): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function pushLine(lines: string[], label: string, value: string | null | undefined): void {
  const clean = tidy(value, 500);
  if (clean) lines.push(`${label}: ${clean}`);
}

function pushList(lines: string[], label: string, values: readonly string[], maxItems = 20): void {
  const cleaned = values
    .map((value) => tidy(value, 160))
    .filter((value): value is string => Boolean(value))
    .slice(0, maxItems);
  if (cleaned.length) lines.push(`${label}: ${cleaned.join(', ')}`);
}

/** Normalises a claim for comparison across casing/punctuation differences. */
export function normaliseCandidateKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9+#.]+/g, ' ').trim();
}

/**
 * Build the candidate context for one user.
 *
 * The optional job id selects a resume targeted at that job, falling back to
 * the most recently updated structured resume.
 */
export async function buildCandidateContext(params: {
  userId: string;
  jobId?: string | null;
}): Promise<CandidateContext> {
  const { userId, jobId } = params;
  const preferences = await getUserPreferences(userId);

  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: {
      headline: true,
      summary: true,
      location: true,
      currentLevel: true,
      targetLevel: true,
      targetRoles: true,
      preferredTitles: true,
      preferredStack: true,
      mustHaveTech: true,
      preferredRegions: true,
      workRegions: true,
      preferredIndustries: true,
      remoteOnly: true,
      remotePreference: true,
      visaSponsorshipRequired: true,
      careerProfileVersion: true,
      careerProfileConfirmedAt: true,
      skills: { select: { name: true, origin: true, confirmed: true }, orderBy: { name: 'asc' } },
      experiences: {
        select: {
          jobTitle: true,
          company: true,
          location: true,
          startDate: true,
          endDate: true,
          isCurrent: true,
          responsibilities: true,
          achievements: true,
          technologies: true,
        },
        orderBy: { sortOrder: 'asc' },
        take: 12,
      },
      projects: {
        select: {
          name: true,
          role: true,
          description: true,
          technologies: true,
          results: true,
          startDate: true,
          endDate: true,
        },
        orderBy: { sortOrder: 'asc' },
        take: 8,
      },
      education: {
        select: { qualification: true, fieldOfStudy: true, institution: true, startDate: true, endDate: true },
        orderBy: { sortOrder: 'asc' },
        take: 8,
      },
      credentials: {
        select: { kind: true, name: true, issuer: true, issuedDate: true },
        orderBy: { sortOrder: 'asc' },
        take: 12,
      },
    },
  });

  const targeted = jobId
    ? await prisma.structuredResume.findFirst({
        where: { userId, targetJobId: jobId },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, content: true, revision: true },
      })
    : null;
  const resume =
    targeted ??
    (await prisma.structuredResume.findFirst({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, content: true, revision: true },
    }));

  let resumeText = '';
  if (resume) {
    try {
      resumeText = resumeContentToText(resume.content as ResumeContent).slice(0, INTERVIEW_PREP_MAX_RESUME_CHARS);
    } catch {
      resumeText = '';
    }
  }

  const confirmed = Boolean(profile?.careerProfileConfirmedAt);
  const skills = profile?.skills ?? [];
  const confirmedSkills = skills.filter((skill) => skill.confirmed).map((skill) => skill.name);
  const unconfirmedSkills = skills.filter((skill) => !skill.confirmed).map((skill) => skill.name);
  const experiences = profile?.experiences ?? [];
  const projects = profile?.projects ?? [];
  const hasExperience = experiences.some((entry) => Boolean(tidy(entry.jobTitle) || tidy(entry.company)));
  const hasContent = Boolean(
    tidy(profile?.headline) ||
      tidy(profile?.summary) ||
      skills.length ||
      hasExperience ||
      projects.length ||
      resumeText.length,
  );

  const missingInputs: string[] = [];
  if (!skills.length) missingInputs.push('skills');
  if (!hasExperience) missingInputs.push('work experience');
  if (!projects.length) missingInputs.push('projects or work samples');
  if (!preferences.targetRoles.length && !preferences.preferredTitles.length) missingInputs.push('target roles');

  let completeness: CandidateCompleteness = 'EMPTY';
  if (hasContent) {
    if (skills.length && hasExperience && (confirmed || projects.length)) completeness = 'COMPLETE';
    else if (skills.length || hasExperience) completeness = 'PARTIAL';
    else completeness = 'MINIMAL';
  }

  const lines: string[] = [];
  if (confirmed) {
    lines.push('The candidate has a confirmed career profile. Facts below were reviewed by them.');
  } else if (hasContent) {
    lines.push(
      'The candidate has profile data that they have NOT confirmed. Treat it as indicative, and do not present it as verified beyond what the source shows.',
    );
  }

  pushLine(lines, 'Headline', profile?.headline);
  pushLine(lines, 'Summary', profile?.summary);
  pushLine(lines, 'Location', profile?.location);
  pushLine(lines, 'Current seniority', profile?.currentLevel);
  pushLine(lines, 'Target seniority', profile?.targetLevel);
  pushList(lines, 'Target roles', profile?.targetRoles ?? []);
  pushList(lines, 'Preferred titles', profile?.preferredTitles ?? []);
  pushList(lines, 'Preferred stack', profile?.preferredStack ?? []);
  pushList(lines, 'Must-have technologies', profile?.mustHaveTech ?? []);
  pushList(lines, 'Preferred industries', profile?.preferredIndustries ?? []);
  pushList(lines, 'Preferred regions', profile?.preferredRegions ?? []);
  pushList(lines, 'Work regions', profile?.workRegions ?? []);
  lines.push(`Remote only: ${profile?.remoteOnly ? 'yes' : 'no'}`);
  lines.push(`Remote preference: ${tidy(profile?.remotePreference) ?? 'not specified'}`);
  if (profile?.visaSponsorshipRequired) lines.push('Sponsorship required: yes');

  pushList(lines, 'Skills (confirmed)', confirmedSkills);
  pushList(lines, 'Skills (saved, not yet confirmed)', unconfirmedSkills);

  for (const entry of experiences) {
    const title = tidy(entry.jobTitle);
    const company = tidy(entry.company);
    if (!title && !company) continue;
    const dates = [tidy(entry.startDate), entry.isCurrent ? 'present' : tidy(entry.endDate)].filter(Boolean).join(' – ');
    lines.push(`- Experience: ${title ?? 'Role'}${company ? ` at ${company}` : ''}${dates ? ` (${dates})` : ''}`);
    for (const responsibility of entry.responsibilities.slice(0, 6)) {
      const clean = tidy(responsibility, 400);
      if (clean) lines.push(`  Responsibility: ${clean}`);
    }
    for (const achievement of entry.achievements.slice(0, 4)) {
      const clean = tidy(achievement, 400);
      if (clean) lines.push(`  Achievement: ${clean}`);
    }
    pushList(lines, '  Technologies', entry.technologies, 12);
  }

  for (const project of projects) {
    const name = tidy(project.name);
    if (!name) continue;
    lines.push(`- Project: ${name}${project.role ? ` (${project.role})` : ''}`);
    pushLine(lines, '  Description', project.description);
    pushList(lines, '  Technologies', project.technologies, 12);
    for (const result of project.results.slice(0, 4)) {
      const clean = tidy(result, 400);
      if (clean) lines.push(`  Result: ${clean}`);
    }
  }

  for (const entry of profile?.education ?? []) {
    const qualification = tidy(entry.qualification);
    if (!qualification) continue;
    lines.push(
      `- Education: ${qualification}${entry.fieldOfStudy ? ` in ${tidy(entry.fieldOfStudy)}` : ''}${entry.institution ? `, ${tidy(entry.institution)}` : ''}`,
    );
  }

  for (const credential of profile?.credentials ?? []) {
    const name = tidy(credential.name);
    if (!name) continue;
    lines.push(`- ${tidy(credential.kind) ?? 'Credential'}: ${name}${credential.issuer ? ` (${tidy(credential.issuer)})` : ''}`);
  }

  if (!hasContent) {
    lines.push('NO CANDIDATE EVIDENCE WAS SUPPLIED. Do not invent skills, projects or experience.');
  }

  const profileText = lines.join('\n').slice(0, INTERVIEW_PREP_MAX_PROFILE_CHARS);
  const resumeSection = resumeText
    ? `\n\n=== STRUCTURED RESUME EXTRACT (secondary evidence) ===\n${resumeText}`
    : '';

  const evidenceText = [profileText, resumeText].filter(Boolean).join('\n\n').slice(0, 20_000);

  return {
    profileText: `${profileText}${resumeSection}`,
    resumeText,
    evidenceText,
    hasEvidence: hasContent,
    confirmed,
    completeness,
    profileVersion: profile?.careerProfileVersion ?? 0,
    resumeId: resume?.id ?? null,
    resumeRevision: resume?.revision ?? 0,
    skillNames: skills.map((skill) => skill.name).filter(Boolean),
    projectNames: projects.map((project) => project.name).filter((name): name is string => Boolean(name)),
    experienceTitles: experiences.map((entry) => entry.jobTitle).filter((title): title is string => Boolean(title)),
  };
}
