/**
 * Small shared helpers used across the application-materials layer.
 *
 * Kept out of `verify.ts` so the verification logic itself stays readable, and
 * out of `materials.ts` so nothing about verification leaks into the type
 * definitions.
 */

import { MATERIAL_MAX_EVIDENCE_CHARS, MATERIAL_MIN_EVIDENCE_CHARS } from './limits';

/**
 * Canonical comparison key. Same shape the resume and job-intelligence
 * features use: lowercase, non-alphanumeric runs collapsed to a space, trimmed.
 */
export function normaliseKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9+#.]+/g, ' ').trim();
}

/**
 * Collapse whitespace, bound length, return null for empty input.
 */
export function tidy(value: string | null | undefined, max = 240): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/**
 * Safely parse JSON, returning null on any failure. Never throws.
 */
export function parseSafeJson(value: unknown): unknown {
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Does this quote actually appear in the source text?
 *
 * Same honest rule as job intelligence: compare on a punctuation-free,
 * whitespace-collapsed form so line wrapping and bullet glyphs do not cause
 * false negatives, and never accept a three-character match as proof.
 */
export function excerptAppearsIn(excerpt: string, sourceText: string): boolean {
  const needle = normaliseKey(excerpt);
  if (needle.length < MATERIAL_MIN_EVIDENCE_CHARS) return false;
  return normaliseKey(sourceText).includes(needle);
}
