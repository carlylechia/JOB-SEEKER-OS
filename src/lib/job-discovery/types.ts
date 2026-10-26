export type NormalizedExternalJob = {
  source: string;
  sourceJobId: string;
  title: string;
  company: string;
  location?: string | null;
  remoteType?: string | null;
  workArrangement?: string | null;
  employmentType?: string | null;
  description?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  currency?: string | null;
  publishedAt?: Date | null;
  canonicalUrl?: string | null;
  applicationUrl?: string | null;
  employerUrl?: string | null;
  attribution?: string | null;
  contentFingerprint?: string | null;
};

export type ConnectorSearchInput = {
  titles: string[];
  locations: string[];
  remoteOnly: boolean;
  limit: number;
  country?: string;
};

export type ConnectorResult = {
  source: string;
  jobs: NormalizedExternalJob[];
  errors?: string[];
};

export type ConnectorHealth = {
  source: string;
  displayName: string;
  connectorType: string;
  configured: boolean;
  enabled: boolean;
  healthy: boolean;
  message?: string;
};

export type Connector = {
  id: string;
  displayName: string;
  connectorType: string;
  isEnabled(): boolean;
  isConfigured(): boolean;
  search(input: ConnectorSearchInput): Promise<ConnectorResult>;
  health(): Promise<ConnectorHealth>;
};
