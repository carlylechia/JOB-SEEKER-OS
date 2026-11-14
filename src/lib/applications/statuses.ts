/**
 * Application lifecycle vocabulary.
 *
 * Deliberately free of Prisma imports so a client component can render the
 * allowed transitions without pulling server-only code into the browser bundle.
 */

export const APPLICATION_STATUSES = [
  'NOT_STARTED',
  'IN_PROGRESS',
  'READY_TO_SUBMIT',
  'APPLIED',
  'INTERVIEWING',
  'OFFER',
  'REJECTED',
  'WITHDRAWN',
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const ATTEMPT_STATUSES = ['ATTEMPTED', 'CONFIRMED', 'FAILED'] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

export const ATTEMPT_CHANNELS = [
  'MANUAL',
  'WEB_FORM',
  'EMAIL',
  'EXTENSION',
  'REFERRAL',
  'OTHER',
] as const;
export type AttemptChannel = (typeof ATTEMPT_CHANNELS)[number];

export const EVIDENCE_KINDS = [
  'CONFIRMATION_PAGE',
  'EMAIL',
  'SCREENSHOT',
  'ATS_WEBHOOK',
  'REFERRAL_CONFIRMATION',
] as const;

export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const EVENT_ACTORS = ['USER', 'SYSTEM', 'IMPORT', 'EXTENSION'] as const;
export type EventActor = (typeof EVENT_ACTORS)[number];

/**
 * Allowed manual transitions.
 *
 * APPLIED is deliberately absent: it is only reachable through a CONFIRMED
 * attempt carrying evidence. `recordAttempt` is the sole path.
 */
export const APPLICATION_TRANSITIONS: Record<
  ApplicationStatus,
  readonly ApplicationStatus[]
> = {
  NOT_STARTED: ['IN_PROGRESS', 'READY_TO_SUBMIT', 'WITHDRAWN'],
  IN_PROGRESS: ['READY_TO_SUBMIT', 'WITHDRAWN'],
  READY_TO_SUBMIT: ['IN_PROGRESS', 'WITHDRAWN'],
  APPLIED: ['INTERVIEWING', 'OFFER', 'REJECTED', 'WITHDRAWN'],
  INTERVIEWING: ['OFFER', 'REJECTED', 'WITHDRAWN', 'APPLIED'],
  OFFER: ['WITHDRAWN', 'APPLIED', 'REJECTED'],
  REJECTED: [],
  WITHDRAWN: [],
};

export function isApplicationStatus(value: unknown): value is ApplicationStatus {
  return typeof value === 'string' && (APPLICATION_STATUSES as readonly string[]).includes(value);
}

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  READY_TO_SUBMIT: 'Ready to submit',
  APPLIED: 'Applied',
  INTERVIEWING: 'Interviewing',
  OFFER: 'Offer',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn',
};

export const ATTEMPT_LABELS: Record<AttemptStatus, string> = {
  ATTEMPTED: 'Attempted',
  CONFIRMED: 'Confirmed submission',
  FAILED: 'Attempt failed',
};

export const EVIDENCE_LABELS: Record<EvidenceKind, string> = {
  CONFIRMATION_PAGE: 'Confirmation page',
  EMAIL: 'Email confirmation',
  SCREENSHOT: 'Screenshot',
  ATS_WEBHOOK: 'ATS webhook',
  REFERRAL_CONFIRMATION: 'Referral confirmation',
};
