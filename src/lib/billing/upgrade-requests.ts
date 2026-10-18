/**
 * Upgrade request validation + state machine.
 *
 * The public workflow is: user requests → admin reviews → admin contacts user
 * (email/WhatsApp) → arrangement happens outside the app → admin confirms →
 * plan is activated. There is NO payment collection in this release, and the
 * copy never implies otherwise.
 */

import { z } from 'zod';
import { sanitizeText } from '@/lib/sanitize';
import { PLAN_CODES } from './plans';

/**
 * Phone normalisation for WhatsApp.
 *
 * We validate FORMAT only — we never claim the number is a registered WhatsApp
 * account. We do not assume a country code: a number without `+` is stored
 * as-entered and clearly flagged as needing an international format by the UI.
 */
export const whatsappNumberSchema = z
  .string()
  .trim()
  .min(6, 'Enter a WhatsApp number including your country code.')
  .max(24, 'That WhatsApp number is too long.')
  .transform((value) => value.replace(/[\s()\-.]/g, ''))
  .refine(
    (value) => /^\+?\d{6,20}$/.test(value),
    'Enter a valid WhatsApp number, for example +2348012345678.',
  );

export const upgradeRequestSchema = z
  .object({
    requestedPlan: z.enum(['PRO', 'PREMIUM'], {
      errorMap: () => ({ message: 'Choose a valid plan.' }),
    }),
    contactMethod: z.enum(['EMAIL', 'WHATSAPP'], {
      errorMap: () => ({ message: 'Choose how you would prefer to be contacted.' }),
    }),
    contactEmail: z
      .string()
      .trim()
      .max(254)
      .email('Enter a valid email address.')
      .optional()
      .or(z.literal('').transform(() => undefined)),
    whatsappNumber: whatsappNumberSchema.optional().or(z.literal('').transform(() => undefined)),
    message: z
      .string()
      .trim()
      .max(1500, 'Please keep your message under 1500 characters.')
      .optional()
      .default(''),
  })
  // Reject unknown fields so a client cannot smuggle `userId`, `status` or
  // `role` into the payload.
  .strict()
  .superRefine((value, ctx) => {
    if (value.contactMethod === 'EMAIL' && !value.contactEmail) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contactEmail'],
        message: 'An email address is required when you choose email contact.',
      });
    }
    if (value.contactMethod === 'WHATSAPP' && !value.whatsappNumber) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['whatsappNumber'],
        message: 'A WhatsApp number is required when you choose WhatsApp contact.',
      });
    }
  });

export type UpgradeRequestInput = z.infer<typeof upgradeRequestSchema>;

export const UPGRADE_REQUEST_STATUSES = [
  'PENDING',
  'CONTACTED',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
] as const;

export type UpgradeRequestStatus = (typeof UPGRADE_REQUEST_STATUSES)[number];

/**
 * Legal transitions. A user may withdraw their own request while it is still
 * open; admins drive every other transition.
 */
const TRANSITIONS: Record<UpgradeRequestStatus, readonly UpgradeRequestStatus[]> = {
  PENDING: ['CONTACTED', 'APPROVED', 'REJECTED', 'CANCELLED'],
  CONTACTED: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: [],
  REJECTED: [],
  CANCELLED: [],
};

export function canTransition(from: UpgradeRequestStatus, to: UpgradeRequestStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export class InvalidTransitionError extends Error {
  readonly code = 'INVALID_TRANSITION';
  readonly status = 409;
  constructor(from: string, to: string) {
    super(`This request cannot move from ${from} to ${to}.`);
    this.name = 'InvalidTransitionError';
  }
}

export function assertTransition(from: UpgradeRequestStatus, to: UpgradeRequestStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

/** Sanitize a validated payload before persistence. */
export function sanitizeUpgradeRequest(input: UpgradeRequestInput) {
  return {
    requestedPlan: input.requestedPlan as (typeof PLAN_CODES)[number],
    contactMethod: input.contactMethod,
    contactEmail: input.contactEmail ? sanitizeText(input.contactEmail, 254).toLowerCase() : null,
    whatsappNumber: input.whatsappNumber ? sanitizeText(input.whatsappNumber, 24) : null,
    message: sanitizeText(input.message ?? '', 1500),
  };
}

/** Build a safe wa.me destination from a validated number. Never user-controlled URLs. */
export function buildWhatsappUrl(whatsappNumber: string | null | undefined, message?: string): string | null {
  if (!whatsappNumber) return null;

  const normalized = whatsappNumber.replace(/[\s()\-.]/g, '');
  // Defence in depth: never build a link from anything but digits and a
  // leading '+'. Blocks `javascript:`, protocol-relative, and host injection.
  if (!/^\+?\d{6,20}$/.test(normalized)) return null;

  const target = normalized.startsWith('+') ? normalized.slice(1) : normalized;
  const base = `https://wa.me/${target}`;

  if (!message) return base;

  // Keep the prefilled text short and free of account details.
  const safe = message.replace(/[\r\n]+/g, ' ').slice(0, 300);
  return `${base}?text=${encodeURIComponent(safe)}`;
}

/** Default admin-facing WhatsApp message. Deliberately carries no account data. */
export function whatsappPrefill(name: string | null | undefined, requestedPlan: string): string {
  const display = (name ?? '').trim().slice(0, 60);
  return `Hi${display ? ` ${display}` : ''}, this is teChia Jobs regarding your ${requestedPlan} plan upgrade request.`;
}

/** Validate the `mailto:` destination before rendering it in the admin UI. */
export function buildMailtoUrl(email: string | null | undefined, subject?: string): string | null {
  if (!email) return null;
  const trimmed = email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return subject
    ? `mailto:${trimmed}?subject=${encodeURIComponent(subject)}`
    : `mailto:${trimmed}`;
}