import { MATERIAL_MAX_TITLE_CHARS } from './limits';
import { MATERIAL_TYPE_META, type MaterialType } from './materials';

/**
 * A stable, human-readable timestamp for a generated title.
 *
 * UTC is deliberate: the same row must render with the same title on every
 * server, regardless of the machine's local timezone. The explicit `UTC` label
 * keeps that honest rather than implying the time is local.
 */
export function formatMaterialTitleDate(date: Date): string {
  const formatted = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'UTC',
  }).format(date);
  return `${formatted} UTC`;
}

function shorten(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

/**
 * Build the display title shown in the library and the application kit.
 *
 * The date is kept even when the company or role is long: a title that ends in
 * a truncated company name is harder to scan than one that ends in a readable
 * timestamp. The overall value is bounded to the same ceiling the API enforces.
 */
export function buildApplicationMaterialTitle(params: {
  type: string;
  company: string | null;
  role: string | null;
  createdAt: Date;
}): string {
  const typeLabel =
    MATERIAL_TYPE_META[params.type as MaterialType]?.label ?? 'Application material';
  const company = params.company?.trim() || 'General';
  const role = params.role?.trim() || 'Unspecified role';
  const suffix = formatMaterialTitleDate(params.createdAt);

  const prefixBudget = Math.max(24, MATERIAL_MAX_TITLE_CHARS - suffix.length - 3);
  const prefix = shorten([typeLabel, company, role].join(' — '), prefixBudget);

  return `${prefix} — ${suffix}`.slice(0, MATERIAL_MAX_TITLE_CHARS);
}
