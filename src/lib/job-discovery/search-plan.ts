import type { UserPreferences } from '@/types';

export type SearchPlan = {
  titles: string[];
  locations: string[];
  remoteOnly: boolean;
  limit: number;
};

export const QUERY_BUDGET = {
  maxTitles: 6,
  maxLocations: 3,
  maxResultsPerConnector: 20,
};

export function buildSearchPlan(profile: { location?: string | null } | null, preferences: UserPreferences): SearchPlan {
  const titles = Array.from(new Set([...(preferences.targetRoles ?? []), ...(preferences.preferredTitles ?? [])].map((t) => t.trim()).filter(Boolean))).slice(0, QUERY_BUDGET.maxTitles);
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
