/**
 * Salary text parsing for free job feeds.
 *
 * Feeds publish compensation as prose ("$120k–$150k", "€60,000 - €80,000 a
 * year", "$50/hour"). The product stores numeric annualised bounds, so this
 * parser extracts what the posting actually says and leaves unknown values as
 * null instead of inventing a range.
 */

export type ParsedSalary = {
  min: number | null;
  max: number | null;
  currency: string;
  period: 'annual' | 'monthly' | 'weekly' | 'daily' | 'hourly' | 'unknown';
};

const CURRENCY_SYMBOLS: Record<string, string> = {
  $: 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '₦': 'NGN',
  '₹': 'INR',
  '¥': 'JPY',
  'R$': 'BRL',
  'C$': 'CAD',
  'A$': 'AUD',
};

const CURRENCY_CODES = new Set(['USD', 'EUR', 'GBP', 'NGN', 'INR', 'JPY', 'CAD', 'AUD', 'BRL', 'CHF', 'SEK', 'PLN']);

function detectCurrency(text: string): string {
  const code = text.toUpperCase().match(/\b(USD|EUR|GBP|NGN|INR|JPY|CAD|AUD|BRL|CHF|SEK|PLN)\b/)?.[1];
  if (code) return code;
  for (const [symbol, currency] of Object.entries(CURRENCY_SYMBOLS)) {
    if (text.includes(symbol)) return currency;
  }
  return 'USD';
}

function detectPeriod(text: string): ParsedSalary['period'] {
  const lower = text.toLowerCase();
  if (/\b(hour|hourly|\/hr|per hr)\b/.test(lower)) return 'hourly';
  if (/\b(day|daily|\/day|per day)\b/.test(lower)) return 'daily';
  if (/\b(week|weekly|\/wk|per week)\b/.test(lower)) return 'weekly';
  if (/\b(month|monthly|\/mo|per month)\b/.test(lower)) return 'monthly';
  if (/\b(year|annual|annually|per year|per annum|p\.a\.)\b/.test(lower)) return 'annual';
  return 'unknown';
}

function parseAmount(raw: string, multiplierFromText: string) {
  const cleaned = raw.replace(/[,\s]/g, '');
  const numeric = Number(cleaned);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  if (/k/i.test(multiplierFromText)) return Math.round(numeric * 1_000);
  // A bare "120" almost always means 120k in a salary range; a bare "500" is
  // more likely a day rate. Only expand values below 1,000 when the text also
  // contains a "k" marker on either side of the range.
  return Math.round(numeric);
}

export function parseSalaryText(value: string | null | undefined): ParsedSalary {
  const text = value?.trim();
  if (!text) return { min: null, max: null, currency: 'USD', period: 'unknown' };

  const currency = detectCurrency(text);
  const period = detectPeriod(text);

  // Prefer a range, then a single amount. The amount pattern deliberately
  // accepts both 120,000 and 120k and keeps the suffix for the multiplier.
  const range = text.match(
    /(?:[$€£₦₹¥]|(?:USD|EUR|GBP|NGN|INR|CAD|AUD|BRL|CHF)\s?)?\s*(\d{1,3}(?:[,.]\d{3})+|\d+(?:\.\d+)?)\s*([kK])?\s*(?:-|–|—|to)\s*(?:[$€£₦₹¥]|(?:USD|EUR|GBP|NGN|INR|CAD|AUD|BRL|CHF)\s?)?\s*(\d{1,3}(?:[,.]\d{3})+|\d+(?:\.\d+)?)\s*([kK])?/i,
  );

  if (range) {
    const hasK = Boolean(range[2] || range[4]);
    const min = parseAmount(range[1], hasK ? 'k' : '');
    const max = parseAmount(range[3], hasK ? 'k' : '');
    return {
      min: min != null ? (hasK && min < 1_000 ? min * 1_000 : min) : null,
      max: max != null ? (hasK && max < 1_000 ? max * 1_000 : max) : null,
      currency,
      period,
    };
  }

  const single = text.match(
    /(?:[$€£₦₹¥]|(?:USD|EUR|GBP|NGN|INR|CAD|AUD|BRL|CHF)\s?)?\s*(\d{1,3}(?:[,.]\d{3})+|\d+(?:\.\d+)?)\s*([kK])?/i,
  );
  if (!single) return { min: null, max: null, currency, period };

  const hasK = Boolean(single[2]);
  const amount = parseAmount(single[1], hasK ? 'k' : '');
  const normalized = amount != null && hasK && amount < 1_000 ? amount * 1_000 : amount;
  return { min: normalized, max: normalized, currency, period };
}

/**
 * Convert a parsed amount to an annual figure for filtering and comparison.
 * Unknown periods are treated as annual because that is what the majority of
 * feeds publish when they omit a period.
 */
export function annualiseSalary(amount: number | null, period: ParsedSalary['period']): number | null {
  if (amount == null) return null;
  switch (period) {
    case 'hourly':
      return Math.round(amount * 2_080);
    case 'daily':
      return Math.round(amount * 260);
    case 'weekly':
      return Math.round(amount * 52);
    case 'monthly':
      return Math.round(amount * 12);
    case 'annual':
    case 'unknown':
    default:
      return amount;
  }
}
