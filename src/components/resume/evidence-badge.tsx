/**
 * Evidence vocabulary shared by the review interface.
 *
 * The wording is deliberately plain. "Supported by this resume", "Needs a look"
 * and "Suggested by us" describe what we actually know, and none of them claim
 * a level of certainty the model cannot back up.
 */

import type { EvidenceLevel } from '@/lib/resume/schema';

export const EVIDENCE_LABELS: Record<EvidenceLevel, string> = {
  SUPPORTED: 'Supported by resume',
  NEEDS_REVIEW: 'Needs a look',
  SUGGESTED: 'Suggested, not confirmed',
};

export type EvidenceBadgeProps = {
  level: EvidenceLevel;
};