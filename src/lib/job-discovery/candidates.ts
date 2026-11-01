/**
 * Candidate title prefilter.
 *
 * Discovery cannot load every open catalogue row for every user, and ordering
 * the whole catalogue by recency silently drops older-but-relevant roles. This
 * builder derives the phrases and tokens that describe the user's target roles
 * so the database query can fetch title-relevant listings first, with a small
 * recent fallback for roles described with unusual titles.
 *
 * The result only narrows what is fetched; fit scoring remains authoritative.
 */

export type CandidateTitleInput = {
  targetRoles?: string[];
  preferredTitles?: string[];
  preferredStack?: string[];
};

const STOPWORDS = new Set([
  'a', 'an', 'and', 'at', 'by', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'with',
  'senior', 'sr', 'junior', 'jr', 'lead', 'staff', 'principal', 'head', 'director', 'vp', 'chief',
  'mid', 'entry', 'level', 'remote', 'hybrid', 'onsite', 'trainee',
]);

function normalizeTerm(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function usableTokens(value: string) {
  return normalizeTerm(value)
    .split(' ')
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

/**
 * Returns a de-duplicated, bounded list of lower-case title terms. Role titles
 * contribute a short phrase (e.g. `software engineer`) plus their individual
 * tokens, which is what makes spelling variants such as "Front End" still
 * match a "Frontend" target.
 */
export function buildCandidateTitleTerms(input: CandidateTitleInput, limit = 24): string[] {
  const roleValues = [...(input.targetRoles ?? []), ...(input.preferredTitles ?? [])];
  const stackValues = input.preferredStack ?? [];

  const phrases: string[] = [];
  for (const value of roleValues) {
    const tokens = usableTokens(value);
    if (tokens.length >= 2 && tokens.length <= 4) {
      const phrase = tokens.join(' ');
      if (!STOPWORDS.has(phrase)) phrases.push(phrase);
    }
  }

  const tokenCounts = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  let nextIndex = 0;
  for (const value of [...roleValues, ...stackValues]) {
    for (const token of usableTokens(value)) {
      tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1);
      if (!firstSeen.has(token)) {
        firstSeen.set(token, nextIndex);
        nextIndex += 1;
      }
    }
  }

  const tokens = [...tokenCounts.entries()]
    .sort((a, b) => b[1] - a[1] || (firstSeen.get(a[0]) ?? 0) - (firstSeen.get(b[0]) ?? 0))
    .map(([token]) => token);

  return [...new Set([...phrases.slice(0, 8), ...tokens])].slice(0, Math.max(1, limit));
}
