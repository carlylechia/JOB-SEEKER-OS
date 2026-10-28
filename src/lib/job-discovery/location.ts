import type { WorkRegion } from '@/types';

const COUNTRY_NAMES: Record<string, string> = {
  argentina: 'AR',
  australia: 'AU',
  austria: 'AT',
  belgium: 'BE',
  brazil: 'BR',
  bulgaria: 'BG',
  canada: 'CA',
  chile: 'CL',
  china: 'CN',
  colombia: 'CO',
  croatia: 'HR',
  cyprus: 'CY',
  czechia: 'CZ',
  'czech republic': 'CZ',
  denmark: 'DK',
  egypt: 'EG',
  estonia: 'EE',
  finland: 'FI',
  france: 'FR',
  germany: 'DE',
  ghana: 'GH',
  greece: 'GR',
  'hong kong': 'HK',
  hungary: 'HU',
  iceland: 'IS',
  india: 'IN',
  indonesia: 'ID',
  ireland: 'IE',
  israel: 'IL',
  italy: 'IT',
  japan: 'JP',
  kenya: 'KE',
  latvia: 'LV',
  lithuania: 'LT',
  luxembourg: 'LU',
  malaysia: 'MY',
  mexico: 'MX',
  morocco: 'MA',
  netherlands: 'NL',
  'new zealand': 'NZ',
  nigeria: 'NG',
  norway: 'NO',
  pakistan: 'PK',
  peru: 'PE',
  philippines: 'PH',
  poland: 'PL',
  portugal: 'PT',
  romania: 'RO',
  'saudi arabia': 'SA',
  serbia: 'RS',
  singapore: 'SG',
  slovakia: 'SK',
  slovenia: 'SI',
  'south africa': 'ZA',
  'south korea': 'KR',
  spain: 'ES',
  sweden: 'SE',
  switzerland: 'CH',
  taiwan: 'TW',
  thailand: 'TH',
  turkey: 'TR',
  'türkiye': 'TR',
  ukraine: 'UA',
  'united arab emirates': 'AE',
  'united kingdom': 'GB',
  'united states': 'US',
  'united states of america': 'US',
  uruguay: 'UY',
  vietnam: 'VN',
};

const COUNTRY_CODES = new Set(Object.values(COUNTRY_NAMES));

const CITY_HINTS: Record<string, string> = {
  amsterdam: 'NL',
  athens: 'GR',
  austin: 'US',
  bangalore: 'IN',
  bengaluru: 'IN',
  berlin: 'DE',
  boston: 'US',
  brussels: 'BE',
  chicago: 'US',
  copenhagen: 'DK',
  dublin: 'IE',
  dubai: 'AE',
  edinburgh: 'GB',
  hamburg: 'DE',
  helsinki: 'FI',
  lisbon: 'PT',
  london: 'GB',
  madrid: 'ES',
  melbourne: 'AU',
  milan: 'IT',
  montreal: 'CA',
  munich: 'DE',
  nairobi: 'KE',
  'new york': 'US',
  paris: 'FR',
  prague: 'CZ',
  rome: 'IT',
  'san francisco': 'US',
  seattle: 'US',
  seoul: 'KR',
  singapore: 'SG',
  stockholm: 'SE',
  sydney: 'AU',
  tel: 'IL',
  tokyo: 'JP',
  toronto: 'CA',
  vancouver: 'CA',
  vienna: 'AT',
  warsaw: 'PL',
  zurich: 'CH',
};

const US_STATES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS',
  'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY',
  'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV',
  'WI', 'WY', 'DC',
]);

const CA_PROVINCES = new Set(['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT']);

const WORLDWIDE = new Set(['worldwide', 'anywhere', 'global', 'international', 'remote']);

export function normalizeCountryCode(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (COUNTRY_NAMES[lower]) return COUNTRY_NAMES[lower];
  const upper = raw.toUpperCase();
  if (COUNTRY_CODES.has(upper)) return upper;
  return null;
}

export function isWorldwideLocation(value: string | null | undefined) {
  if (!value) return false;
  return WORLDWIDE.has(value.trim().toLowerCase());
}

/**
 * Best-effort ISO country inference. Returning an empty array means "unknown",
 * which callers must treat differently from "not eligible".
 */
export function inferCountryCodes(...values: Array<string | null | undefined>): string[] {
  const text = values.filter(Boolean).join(' · ');
  if (!text.trim()) return [];
  if (isWorldwideLocation(text)) return [];

  const found = new Set<string>();
  const lower = text.toLowerCase();

  for (const [name, code] of Object.entries(COUNTRY_NAMES)) {
    if (new RegExp(`(^|[^a-z])${escapeRegExp(name)}([^a-z]|$)`, 'i').test(lower)) found.add(code);
  }
  for (const [city, code] of Object.entries(CITY_HINTS)) {
    if (new RegExp(`(^|[^a-z])${escapeRegExp(city)}([^a-z]|$)`, 'i').test(lower)) found.add(code);
  }

  // Two-letter country codes are only trusted when they stand alone as a token
  // (e.g. "Remote (US)"), never when they are part of a city name.
  const codeMatches = text.match(/(?:^|[\s(,/|])([A-Z]{2})(?=$|[\s),/|])/g) ?? [];
  for (const match of codeMatches) {
    const code = match.replace(/[^A-Z]/g, '');
    if (COUNTRY_CODES.has(code)) found.add(code);
  }

  // State/province abbreviations disambiguate US/CA locations such as
  // "New York, NY" and "Toronto, ON".
  const regionMatches = text.match(/,\s*([A-Z]{2})\b/g) ?? [];
  for (const match of regionMatches) {
    const code = match.replace(/[^A-Z]/g, '');
    if (US_STATES.has(code)) found.add('US');
    if (CA_PROVINCES.has(code) && !found.has('US')) found.add('CA');
  }

  return [...found];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export type EmploymentType = 'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'INTERNSHIP' | 'TEMPORARY' | 'VOLUNTEER';

export function normalizeEmploymentType(value: string | null | undefined): EmploymentType | null {
  if (!value) return null;
  const text = value.toLowerCase();
  if (/\bintern(ship)?\b|\bco-?op\b/.test(text)) return 'INTERNSHIP';
  if (/\bpart[\s-]?time\b/.test(text)) return 'PART_TIME';
  if (/\b(full[\s-]?time|regular|permanent)\b/.test(text)) return 'FULL_TIME';
  if (/\b(contract(or)?|freelance|fixed[\s-]?term)\b/.test(text)) return 'CONTRACT';
  if (/\b(temporary|temp|seasonal)\b/.test(text)) return 'TEMPORARY';
  if (/\bvolunteer\b/.test(text)) return 'VOLUNTEER';
  return null;
}

export function employmentTypeMatches(jobValue: string | null | undefined, selected: string[]) {
  if (selected.length === 0) return true;
  const normalized = normalizeEmploymentType(jobValue);
  if (!normalized) return true; // unknown is never treated as ineligible
  return selected.includes(normalized);
}

export type WorkArrangement = 'Remote' | 'Hybrid' | 'Onsite';

export function normalizeWorkArrangement(
  value: string | null | undefined,
  remoteFlag?: boolean | null,
): WorkArrangement | null {
  if (remoteFlag === true) return 'Remote';
  if (!value) return remoteFlag === false ? 'Onsite' : null;
  const text = value.toLowerCase();
  if (/\bremote|distributed|work from home|wfh\b/.test(text)) return 'Remote';
  if (/\bhybrid\b/.test(text)) return 'Hybrid';
  if (/\bon-?site|in person|in-person\b/.test(text)) return 'Onsite';
  return null;
}

export function inferVisaSponsorship(description: string | null | undefined): 'YES' | 'NO' | 'UNKNOWN' {
  if (!description) return 'UNKNOWN';
  const text = description.toLowerCase();
  if (
    /\b(no|not|unable|cannot|can't|won't|will not|do not|does not)\b[^.]{0,80}\b(visa|sponsor(ship)?|relocat)/.test(text) ||
    /\b(without|excluding)\s+(visa\s+)?sponsorship\b/.test(text)
  ) {
    return 'NO';
  }
  if (/\b(visa|sponsorship)\b[^.]{0,60}\b(available|provided|offered|supported)\b/.test(text) ||
      /\b(we|company)\s+(will\s+)?sponsor\b/.test(text)) {
    return 'YES';
  }
  return 'UNKNOWN';
}

export function regionForCountry(code: string): WorkRegion | null {
  if (code === 'US' || code === 'CA' || code === 'MX') return 'US';
  if (['GB', 'IE', 'DE', 'FR', 'ES', 'PT', 'IT', 'NL', 'BE', 'LU', 'AT', 'CH', 'SE', 'NO', 'DK', 'FI', 'IS', 'PL', 'CZ', 'SK', 'HU', 'RO', 'BG', 'GR', 'HR', 'SI', 'EE', 'LV', 'LT', 'CY'].includes(code)) return 'EU';
  if (['NG', 'KE', 'GH', 'ZA', 'EG', 'MA'].includes(code)) return 'AFRICA';
  return null;
}

/** Normalize provider-provided country labels into ISO alpha-2 codes. */
export function normalizeCountryList(values: string[] | null | undefined): string[] {
  if (!values || values.length === 0) return [];
  const codes = new Set<string>();
  for (const value of values) {
    if (isWorldwideLocation(value)) continue;
    const code = normalizeCountryCode(value);
    if (code) codes.add(code);
    else for (const inferred of inferCountryCodes(value)) codes.add(inferred);
  }
  return [...codes];
}
