/**
 * Career-profile context: what we send about the user.
 *
 * The brief is explicit about fallback order, and this module implements it
 * literally:
 *
 *   1. User-confirmed structured career profile
 *   2. Explicitly saved work history and skills
 *   3. Relevant structured user preferences
 *   4. Verified data in compatible profile fields
 *
 * Two hard rules:
 *
 *  - THE RAW RESUME IS NEVER SENT. Resume Intelligence already produced a
 *    structured, user-reviewed profile; re-uploading the whole document for
 *    every job would be a larger privacy exposure than this task needs, and it
 *    would be paying to re-derive facts we already hold.
 *
 *  - NOTHING IS INVENTED FROM A NAME OR A TITLE. If the profile is empty, the
 *    context says it is empty. `completeness` drives the "insufficient
 *    information" state rather than a confident-sounding thin analysis.
 *
 * Fields deliberately excluded: email, phone, resume URLs, portfolio URLs.
 * A job analysis has no need for contact details, and the previous release
 * already established that the address on a resume must not be writable or
 * leakable through an unrelated path.
 */

import { prisma } from '@/lib/prisma';
import { getUserPreferences } from '@/lib/db-helpers';
import type { UserPreferences } from '@/types';
import { JOB_INTELLIGENCE_MAX_PROFILE_CHARS } from './limits';

export type ProfileCompleteness = 'COMPLETE' | 'PARTIAL' | 'MINIMAL' | 'EMPTY';

export type ProfileContext = {
  completeness: ProfileCompleteness;
  /** True when a user-confirmed career profile exists. */
  confirmed: boolean;
  /** Fields the profile genuinely does not have, in user-facing words. */
  missingInputs: string[];
  /** Short, bounded text handed to the provider. */
  contextText: string;
  /** Normalised skill names, for server-side evidence cross-checking. */
  skillNames: string[];
  /** Normalised titles this user has held, same purpose. */
  experienceTitles: string[];
  /** The career-profile version this context was built from. Feeds the fingerprint. */
  careerProfileVersion: number;
  careerProfileConfirmedAt: Date | null;
};

function tidy(value: string | null | undefined, max = 200): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function normaliseKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9+#.]+/g, ' ').trim();
}

function pushLine(lines: string[], label: string, value: string | null | undefined): void {
  const clean = tidy(value);
  if (clean) lines.push(`${label}: ${clean}`);
}

function pushList(lines: string[], label: string, values: readonly string[]): void {
  const cleaned = values.map((value) => tidy(value, 120)).filter((value): value is string => Boolean(value));
  if (cleaned.length) lines.push(`${label}: ${cleaned.join(', ')}`);
}

/**
 * Build the personalised context for one user.
 *
 * Pure apart from the two reads at the top. The preferences argument is
 * injectable so tests and callers that already loaded them do not pay for a
 * second query.
 */
export async function buildProfileContext(params: {
  userId: string;
  preferences?: UserPreferences;
}): Promise<ProfileContext> {
  const { userId } = params;
  const preferences = params.preferences ?? (await getUserPreferences(userId));

  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: {
      headline: true,
      summary: true,
      location: true,
      remotePreference: true,
      currentLevel: true,
      targetLevel: true,
      careerProfileVersion: true,
      careerProfileConfirmedAt: true,
      skills: { select: { name: true, origin: true, confirmed: true } },
      experiences: {
        select: { jobTitle: true, company: true, technologies: true },
        orderBy: { sortOrder: 'asc' },
        take: 12,
      },
      projects: { select: { name: true, role: true, technologies: true }, take: 6 },
      education: { select: { qualification: true, fieldOfStudy: true, institution: true }, take: 6 },
      credentials: { select: { kind: true, name: true }, take: 12 },
    },
  });

  const skillNames = (profile?.skills ?? []).map((skill) => skill.name).filter(Boolean);
  const experienceTitles = (profile?.experiences ?? [])
    .map((entry) => entry.jobTitle)
    .filter((value): value is string => Boolean(value));

  const confirmed = Boolean(profile?.careerProfileConfirmedAt);

  // ─── Completeness ────────────────────────────────────────────────────────
  // Assessed on what we can actually compare against, not on row counts.
  const missingInputs: string[] = [];

  const hasTargetTitles = preferences.targetRoles.length + preferences.preferredTitles.length > 0;
  const hasAnySkill = skillNames.length > 0;
  const hasAnyExperience = (profile?.experiences ?? []).length > 0;
  const hasSalaryPreference = preferences.salaryMin > 0 || preferences.salaryTarget > 0;
  const hasRegionPreference = preferences.preferredRegions.length > 0 || preferences.workRegions.length > 0;

  if (!hasTargetTitles) missingInputs.push('your target job titles');
  if (!hasAnySkill && !hasAnyExperience) missingInputs.push('your skills or work history');
  if (!hasSalaryPreference) missingInputs.push('your salary preference');
  if (!hasRegionPreference && !profile?.location) missingInputs.push('your location or preferred regions');

  let completeness: ProfileCompleteness;
  if (!profile && missingInputs.length >= 3) {
    completeness = 'EMPTY';
  } else if (hasAnySkill && hasAnyExperience && hasTargetTitles && confirmed) {
    completeness = 'COMPLETE';
  } else if (missingInputs.length === 0) {
    completeness = 'COMPLETE';
  } else if (missingInputs.length <= 2) {
    completeness = 'PARTIAL';
  } else {
    completeness = 'MINIMAL';
  }

  // ─── Context text ────────────────────────────────────────────────────────
  const lines: string[] = [];

  if (confirmed) {
    lines.push('The candidate has a confirmed career profile. The facts below are ones they reviewed and kept.');
  } else if (skillNames.length > 0 || hasAnyExperience) {
    lines.push(
      'The candidate has saved career data that has NOT been confirmed by them. Treat it as indicative and say so when a conclusion depends on it.',
    );
  }

  if (profile?.headline) pushLine(lines, 'Professional headline', profile.headline);
  if (profile?.location) pushLine(lines, 'Location on profile', profile.location);

  pushList(lines, 'Target job titles', [...preferences.targetRoles, ...preferences.preferredTitles]);
  pushLine(
    lines,
    'Target seniority',
    preferences.targetLevel === 'FLEXIBLE' ? 'Flexible — no specific level' : preferences.targetLevel,
  );
  pushLine(lines, 'Current seniority', preferences.currentLevel);

  pushList(lines, 'Preferred regions', preferences.preferredRegions);
  pushList(lines, 'Work regions', preferences.workRegions);
  pushList(lines, 'Time zone preferences', preferences.timezoneMatches);
  pushLine(
    lines,
    'Work arrangement preference',
    preferences.remoteOnly ? 'Remote only' : tidy(profile?.remotePreference) ?? 'Remote or hybrid',
  );

  if (hasSalaryPreference) {
    const target = preferences.salaryTarget > 0 ? preferences.salaryTarget : preferences.salaryMin;
    pushLine(lines, 'Salary preference', `Target ${target.toLocaleString('en-US')} USD`);
  }

  if (hasAnySkill) {
    // Confirmed skills first, then everything saved — so the model can tell the
    // difference without a second field.
    const confirmedSkills = (profile?.skills ?? []).filter((skill) => skill.confirmed).map((s) => s.name);
    const otherSkills = (profile?.skills ?? []).filter((skill) => !skill.confirmed).map((s) => s.name);
    pushList(lines, 'Skills (user-confirmed)', confirmedSkills);
    pushList(lines, 'Skills (saved, not yet confirmed)', otherSkills);
  }

  for (const entry of profile?.experiences ?? []) {
    const title = tidy(entry.jobTitle);
    if (!title) continue;
    const company = tidy(entry.company);
    const technologies = entry.technologies.map((tech) => tidy(tech, 60)).filter((tech): tech is string => Boolean(tech));
    const parts = [`- ${title}${company ? ` at ${company}` : ''}`];
    if (technologies.length) parts.push(`  technologies: ${technologies.join(', ')}`);
    lines.push(parts.join('\n'));
  }

  for (const project of profile?.projects ?? []) {
    const name = tidy(project.name);
    if (!name) continue;
    const technologies = project.technologies.map((tech) => tidy(tech, 60)).filter((tech): tech is string => Boolean(tech));
    pushLine(lines, `- Project "${name}"${project.role ? ` (${project.role})` : ''}${technologies.length ? ` [${technologies.join(', ')}]` : ''}`, null);
  }

  for (const entry of profile?.education ?? []) {
    const qualification = tidy(entry.qualification);
    if (!qualification) continue;
    const field = tidy(entry.fieldOfStudy);
    const institution = tidy(entry.institution);
    pushLine(lines, '- Education', `${qualification}${field ? ` in ${field}` : ''}${institution ? `, ${institution}` : ''}`);
  }

  for (const credential of profile?.credentials ?? []) {
    pushLine(lines, `- ${tidy(credential.kind) ?? 'Credential'}`, credential.name);
  }

  const contextText = lines.join('\n').slice(0, JOB_INTELLIGENCE_MAX_PROFILE_CHARS);

  return {
    completeness,
    confirmed,
    missingInputs,
    contextText,
    skillNames: skillNames.map(normaliseKey).filter(Boolean),
    experienceTitles: experienceTitles.map(normaliseKey).filter(Boolean),
    careerProfileVersion: profile?.careerProfileVersion ?? 0,
    careerProfileConfirmedAt: profile?.careerProfileConfirmedAt ?? null,
  };
}