import type { ProviderDefinition, ProviderFetchInput, ProviderFetchResult, ProviderId } from '../../types';
import { fetchArbeitnow } from './arbeitnow';
import { fetchAshby } from './ashby';
import { fetchFourDayWeek } from './fourdayweek';
import { fetchGreenhouse } from './greenhouse';
import { fetchHeadcountLabs, isHeadcountLabsConfigured } from './headcountlabs';
import { fetchHimalayas } from './himalayas';
import { fetchLever } from './lever';
import { fetchRemoteOk } from './remoteok';
import { fetchUsaJobs, isUsaJobsConfigured } from './usajobs';

export const PROVIDER_DEFINITIONS: Record<ProviderId, ProviderDefinition> = {
  arbeitnow: {
    id: 'arbeitnow',
    displayName: 'Arbeitnow',
    sourceType: 'free_aggregator',
    kind: 'feed',
    sourceConfidence: 0.7,
    maxRequestsPerRun: 2,
    refreshAfterMs: 20 * 60 * 60 * 1000,
    siteUrl: 'https://www.arbeitnow.com',
  },
  himalayas: {
    id: 'himalayas',
    displayName: 'Himalayas',
    sourceType: 'free_aggregator',
    kind: 'feed',
    sourceConfidence: 0.8,
    maxRequestsPerRun: 5,
    refreshAfterMs: 20 * 60 * 60 * 1000,
    siteUrl: 'https://himalayas.app',
  },
  remoteok: {
    id: 'remoteok',
    displayName: 'Remote OK',
    sourceType: 'free_aggregator',
    kind: 'feed',
    sourceConfidence: 0.7,
    maxRequestsPerRun: 1,
    refreshAfterMs: 20 * 60 * 60 * 1000,
    siteUrl: 'https://remoteok.com',
  },
  fourdayweek: {
    id: 'fourdayweek',
    displayName: '4 Day Week',
    sourceType: 'free_aggregator',
    kind: 'feed',
    sourceConfidence: 0.6,
    maxRequestsPerRun: 6,
    refreshAfterMs: 20 * 60 * 60 * 1000,
    siteUrl: 'https://4dayweek.io',
  },
  usajobs: {
    id: 'usajobs',
    displayName: 'USAJOBS',
    sourceType: 'government',
    kind: 'feed',
    sourceConfidence: 0.95,
    maxRequestsPerRun: 2,
    refreshAfterMs: 20 * 60 * 60 * 1000,
    siteUrl: 'https://www.usajobs.gov',
  },
  headcountlabs: {
    id: 'headcountlabs',
    displayName: 'Headcount Labs',
    sourceType: 'licensed_aggregator',
    kind: 'feed',
    sourceConfidence: 0.85,
    maxRequestsPerRun: 1,
    refreshAfterMs: 20 * 60 * 60 * 1000,
    siteUrl: 'https://headcountlabs.com',
  },
  greenhouse: {
    id: 'greenhouse',
    displayName: 'Greenhouse',
    sourceType: 'ats_public_board',
    kind: 'board',
    sourceConfidence: 0.95,
    maxRequestsPerRun: 1,
    refreshAfterMs: 40 * 60 * 60 * 1000,
    siteUrl: 'https://boards.greenhouse.io',
  },
  lever: {
    id: 'lever',
    displayName: 'Lever',
    sourceType: 'ats_public_board',
    kind: 'board',
    sourceConfidence: 0.95,
    maxRequestsPerRun: 1,
    refreshAfterMs: 40 * 60 * 60 * 1000,
    siteUrl: 'https://www.lever.co',
  },
  ashby: {
    id: 'ashby',
    displayName: 'Ashby',
    sourceType: 'ats_public_board',
    kind: 'board',
    sourceConfidence: 0.95,
    maxRequestsPerRun: 1,
    refreshAfterMs: 40 * 60 * 60 * 1000,
    siteUrl: 'https://www.ashbyhq.com',
  },
};

export function isProviderConfigured(provider: string, boardToken: string | null) {
  if (provider === 'usajobs') return isUsaJobsConfigured();
  if (provider === 'headcountlabs') return isHeadcountLabsConfigured();
  if (provider === 'greenhouse' || provider === 'lever' || provider === 'ashby') return Boolean(boardToken);
  return true;
}

export function isProviderEnabledByEnv(provider: string) {
  const key = `${provider.toUpperCase()}_ENABLED`;
  return process.env[key] !== 'false';
}

export async function runProviderFetch(
  provider: string,
  input: ProviderFetchInput,
): Promise<ProviderFetchResult> {
  switch (provider) {
    case 'arbeitnow':
      return fetchArbeitnow(input);
    case 'himalayas':
      return fetchHimalayas(input);
    case 'remoteok':
      return fetchRemoteOk(input);
    case 'fourdayweek':
      return fetchFourDayWeek(input);
    case 'usajobs':
      return fetchUsaJobs(input);
    case 'headcountlabs':
      return fetchHeadcountLabs(input);
    case 'greenhouse':
      return fetchGreenhouse(input);
    case 'lever':
      return fetchLever(input);
    case 'ashby':
      return fetchAshby(input);
    default:
      throw new Error(`Unknown catalog provider: ${provider}`);
  }
}

export { isUsaJobsConfigured, isHeadcountLabsConfigured };
