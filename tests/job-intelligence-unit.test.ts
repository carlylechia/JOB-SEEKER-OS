/**
 * Job Intelligence deterministic unit tests.
 *
 * These cover the layer the model is not allowed to overrule: title
 * relationship, work arrangement, location, eligibility, time zone,
 * compensation, the overall category rules, and the fingerprint.
 *
 * No database and no provider, so they run fast and they fail loudly whenever a
 * matching decision changes. The claims under test are the ones that would
 * matter if they were false: a managerial role reading as a direct match, a
 * currency conversion we invented, a missing salary treated as zero, an AI
 * verdict overriding a hard scoring block.
 */

import { describe, it, expect } from './harness';

import {
  assessCompensation,
  assessEligibilityCompatibility,
  assessLocationCompatibility,
  assessRemoteCompatibility,
  assessTimeZoneCompatibility,
  classifyWorkArrangement,
  detectRegions,
} from '@/lib/job-intelligence/dimensions';
import {
  clampRelationship,
  classifyTitleRelationship,
  collectTargetTitles,
  isManagerialMismatch,
  titlesAreEquivalent,
} from '@/lib/job-intelligence/title-fit';
import { deriveOverallCategory, TIER_CATEGORY } from '@/lib/job-intelligence/categories';
import { computeDeterministicInputs, looksLikeJobDescription } from '@/lib/job-intelligence/deterministic';
import {
  containsUnsupportableClaim,
  excerptAppearsIn,
  profileSupportsSkill,
} from '@/lib/job-intelligence/verify';
import {
  GENERATED_CLUE_NOTES,
  sampleJob,
  samplePreferences,
  sampleProfileContext,
  SAMPLE_JOB_TEXT,
} from './job-intelligence-fixtures';

// ─── Title relationship ────────────────────────────────────────────────────

describe('title relationship', () => {
  it('calls an identical title a direct target match', () => {
    const result = classifyTitleRelationship({
      jobTitle: 'Backend Engineer',
      targets: ['Backend Engineer'],
      deterministicTitleMatch: true,
    });
    expect(result.relationship).toBe('DIRECT_TARGET_MATCH');
  });

  it('does not call a managerial role a direct match for an IC target', () => {
    // The brief's own example: a similarly named managerial role must not
    // match a user seeking intermediate individual-contributor roles.
    const result = classifyTitleRelationship({
      jobTitle: 'Software Engineering Manager',
      targets: ['Software Engineer'],
      deterministicTitleMatch: true,
    });
    expect(result.relationship).toBe('CONFLICTING_ROLE');
  });

  it('does not call "Engineering Manager" a match for a bare "Engineer" target', () => {
    const result = classifyTitleRelationship({
      jobTitle: 'Engineering Manager',
      targets: ['Engineer'],
      deterministicTitleMatch: true,
    });
    expect(result.relationship).toBe('CONFLICTING_ROLE');
  });

  it('allows a managerial role when the user targets management too', () => {
    const result = classifyTitleRelationship({
      jobTitle: 'Engineering Manager',
      targets: ['Engineering Manager'],
      deterministicTitleMatch: true,
    });
    expect(result.relationship).toBe('DIRECT_TARGET_MATCH');
  });

  /**
   * A level marker changes the seniority, not the role. Demoting "Senior
   * Backend Engineer" to "adjacent" for a user targeting "Backend Engineer"
   * would contradict `titleMatchesAny`, which treats the two as a match.
   */
  it('treats a level marker as the same role, not an adjacent one', () => {
    for (const jobTitle of [
      'Senior Backend Engineer',
      'Junior Backend Engineer',
      'Lead Backend Engineer',
      'Principal Backend Engineer',
      'Backend Engineer II',
    ]) {
      const result = classifyTitleRelationship({
        jobTitle,
        targets: ['Backend Engineer'],
        deterministicTitleMatch: true,
      });
      expect(result.relationship).toBe('DIRECT_TARGET_MATCH');
    }
  });

  it('matches a bare role against a levelled target', () => {
    const result = classifyTitleRelationship({
      jobTitle: 'Backend Engineer',
      targets: ['Senior Backend Engineer'],
      deterministicTitleMatch: true,
    });
    expect(result.relationship).toBe('DIRECT_TARGET_MATCH');
  });

  it('still calls a managerial role conflicting despite a level marker', () => {
    const result = classifyTitleRelationship({
      jobTitle: 'Senior Software Engineering Manager',
      targets: ['Software Engineer'],
      deterministicTitleMatch: true,
    });
    expect(result.relationship).toBe('CONFLICTING_ROLE');
  });

  it('calls a role sharing only filler words a weak match', () => {
    const result = classifyTitleRelationship({
      jobTitle: 'Growth Marketing Lead',
      targets: ['Backend Engineer'],
      deterministicTitleMatch: false,
    });
    expect(result.relationship).toBe('WEAK_MATCH');
  });

  it('calls a neighbouring role an adjacent opportunity', () => {
    const result = classifyTitleRelationship({
      jobTitle: 'Platform Engineer',
      targets: ['Backend Engineer'],
      deterministicTitleMatch: false,
    });
    expect(result.relationship).toBe('ADJACENT_OPPORTUNITY');
  });

  it('says it lacks information when the user set no targets', () => {
    const result = classifyTitleRelationship({
      jobTitle: 'Backend Engineer',
      targets: [],
      deterministicTitleMatch: true,
    });
    expect(result.relationship).toBe('INSUFFICIENT_INFORMATION');
    expect(result.reason).toContain('target job titles');
  });

  it('never upgrades past the deterministic result', () => {
    // The scoring engine called this a miss. Advisory output must not be able
    // to call it a direct match however persuasive the reasoning.
    const clamped = clampRelationship('DIRECT_TARGET_MATCH', false);
    expect(clamped).toBe('RELATED_ROLE');

    // And when the engine called it a match, a direct match is still allowed.
    expect(clampRelationship('DIRECT_TARGET_MATCH', true)).toBe('DIRECT_TARGET_MATCH');
    expect(clampRelationship('DIRECT_TARGET_MATCH', true)).not.toBe('RELATED_ROLE');
  });

  it('downgrades rather than upgrades when the engine agreed', () => {
    expect(clampRelationship('WEAK_MATCH', true)).toBe('WEAK_MATCH');
    expect(clampRelationship('CONFLICTING_ROLE', true)).toBe('CONFLICTING_ROLE');
  });

  it('treats roman numerals and level markers as the same role', () => {
    // "II" and "Senior" change the level, not the role.
    expect(titlesAreEquivalent('Software Engineer II', 'Software Engineer')).toBe(true);
    expect(titlesAreEquivalent('Senior Backend Engineer', 'backend  engineer')).toBe(true);
    expect(titlesAreEquivalent('Backend Engineer', 'Frontend Engineer')).toBe(false);
  });

  it('flags a managerial mismatch only when the user targets IC roles', () => {
    expect(isManagerialMismatch('Engineering Manager', ['Engineer'])).toBe(true);
    expect(isManagerialMismatch('Engineering Manager', ['Engineering Manager'])).toBe(false);
    expect(isManagerialMismatch('Engineering Manager', [])).toBe(false);
    expect(isManagerialMismatch('Backend Engineer', ['Engineer'])).toBe(false);
  });

  it('collects and de-duplicates targets from both preference fields', () => {
    const targets = collectTargetTitles({
      targetRoles: ['Backend Engineer', 'backend engineer'],
      preferredTitles: ['API Engineer', '  '],
    });
    expect(targets).toHaveLength(2);
  });
});

// ─── Work arrangement ──────────────────────────────────────────────────────

describe('work arrangement', () => {
  it('reads the structured field before prose', () => {
    const result = classifyWorkArrangement({
      remoteType: 'Hybrid',
      description: 'This role is fully remote.',
    });
    expect(result.arrangement).toBe('HYBRID');
  });

  it('falls back to the description when the field is empty', () => {
    const result = classifyWorkArrangement({
      remoteType: '',
      description: 'You will be on-site three days a week.',
    });
    expect(result.arrangement).toBe('ON_SITE');
  });

  it('reports NOT_STATED rather than guessing', () => {
    const result = classifyWorkArrangement({ remoteType: '', description: 'About the role' });
    expect(result.arrangement).toBe('NOT_STATED');
    expect(result.evidenceText).toBeNull();
  });

  it('does not read worldwide availability from the word remote', () => {
    // "Remote" here is a work arrangement, not a country list. Eligibility is
    // handled separately and must not be inferred from it.
    const result = classifyWorkArrangement({
      remoteType: '',
      description: 'Fully remote position, must be based in the United States.',
    });
    expect(result.arrangement).toBe('REMOTE');
  });

  it('flags hybrid as only partly meeting a remote-only preference', () => {
    const result = assessRemoteCompatibility({ arrangement: 'HYBRID', remoteOnly: true });
    expect(result.outcome).toBe('PARTIAL_MATCH');
  });

  it('treats an unstated arrangement as unknown, not as a match', () => {
    const result = assessRemoteCompatibility({ arrangement: 'NOT_STATED', remoteOnly: true });
    expect(result.outcome).toBe('UNKNOWN');
  });

  it('is satisfied by remote work when the user has no restriction', () => {
    const result = assessRemoteCompatibility({ arrangement: 'ON_SITE', remoteOnly: false });
    expect(result.outcome).toBe('MATCH');
  });
});

// ─── Location ──────────────────────────────────────────────────────────────

describe('location compatibility', () => {
  it('matches a worldwide role against any preferred region', () => {
    const result = assessLocationCompatibility({
      jobLocation: 'Worldwide',
      jobEligibilityRegion: '',
      jobRegions: [],
      preferredRegions: ['EU'],
      userLocation: null,
    });
    expect(result.outcome).toBe('MATCH');
  });

  it('reports a mismatch when the regions do not overlap', () => {
    const result = assessLocationCompatibility({
      jobLocation: 'United States only',
      jobEligibilityRegion: 'US',
      jobRegions: ['US'],
      preferredRegions: ['EU'],
      userLocation: 'Berlin',
    });
    expect(result.outcome).toBe('MISMATCH');
    expect(result.explanation).toContain('confirm');
  });

  it('never treats an absent location as a match', () => {
    const result = assessLocationCompatibility({
      jobLocation: '',
      jobEligibilityRegion: '',
      jobRegions: [],
      preferredRegions: ['US'],
      userLocation: 'Austin',
    });
    expect(result.outcome).toBe('UNKNOWN');
  });

  it('never infers eligibility from a profile location alone', () => {
    // Knowing someone is in Berlin is not knowing they may work in the US.
    const result = assessLocationCompatibility({
      jobLocation: '',
      jobEligibilityRegion: 'US citizens only',
      jobRegions: ['US'],
      preferredRegions: ['EU'],
      userLocation: 'Berlin, Germany',
    });
    expect(result.outcome).toBe('MISMATCH');
    expect(result.requiresConfirmation).toBe(true);
  });

  it('detects only explicitly stated regions', () => {
    expect(detectRegions('Remote in the United States')).toContain('US');
    expect(detectRegions('Remote in EMEA')).toContain('EU');
    expect(detectRegions('Office in Lagos')).toHaveLength(0);
  });
});

// ─── Time zone ────────────────────────────────────────────────────────────

describe('time zone compatibility', () => {
  it('reports unknown when the employer states nothing', () => {
    const result = assessTimeZoneCompatibility({
      jobTimezoneRequirement: '',
      timezoneMatches: ['US hours / EST overlap'],
      timezoneToleranceHours: 4,
    });
    expect(result.outcome).toBe('UNKNOWN');
    expect(result.explanation).toContain('Confirm');
  });

  it('matches a stated requirement the user asked for', () => {
    const result = assessTimeZoneCompatibility({
      jobTimezoneRequirement: 'US hours / EST overlap',
      timezoneMatches: ['US hours / EST overlap'],
      timezoneToleranceHours: 4,
    });
    expect(result.outcome).toBe('MATCH');
  });

  it('reports partial when the requirement is not one the user listed', () => {
    const result = assessTimeZoneCompatibility({
      jobTimezoneRequirement: 'CET overlap',
      timezoneMatches: ['US hours / EST overlap'],
      timezoneToleranceHours: 4,
    });
    expect(result.outcome).toBe('PARTIAL_MATCH');
  });
});

// ─── Eligibility ───────────────────────────────────────────────────────────

describe('eligibility compatibility', () => {
  it('is not applicable when the posting states no restriction', () => {
    const result = assessEligibilityCompatibility({
      eligibilityRegion: '',
      jobRegions: [],
      workRegions: ['US'],
      preferredRegions: [],
    });
    expect(result.outcome).toBe('NOT_APPLICABLE');
  });

  it('issues no legal determination about the user', () => {
    const result = assessEligibilityCompatibility({
      eligibilityRegion: 'Germany',
      jobRegions: ['EU'],
      workRegions: ['US'],
      preferredRegions: ['US'],
    });
    // Not MISMATCH: comparing a region string to a region string is not the
    // same as knowing whether the restriction applies to this person.
    expect(result.outcome).toBe('UNKNOWN');
    expect(result.explanation.toLowerCase()).toContain('confirm');
    expect(result.explanation.toLowerCase()).not.toContain('legally');
    expect(result.requiresConfirmation).toBe(true);
  });

  it('never claims a job will sponsor a visa', () => {
    const result = assessEligibilityCompatibility({
      eligibilityRegion: 'Worldwide',
      jobRegions: ['WORLDWIDE'],
      workRegions: ['AFRICA'],
      preferredRegions: ['AFRICA'],
    });
    expect(result.explanation.toLowerCase()).not.toContain('sponsor');
    expect(result.outcome).toBe('PARTIAL_MATCH');
  });

  it('reports unknown when the user has stated no regions at all', () => {
    const result = assessEligibilityCompatibility({
      eligibilityRegion: 'US',
      jobRegions: ['US'],
      workRegions: [],
      preferredRegions: [],
    });
    expect(result.outcome).toBe('UNKNOWN');
  });
});

// ─── Compensation ──────────────────────────────────────────────────────────

describe('compensation compatibility', () => {
  const base = { currency: 'USD', preferenceCurrency: 'USD', preferenceMin: 110000, preferenceTarget: 150000 };

  it('treats a missing salary as unstated, never as zero', () => {
    const result = assessCompensation({ ...base, salaryMin: null, salaryMax: null });
    expect(result.outcome).toBe('NOT_STATED_BY_EMPLOYER');
    expect(result.explanation).toContain('not the same as it paying badly');
  });

  it('refuses to compare two currencies rather than inventing a rate', () => {
    const result = assessCompensation({ ...base, salaryMin: 90000, salaryMax: 110000, currency: 'EUR' });
    expect(result.outcome).toBe('NOT_COMPARABLE');
    expect(result.currencyMismatch).toBe(true);
    expect(result.explanation).toContain('do not convert');
  });

  it('reports a range entirely below the minimum as below preference', () => {
    const result = assessCompensation({ ...base, salaryMin: 80000, salaryMax: 100000 });
    expect(result.outcome).toBe('BELOW_PREFERENCE');
  });

  it('reports a range reaching the target as above preference', () => {
    const result = assessCompensation({ ...base, salaryMin: 150000, salaryMax: 190000 });
    expect(result.outcome).toBe('ABOVE_PREFERENCE');
  });

  it('reports a range straddling the target as partially overlapping', () => {
    const result = assessCompensation({ ...base, salaryMin: 100000, salaryMax: 160000 });
    expect(result.outcome).toBe('PARTIALLY_OVERLAPPING');
  });

  it('handles a one-sided range without inventing the missing end', () => {
    const result = assessCompensation({ ...base, salaryMin: null, salaryMax: 160000 });
    expect(result.outcome).toBe('ABOVE_PREFERENCE');
    expect(result.explanation).toContain('only one end');
  });

  it('reports nothing to compare against when the user set no preference', () => {
    const result = assessCompensation({
      ...base,
      salaryMin: 120000,
      salaryMax: 160000,
      preferenceMin: 0,
      preferenceTarget: 0,
    });
    expect(result.outcome).toBe('NOT_COMPARABLE');
  });
});

// ─── Overall category ──────────────────────────────────────────────────────

describe('overall category', () => {
  const healthy = {
    fitTier: 'B',
    blockedBy: [] as string[],
    titleRelationship: 'DIRECT_TARGET_MATCH' as const,
    seniorityOutcome: 'GOOD_MATCH',
    profileCompleteness: 'COMPLETE' as const,
    hadJobDescription: true,
    dimensions: {
      location: 'MATCH' as const,
      remoteWork: 'MATCH' as const,
      eligibility: 'PARTIAL_MATCH' as const,
    },
    proposed: 'POTENTIAL_MATCH' as const,
  };

  it('keeps the model category when it agrees with the tier', () => {
    const decision = deriveOverallCategory(healthy);
    expect(decision.category).toBe('POTENTIAL_MATCH');
    expect(decision.adjusted).toBe(false);
  });

  it('a hard scoring block cannot be overridden by a strong AI verdict', () => {
    const decision = deriveOverallCategory({
      ...healthy,
      blockedBy: ['geography or eligibility'],
      proposed: 'STRONG_MATCH',
    });
    expect(decision.category).toBe('LOW_MATCH');
    expect(decision.adjusted).toBe(true);
  });

  it('a conflicting role cannot be a strong match', () => {
    const decision = deriveOverallCategory({
      ...healthy,
      titleRelationship: 'CONFLICTING_ROLE',
      proposed: 'STRONG_MATCH',
    });
    expect(decision.category).toBe('LOW_MATCH');
  });

  it('a location mismatch caps the category', () => {
    const decision = deriveOverallCategory({
      ...healthy,
      dimensions: { ...healthy.dimensions, location: 'MISMATCH' },
      proposed: 'STRONG_MATCH',
    });
    expect(decision.category).toBe('LOW_MATCH');
  });

  it('says insufficient information when there is almost nothing to compare', () => {
    const decision = deriveOverallCategory({
      ...healthy,
      profileCompleteness: 'EMPTY',
      hadJobDescription: false,
      proposed: 'STRONG_MATCH',
    });
    expect(decision.category).toBe('INSUFFICIENT_INFORMATION');
  });

  it('never reports a well-scoring job as a low match', () => {
    // The user can see the tier next to this verdict; contradicting it would
    // make the product look broken.
    const decision = deriveOverallCategory({
      ...healthy,
      fitTier: 'A',
      proposed: 'LOW_MATCH',
    });
    expect(decision.category).not.toBe('LOW_MATCH');
  });

  it('never lets the model raise a tier-D job to a strong match', () => {
    const decision = deriveOverallCategory({ ...healthy, fitTier: 'D', proposed: 'STRONG_MATCH' });
    expect(decision.category).toBe('LOW_MATCH');
  });

  it('allows at most a one-step raise above the tier category', () => {
    const decision = deriveOverallCategory({ ...healthy, fitTier: 'B', proposed: 'STRONG_MATCH' });
    // Tier B maps to POTENTIAL_MATCH; STRONG_MATCH is one step above, which
    // the rule permits, but never two.
    expect(decision.category).toBe('STRONG_MATCH');
  });

  it('maps every tier to a defined category', () => {
    for (const tier of ['A', 'B', 'C', 'D']) {
      expect(TIER_CATEGORY[tier]).toBeDefined();
    }
  });
});

// ─── Verification helpers ──────────────────────────────────────────────────

describe('unsupportable claims', () => {
  it('detects a claim that the candidate lacks a skill', () => {
    expect(containsUnsupportableClaim('You do not have Kubernetes experience.')).toBe(true);
    expect(containsUnsupportableClaim('Your resume does not mention GraphQL.')).toBe(true);
  });

  it('detects a promise the product cannot keep', () => {
    expect(containsUnsupportableClaim('This role will get you an interview.')).toBe(true);
    expect(containsUnsupportableClaim('We will sponsor your visa.')).toBe(true);
  });

  it('detects a legal determination', () => {
    expect(containsUnsupportableClaim('You are legally eligible to work in Germany.')).toBe(true);
  });

  it('accepts the phrasing we want instead', () => {
    expect(
      containsUnsupportableClaim(
        "We couldn't find evidence of this in your current profile. That is not the same as you not having it.",
      ),
    ).toBe(false);
    expect(
      containsUnsupportableClaim('This role asks for 3+ years, which your profile supports.'),
    ).toBe(false);
  });

  it('matches evidence against the source on a normalised form', () => {
    expect(excerptAppearsIn('We are looking for a Backend Engineer', SAMPLE_JOB_TEXT)).toBe(true);
    expect(excerptAppearsIn('This phrase appears nowhere in the posting', SAMPLE_JOB_TEXT)).toBe(false);
  });

  it('refuses to treat a very short quote as evidence', () => {
    expect(excerptAppearsIn('API', SAMPLE_JOB_TEXT)).toBe(false);
  });

  it('matches a skill the profile genuinely has', () => {
    const profile = { skillNames: ['typescript', 'node.js'], experienceTitles: [] };
    expect(profileSupportsSkill(profile, 'TypeScript')).toBe(true);
    expect(profileSupportsSkill(profile, 'Kubernetes')).toBe(false);
  });

  it('does not let a two-letter skill name match everything', () => {
    const profile = { skillNames: ['go'], experienceTitles: ['golang'] };
    expect(profileSupportsSkill(profile, 'google analytics')).toBe(false);
  });
});

// ─── Job text handling ─────────────────────────────────────────────────────

describe('job text handling', () => {
  it('rejects generated clue strings as a job description', () => {
    // These are written by our own ingestion code, not by the employer.
    expect(looksLikeJobDescription(GENERATED_CLUE_NOTES)).toBe(false);
  });

  it('accepts a real posting', () => {
    expect(looksLikeJobDescription(SAMPLE_JOB_TEXT)).toBe(true);
  });
});

// ─── Deterministic inputs and fingerprint ──────────────────────────────────

describe('deterministic inputs', () => {
  const build = (jobOverrides: Record<string, unknown> = {}, prefOverrides: Record<string, unknown> = {}) =>
    computeDeterministicInputs({
      job: sampleJob(jobOverrides),
      preferences: samplePreferences(prefOverrides),
      profile: sampleProfileContext(),
    });

  it('uses the application scoring engine, not a model number', () => {
    const inputs = build();
    expect(inputs.fitScore).toBeGreaterThan(0);
    expect(inputs.fitScore).toBeLessThanOrEqual(100);
    expect(['A', 'B', 'C', 'D']).toContain(inputs.fitTier);
  });

  it('reports a hard block when a gate scores zero', () => {
    const base = sampleJob() as unknown as { score: Record<string, number> };
    const inputs = build({
      score: { ...base.score, geographyEligibility: 0 },
    });
    expect(inputs.fitScore).toBe(0);
    expect(inputs.blockedBy).toContain('geography or eligibility');
  });

  it('keeps the deterministic titleMatch boolean separate from the relationship', () => {
    const inputs = build({}, { targetRoles: ['Data Scientist'] });
    expect(inputs.titleMatch).toBe(false);
    // The relationship explains; it does not become the score.
    expect(inputs.titleRelationship.relationship).not.toBe('DIRECT_TARGET_MATCH');
  });

  it('reports no job description when the field is empty', () => {
    const inputs = build({ jobDescription: '' });
    expect(inputs.hadJobDescription).toBe(false);
    expect(inputs.dataCompleteness).toBe('PARTIAL');
  });

  it('marks a minimal posting as insufficient rather than inventing detail', () => {
    const inputs = build({ jobDescription: 'Hiring.' });
    expect(inputs.hadJobDescription).toBe(false);
  });

  it('produces a stable fingerprint for identical inputs', () => {
    expect(build().inputFingerprint).toBe(build().inputFingerprint);
  });

  it('produces a different fingerprint when the job changes', () => {
    expect(build().inputFingerprint).not.toBe(
      build({ salaryMax: 200000 }).inputFingerprint,
    );
  });

  it('produces a different fingerprint when preferences change', () => {
    expect(build().inputFingerprint).not.toBe(
      build({}, { remoteOnly: false }).inputFingerprint,
    );
  });

  it('produces a different fingerprint when the profile version changes', () => {
    const base = computeDeterministicInputs({
      job: sampleJob(),
      preferences: samplePreferences(),
      profile: sampleProfileContext(),
    });
    const bumped = computeDeterministicInputs({
      job: sampleJob(),
      preferences: samplePreferences(),
      profile: sampleProfileContext({ careerProfileVersion: 99 }),
    });
    expect(base.inputFingerprint).not.toBe(bumped.inputFingerprint);
  });

  it('does not churn the fingerprint on unrelated fields', () => {
    // A job's status changing must not invalidate an analysis that said
    // nothing about status.
    const base = computeDeterministicInputs({
      job: sampleJob(),
      preferences: samplePreferences(),
      profile: sampleProfileContext(),
    });
    const moved = computeDeterministicInputs({
      job: sampleJob({ status: 'APPLIED' }),
      preferences: samplePreferences(),
      profile: sampleProfileContext(),
    });
    expect(base.inputFingerprint).toBe(moved.inputFingerprint);
  });

  it('fails safe on a currency the product cannot compare', () => {
    const inputs = build({ currency: 'JPY', salaryMin: 9000000, salaryMax: 12000000 });
    expect(inputs.compensation.outcome).toBe('NOT_COMPARABLE');
    expect(inputs.compensation.currencyMismatch).toBe(true);
  });
});