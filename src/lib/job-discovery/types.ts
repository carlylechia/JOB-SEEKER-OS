/** A provider record after normalization, before persistence. */
export type NormalizedExternalJob = {
  source: string;
  sourceJobId: string;
  title: string;
  company: string;
  location?: string | null;
  countryCodes?: string[];
  locationRestrictions?: string[];
  timezoneRestrictions?: number[];
  remoteType?: string | null;
  workArrangement?: string | null;
  employmentType?: string | null;
  seniority?: string | null;
  industry?: string | null;
  category?: string | null;
  skills?: string[];
  visaSponsorship?: string | null;
  description?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  currency?: string | null;
  salaryPeriod?: string | null;
  publishedAt?: Date | null;
  expiresAt?: Date | null;
  canonicalUrl?: string | null;
  applicationUrl?: string | null;
  employerUrl?: string | null;
  attribution?: string | null;
  attributionUrl?: string | null;
  attributionRequired?: boolean;
  allowStructuredData?: boolean;
  retentionDays?: number | null;
  contentFingerprint?: string | null;
};

export type ProviderId =
  | 'arbeitnow'
  | 'himalayas'
  | 'remoteok'
  | 'fourdayweek'
  | 'usajobs'
  | 'headcountlabs'
  | 'greenhouse'
  | 'lever'
  | 'ashby';

export type ProviderDefinition = {
  id: ProviderId;
  displayName: string;
  sourceType: 'free_aggregator' | 'ats_public_board' | 'government' | 'licensed_aggregator';
  /** Whether this provider is used once per catalog run (feed) or once per board. */
  kind: 'feed' | 'board';
  /** Static, documented source confidence in [0,1]. */
  sourceConfidence: number;
  /** Hard cap on requests made in one catalog sync. */
  maxRequestsPerRun: number;
  /** How long a successful sync stays fresh before the source is rotated in again. */
  refreshAfterMs: number;
  siteUrl: string;
};

export type ProviderFetchInput = {
  source: {
    id: string;
    provider: string;
    displayName: string;
    employerName: string | null;
    boardToken: string | null;
    careersUrl: string | null;
    descriptionMode: string;
    attribution: string | null;
    attributionUrl: string | null;
    attributionRequired: boolean;
    allowStructuredData: boolean;
    retentionDays: number | null;
  };
  /** Abort signal owned by the sync orchestrator. */
  signal: AbortSignal;
  /** Maximum number of jobs the adapter should return. */
  maxJobs: number;
};

export type ProviderFetchResult = {
  jobs: NormalizedExternalJob[];
  requests: number;
  /** The provider returned its last page and the result is a complete board. */
  complete: boolean;
  rateLimitRemaining?: number | null;
  quotaExhausted?: boolean;
  latencyMs?: number;
  notes?: string[];
};

export type CatalogSyncTrigger = 'cron' | 'manual' | 'admin';

export type CatalogSyncOptions = {
  trigger?: CatalogSyncTrigger;
  timeBudgetMs?: number;
  sourceIds?: string[];
};
