import type { UserPreferences } from '@/types';

export type SearchPlan = {
  titles: string[];
  locations: string[];
  remoteOnly: boolean;
  limit: number;
};

export const QUERY_BUDGET = {
  maxTitles: 4,
  maxLocations: 3,
  maxResultsPerConnector: 20,
};

export function buildSearchPlan(
  profile: { location?: string | null; headline?: string | null } | null,
  preferences: UserPreferences,
): SearchPlan {
  const selectedTitles = [...(preferences.targetRoles ?? []), ...(preferences.preferredTitles ?? [])];
  const fallbackTitles = selectedTitles.length > 0
    ? []
    : [profile?.headline, preferences.preferredStack.slice(0, 3).join(' ')].filter(Boolean) as string[];
  const titles = Array.from(
    new Set([...selectedTitles, ...fallbackTitles].map((title) => title.trim()).filter(Boolean)),
  ).slice(0, QUERY_BUDGET.maxTitles);
  const locations = Array.from(new Set([
    profile?.location?.trim(),
    ...(preferences.preferredRegions ?? []),
  ].filter(Boolean) as string[])).slice(0, QUERY_BUDGET.maxLocations);

  return {
    titles,
    locations,
    remoteOnly: Boolean(preferences.remoteOnly),
    limit: QUERY_BUDGET.maxResultsPerConnector,
  };
}
