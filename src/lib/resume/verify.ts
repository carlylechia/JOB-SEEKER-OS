/**
 * Server-side verification of a model's extraction.
 *
 * This runs between the provider returning and anything being written to the
 * database. It is the reason the stored extraction can be trusted enough to
 * show a user as "supported by resume".
 *
 * It does four things the provider cannot do for itself:
 *
 *  1. RE-CHECKS EVIDENCE. Every claim whose supporting snippet cannot actually
 *     be found in the resume is downgraded to NEEDS_REVIEW. A model that
 *     self-reports SUPPORTED for something the document never says is corrected
 *     here rather than argued with in the UI.
 *  2. BOUNDS EVERYTHING. Lengths, array sizes and URL shapes are re-applied to
 *     provider output, because a schema hint is not a validation pass.
 *  3. NORMALISES DATES. Partial dates stay partial.
 *  4. DROPS EMPTY ROWS. An entry with nothing in it is noise the user would
 *     have to delete by hand.
 *
 * Because this runs before persistence, the raw resume text never has to be
 * stored, and evidence verification never has to be repeated at save time.
 */

import {
  compareResumeDates,
  dedupeStrings,
  detectDateConflict,
  isOngoingDate,
  normalizeForCompare,
  normalizeResumeDate,
  sanitizeExtractedUrl,
  trimOrNull,
  verifyEvidence,
} from './normalise';
import {
  EXTRACTION_SCHEMA_VERSION,
  type CareerExtraction,
  type CredentialExtraction,
  type EvidenceLevel,
  type ProjectExtraction,
  type WorkExperienceExtraction,
} from './schema';

const MAX_ITEMS = {
  experience: 25,
  education: 15,
  skills: 80,
  projects: 20,
  credentials: 40,
};

/** Normalise and re-date a single experience entry. */
function verifyExperience(
  entry: WorkExperienceExtraction,
  resumeText: string,
): WorkExperienceExtraction | null {
  const jobTitle = trimOrNull(entry.jobTitle, 240);
  const company = trimOrNull(entry.company, 240);
  const location = trimOrNull(entry.location, 240);
  const startDate = normalizeResumeDate(entry.startDate);
  const endDate = isOngoingDate(entry.endDate) ? 'present' : normalizeResumeDate(entry.endDate);

  // A role with neither a title nor a company is not identifiable. Anything
  // else is kept — a dated role at a named employer is real even if the title
  // line was unreadable.
  if (!jobTitle && !company) return null;

  const evidence = verifyEvidence(entry.evidence, resumeText);
  const conflicts = dedupeStrings(
    [...entry.conflicts, detectDateConflict(startDate, endDate)].filter(Boolean) as string[],
    5,
  );

  return {
    jobTitle,
    company,
    location,
    startDate,
    endDate,
    isCurrent: entry.isCurrent || endDate === 'present',
    responsibilities: dedupeStrings(entry.responsibilities, 20),
    achievements: dedupeStrings(entry.achievements, 20),
    technologies: verifyTechnologies(entry.technologies, resumeText).slice(0, 40),
    evidence,
    conflicts,
  };
}

/**
 * Technologies attached to a role. Each keeps its own evidence so the review UI
 * can distinguish "listed on the role" from "our guess".
 */
function verifyTechnologies(
  technologies: WorkExperienceExtraction['technologies'],
  resumeText: string,
): WorkExperienceExtraction['technologies'] {
  return technologies.map((tech) => ({
    name: trimOrNull(tech.name, 240) ?? '',
    origin: tech.origin,
    evidence: verifyEvidence(tech.evidence, resumeText),
  })).filter((tech) => tech.name.length > 0);
}

function verifyProject(project: ProjectExtraction, resumeText: string): ProjectExtraction | null {
  const name = trimOrNull(project.name, 240);
  const description = trimOrNull(project.description, 1200);
  if (!name && !description) return null;

  return {
    name,
    description,
    role: trimOrNull(project.role, 240),
    technologies: dedupeStrings(project.technologies, 30),
    startDate: normalizeResumeDate(project.startDate),
    endDate: isOngoingDate(project.endDate) ? 'present' : normalizeResumeDate(project.endDate),
    projectUrl: sanitizeExtractedUrl(project.projectUrl),
    results: dedupeStrings(project.results, 15),
    evidence: verifyEvidence(project.evidence, resumeText),
    conflicts: dedupeStrings(project.conflicts, 5),
  };
}

function verifyCredential(credential: CredentialExtraction, resumeText: string): CredentialExtraction | null {
  const name = trimOrNull(credential.name, 240);
  // A credential with no name tells the user nothing and cannot be verified.
  if (!name) return null;

  return {
    kind: credential.kind,
    name,
    issuer: trimOrNull(credential.issuer, 240),
    issuedDate: normalizeResumeDate(credential.issuedDate),
    expiresDate: normalizeResumeDate(credential.expiresDate),
    // Proficiency only means something for a language. Leaving it populated on
    // a certification would be a fabricated credential detail.
    proficiency: credential.kind === 'LANGUAGE' ? trimOrNull(credential.proficiency, 240) : null,
    details: trimOrNull(credential.details, 1200),
    evidence: verifyEvidence(credential.evidence, resumeText),
  };
}

/**
 * Produce the extraction that will actually be stored and shown.
 *
 * Pure: the same input and the same resume text always give the same output,
 * which is what makes it testable without a provider.
 */
export function verifyCareerExtraction(
  input: CareerExtraction,
  resumeText: string,
): CareerExtraction {
  const skills = dedupeBy(
    input.skills
      .map((skill) => ({
        name: trimOrNull(skill.name, 240) ?? '',
        origin: skill.origin,
        evidence: verifyEvidence(skill.evidence, resumeText),
      }))
      .filter((skill) => skill.name.length > 0),
    (skill) => normalizeForCompare(skill.name),
    MAX_ITEMS.skills,
  );

  const workExperience = input.workExperience
    .map((entry) => verifyExperience(entry, resumeText))
    .filter((entry): entry is WorkExperienceExtraction => entry !== null)
    // Most recent first, with undated entries last rather than treated as
    // ancient.
    .sort((a, b) => compareResumeDates(a.startDate, b.startDate))
    .slice(0, MAX_ITEMS.experience);

  const location = [input.city, input.region, input.country].filter(Boolean).join(', ');

  return {
    schemaVersion: EXTRACTION_SCHEMA_VERSION,
    fullName: trimOrNull(input.fullName, 240),
    email: normalizeEmail(input.email),
    phone: trimOrNull(input.phone, 240),
    city: trimOrNull(input.city, 240),
    region: trimOrNull(input.region, 240),
    country: trimOrNull(input.country, 240),
    headline: trimOrNull(input.headline, 400),
    summary: trimOrNull(input.summary, 1200),
    linkedinUrl: sanitizeExtractedUrl(input.linkedinUrl),
    portfolioUrl: sanitizeExtractedUrl(input.portfolioUrl),
    websiteUrl: sanitizeExtractedUrl(input.websiteUrl),
    otherLinks: input.otherLinks
      .map((link) => ({ label: trimOrNull(link.label, 240) ?? 'Link', url: sanitizeExtractedUrl(link.url) }))
      .filter((link): link is { label: string; url: string } => link.url !== null)
      .slice(0, 10),
    workExperience,
    education: input.education
      .filter((entry) => entry.institution || entry.qualification || entry.fieldOfStudy)
      .map((entry) => ({
        institution: trimOrNull(entry.institution, 240),
        qualification: trimOrNull(entry.qualification, 240),
        fieldOfStudy: trimOrNull(entry.fieldOfStudy, 240),
        startDate: normalizeResumeDate(entry.startDate),
        endDate: isOngoingDate(entry.endDate) ? 'present' : normalizeResumeDate(entry.endDate),
        details: trimOrNull(entry.details, 1200),
        evidence: verifyEvidence(entry.evidence, resumeText),
        conflicts: dedupeStrings(entry.conflicts, 5),
      }))
      .slice(0, MAX_ITEMS.education),
    skills,
    projects: input.projects
      .map((project) => verifyProject(project, resumeText))
      .filter((project): project is ProjectExtraction => project !== null)
      .slice(0, MAX_ITEMS.projects),
    credentials: input.credentials
      .map((credential) => verifyCredential(credential, resumeText))
      .filter((credential): credential is CredentialExtraction => credential !== null)
      .slice(0, MAX_ITEMS.credentials),
    warnings: dedupeStrings(input.warnings, 20),
  };
}

function dedupeBy<T>(items: T[], key: (item: T) => string, limit: number): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Email is matched case-insensitively on the domain and local part.
 *
 * Deliberately NOT cross-checked against the signed-in user's address: this is
 * the address printed on the resume, and a user may legitimately be analysing
 * a resume prepared for someone else or an older one of their own.
 */
function normalizeEmail(value: string | null): string | null {
  const trimmed = trimOrNull(value, 320);
  if (!trimmed) return null;
  const match = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.exec(trimmed);
  return match ? trimmed.toLowerCase() : null;
}

/** Count of values the user should look at before trusting an extraction. */
export function countReviewFlags(extraction: CareerExtraction): number {
  let flags = 0;

  const tally = (level: EvidenceLevel) => {
    if (level !== 'SUPPORTED') flags += 1;
  };

  for (const entry of extraction.workExperience) {
    tally(entry.evidence.level);
    if (entry.conflicts.length > 0) flags += 1;
    for (const tech of entry.technologies) {
      if (tech.origin === 'INFERRED') flags += 1;
    }
  }
  for (const entry of extraction.education) tally(entry.evidence.level);
  for (const skill of extraction.skills) {
    if (skill.origin === 'INFERRED') flags += 1;
    else tally(skill.evidence.level);
  }
  for (const project of extraction.projects) tally(project.evidence.level);
  for (const credential of extraction.credentials) tally(credential.evidence.level);

  return flags;
}