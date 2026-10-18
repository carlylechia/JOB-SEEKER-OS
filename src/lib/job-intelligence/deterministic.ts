/**
 * Deterministic inputs to an analysis, and the fingerprint over them.
 *
 * This module is where "AI must explain the matching engine, not replace it"
 * becomes concrete. Before any provider call we compute, in plain TypeScript:
 *
 *   - the fit score and tier, via the product's own `calculateFitScore`
 *   - which hard gates zeroed it, if any
 *   - the title relationship, capped by the existing `titleMatchesAny` result
 *   - work arrangement, location, eligibility, time zone and compensation
 *   - the data completeness that decides whether an answer is possible at all
 *
 * All of it is then handed to the model as read-only context, and all of it is
 * re-applied over the model's answer in `verify.ts`. The model's job is to say
 * WHY in language a person can act on.
 *
 * The fingerprint is the cache key. It is a hash of the inputs that actually
 * change an answer — not `updatedAt`, not a timestamp, not the request — so an
 * unrelated edit does not invalidate a cached analysis and repeated identical
 * requests reuse the same row instead of paying twice.
 */

import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { mapDbJob, type DbJob } from '@/lib/db-helpers';
import { calculateFitScore, calculateFitTier } from '@/lib/scoring';
import { titleMatchesAny } from '@/lib/preferences';
import type { JobLead, UserPreferences } from '@/types';
import {
  assessCompensation,
  assessEligibilityCompatibility,
  assessLocationCompatibility,
  assessRemoteCompatibility,
  assessTimeZoneCompatibility,
  classifyWorkArrangement,
  detectRegions,
} from './dimensions';
import { collectTargetTitles, classifyTitleRelationship } from './title-fit';
import { ANALYSIS_PROMPT_VERSION, ANALYSIS_SCHEMA_VERSION } from './schema';
import {
  JOB_INTELLIGENCE_MEANINGFUL_CHAR_FLOOR,
  JOB_INTELLIGENCE_MAX_JOB_CHARS,
} from './limits';
import type { ProfileContext } from './profile-context';

/**
 * Version of the deterministic scoring input.
 *
 * Bump this when `calculateFitScore` or the weight set changes in a way that
 * would produce different numbers. It is folded into the fingerprint so a
 * scoring change invalidates cached analyses that quoted the old numbers.
 */
export const SCORING_INPUT_VERSION = 1;

export type DeterministicInputs = {
  job: JobLead;
  preferences: UserPreferences;
  profile: ProfileContext;

  /** The product's own score. Never model-generated. */
  fitScore: number;
  fitTier: string;
  /** Non-empty when geography or time zone scored zero. */
  blockedBy: string[];
  /** The existing `titleMatchesAny` boolean. Advisory output cannot exceed it. */
  titleMatch: boolean;

  titleRelationship: ReturnType<typeof classifyTitleRelationship>;
  workArrangement: ReturnType<typeof classifyWorkArrangement>;
  remoteCompatibility: ReturnType<typeof assessRemoteCompatibility>;
  locationCompatibility: ReturnType<typeof assessLocationCompatibility>;
  timeZoneCompatibility: ReturnType<typeof assessTimeZoneCompatibility>;
  eligibilityCompatibility: ReturnType<typeof assessEligibilityCompatibility>;
  compensation: ReturnType<typeof assessCompensation>;

  /** Bounded job text prepared for the provider, plus whether it was cut. */
  jobText: string;
  wasTruncated: boolean;
  /** What kind of inputs we had. */
  dataCompleteness: 'COMPLETE' | 'PARTIAL' | 'MINIMAL';
  hadJobDescription: boolean;

  /** Stable hash over every input above that can change the answer. */
  inputFingerprint: string;
};

/**
 * Normalise free text before hashing and before sending.
 *
 * Same shape as the resume feature's normaliser: collapse whitespace, strip
 * control characters, keep the result bounded. Line structure is preserved
 * because a posting's sections carry meaning.
 */
export function normaliseJobText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Letters and digits — the signal that there is real prose, not bullet glyphs. */
export function countMeaningfulJobChars(text: string): number {
  return text.replace(/[^A-Za-z0-9]/g, '').length;
}

/**
 * Prepare the job text for the provider.
 *
 * Truncation is explicit so the model knows the posting continues rather than
 * believing it saw everything, exactly as the resume path does.
 */
export function prepareJobTextForProvider(raw: string): { text: string; truncated: boolean } {
  const text = normaliseJobText(raw);
  if (text.length <= JOB_INTELLIGENCE_MAX_JOB_CHARS) return { text, truncated: false };

  let cut = text.slice(0, JOB_INTELLIGENCE_MAX_JOB_CHARS);
  const lastBreak = cut.lastIndexOf('\n');
  if (lastBreak > JOB_INTELLIGENCE_MAX_JOB_CHARS * 0.6) cut = cut.slice(0, lastBreak);

  return {
    text: `${cut}\n\n[Posting continues — truncated at ${JOB_INTELLIGENCE_MAX_JOB_CHARS} characters]`,
    truncated: true,
  };
}

/**
 * Load the job the user actually owns and compute every deterministic input.
 *
 * Ownership is part of the query. A job belonging to someone else is a
 * `null` here exactly as it is a 404 in the API — the response must not confirm
 * that it exists.
 */
export async function buildDeterministicInputs(params: {
  userId: string;
  jobId: string;
  preferences: UserPreferences;
  profile: ProfileContext;
}): Promise<DeterministicInputs | null> {
  const { userId, jobId, preferences, profile } = params;

  const row = await prisma.jobLead.findFirst({
    where: { id: jobId, userId, deletedAt: null },
  });
  if (!row) return null;

  const job = mapDbJob(row as DbJob);

  return computeDeterministicInputs({ job, preferences, profile });
}

/**
 * Pure core of `buildDeterministicInputs`.
 *
 * Separated so every rule below is unit-testable with no database and no
 * provider.
 */
export function computeDeterministicInputs(params: {
  job: JobLead;
  preferences: UserPreferences;
  profile: ProfileContext;
}): DeterministicInputs {
  const { job, preferences, profile } = params;

  // 1. The product's own scoring. Untouched, and used verbatim.
  const fitScore = calculateFitScore(job, preferences);
  const fitTier = calculateFitTier(fitScore);

  const blockedBy: string[] = [];
  if (job.score.geographyEligibility === 0) blockedBy.push('geography or eligibility');
  if (job.score.timezoneCompatibility === 0) blockedBy.push('timezone compatibility');

  // 2. Title relationship, capped by the existing deterministic rule.
  const targets = collectTargetTitles(preferences);
  const titleMatch = targets.length > 0 ? titleMatchesAny(job.title, targets) : true;
  const titleRelationship = classifyTitleRelationship({
    jobTitle: job.title,
    targets,
    deterministicTitleMatch: titleMatch,
  });

  // 3. Everything else is arithmetic over data we already hold.
  const description = job.notes ?? '';
  const workArrangement = classifyWorkArrangement({
    remoteType: job.remoteType,
    description,
  });

  const jobRegions = detectRegions(
    [job.location, job.eligibilityRegion, job.remoteType].filter(Boolean).join(' '),
  );

  const remoteCompatibility = assessRemoteCompatibility({
    arrangement: workArrangement.arrangement,
    remoteOnly: preferences.remoteOnly,
  });

  const locationCompatibility = assessLocationCompatibility({
    jobLocation: job.location,
    jobEligibilityRegion: job.eligibilityRegion,
    jobRegions,
    preferredRegions: preferences.preferredRegions,
    userLocation: null,
  });

  const timeZoneCompatibility = assessTimeZoneCompatibility({
    jobTimezoneRequirement: job.timezoneRequirement,
    timezoneMatches: preferences.timezoneMatches,
    timezoneToleranceHours: preferences.timezoneToleranceHours,
  });

  const eligibilityCompatibility = assessEligibilityCompatibility({
    eligibilityRegion: job.eligibilityRegion,
    jobRegions,
    workRegions: preferences.workRegions,
    preferredRegions: preferences.preferredRegions,
  });

  const compensation = assessCompensation({
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    currency: job.currency,
    preferenceMin: preferences.salaryMin,
    preferenceTarget: preferences.salaryTarget,
    // The product stores preferences as bare integers; the product's own
    // compensation scoring has always compared them against a USD posting.
    // Stated explicitly rather than assumed silently.
    preferenceCurrency: 'USD',
  });

  // 4. Job text. `notes` is only treated as a description when it actually
  //    looks like one — see `looksLikeJobDescription`.
  const rawText = looksLikeJobDescription(description) ? description : '';
  const prepared = prepareJobTextForProvider(rawText);
  const hadJobDescription =
    prepared.text.length > 0 && countMeaningfulJobChars(prepared.text) >= JOB_INTELLIGENCE_MEANINGFUL_CHAR_FLOOR;

  const dataCompleteness = deriveDataCompleteness({
    hadJobDescription,
    jobText: prepared.text,
    profileCompleteness: profile.completeness,
    hasTargetTitles: targets.length > 0,
  });

  const inputs = {
    job,
    preferences,
    profile,
    fitScore,
    fitTier,
    blockedBy,
    titleMatch,
    titleRelationship,
    workArrangement,
    remoteCompatibility,
    locationCompatibility,
    timeZoneCompatibility,
    eligibilityCompatibility,
    compensation,
    jobText: prepared.text,
    wasTruncated: prepared.truncated,
    dataCompleteness,
    hadJobDescription,
  } satisfies Omit<DeterministicInputs, 'inputFingerprint'>;

  return { ...inputs, inputFingerprint: fingerprintFor(inputs) };
}

/**
 * Does this text look like a real job description?
 *
 * `JobLead.notes` is a free-text field that the ingestion flow fills with
 * generated clue strings like "Detected stack: … | Eligibility clues: …".
 * Feeding that to the model as a posting would be presenting our own guesses
 * to the user as the employer's words, so it is excluded here.
 *
 * The test is structural rather than clever: a description has sentences. A
 * clue line is a single pipe-delimited fragment with a label prefix.
 */
export function looksLikeJobDescription(notes: string): boolean {
  const text = normaliseJobText(notes);
  if (countMeaningfulJobChars(text) < JOB_INTELLIGENCE_MEANINGFUL_CHAR_FLOOR) return false;

  // Every non-empty line looks like a generated clue.
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return false;

  const clueLine = /^(detected stack|eligibility clues|timezone clues|region clues|score notes?)\s*:/i;
  const allLinesAreClues = lines.every((line) => clueLine.test(line) || (line.includes('|') && line.split('|').every((part) => clueLine.test(part.trim()))));

  if (allLinesAreClues) return false;

  // A real description has either several lines or at least one sentence.
  const sentences = text.split(/[.!?]\s|\n/).filter((part) => part.trim().length > 12);
  return lines.length >= 3 || sentences.length >= 2;
}

function deriveDataCompleteness(params: {
  hadJobDescription: boolean;
  jobText: string;
  profileCompleteness: ProfileContext['completeness'];
  hasTargetTitles: boolean;
}): 'COMPLETE' | 'PARTIAL' | 'MINIMAL' {
  const { hadJobDescription, jobText, profileCompleteness, hasTargetTitles } = params;

  if (!hadJobDescription && (profileCompleteness === 'EMPTY' || profileCompleteness === 'MINIMAL')) {
    return 'MINIMAL';
  }
  if (!hadJobDescription) return 'PARTIAL';
  if (profileCompleteness === 'COMPLETE' && hasTargetTitles && jobText.length > 200) return 'COMPLETE';
  return 'PARTIAL';
}

/**
 * Stable hash over the inputs that can change an answer.
 *
 * Deliberately NOT hashed: `updatedAt`, `createdAt`, request ids, the current
 * time, the row id. Hashing any of those would either churn the cache on every
 * request or invalidate a result for a change that did not affect the answer.
 *
 * Deliberately hashed: the job's own text and metadata, the career-profile
 * version, the specific preference fields that steer matching, the deterministic
 * scoring inputs, and both contract versions. Change any of those and the
 * answer genuinely changes.
 */
export function fingerprintFor(inputs: {
  job: JobLead;
  preferences: UserPreferences;
  profile: Pick<ProfileContext, 'careerProfileVersion' | 'completeness' | 'confirmed'>;
  jobText: string;
  fitScore: number;
  fitTier: string;
  titleMatch: boolean;
}): string {
  const { job, preferences, profile, jobText, fitScore, fitTier, titleMatch } = inputs;

  const payload = {
    v: ANALYSIS_SCHEMA_VERSION,
    prompt: ANALYSIS_PROMPT_VERSION,
    scoring: SCORING_INPUT_VERSION,
    job: {
      title: job.title.trim(),
      company: job.company.trim(),
      location: (job.location ?? '').trim(),
      remoteType: (job.remoteType ?? '').trim(),
      timezoneRequirement: (job.timezoneRequirement ?? '').trim(),
      eligibilityRegion: (job.eligibilityRegion ?? '').trim(),
      salaryMin: job.salaryMin ?? null,
      salaryMax: job.salaryMax ?? null,
      currency: (job.currency ?? 'USD').trim().toUpperCase(),
      text: jobText,
    },
    profile: {
      version: profile.careerProfileVersion,
      completeness: profile.completeness,
      confirmed: profile.confirmed,
    },
    preferences: {
      currentLevel: preferences.currentLevel,
      targetLevel: preferences.targetLevel,
      targetRoles: sortedList(preferences.targetRoles),
      preferredTitles: sortedList(preferences.preferredTitles),
      preferredStack: sortedList(preferences.preferredStack),
      mustHaveTech: sortedList(preferences.mustHaveTech),
      preferredRegions: sortedList(preferences.preferredRegions),
      workRegions: sortedList(preferences.workRegions),
      timezoneMatches: sortedList(preferences.timezoneMatches),
      remoteOnly: preferences.remoteOnly,
      salaryMin: preferences.salaryMin,
      salaryTarget: preferences.salaryTarget,
      timezoneToleranceHours: preferences.timezoneToleranceHours,
    },
    deterministic: { fitScore, fitTier, titleMatch },
  };

  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

/**
 * JSON with sorted keys.
 *
 * Key order must not change the hash: two identical payloads built by
 * different code paths have to produce the same fingerprint, or the cache
 * silently stops working.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}

function sortedList(values: readonly string[]): string[] {
  return [...values].map((value) => value.trim()).sort();
}