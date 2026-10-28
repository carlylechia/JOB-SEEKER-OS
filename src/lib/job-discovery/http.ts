const ALLOWED_HOSTS = new Set([
  'www.arbeitnow.com',
  'arbeitnow.com',
  'himalayas.app',
  'remoteok.com',
  'remoteok.io',
  '4dayweek.io',
  'data.usajobs.gov',
  'api.headcountlabs.com',
  'boards-api.greenhouse.io',
  'api.lever.co',
  'api.ashbyhq.com',
]);

export class ProviderHttpError extends Error {
  status: number | null;
  category: 'HTTP_ERROR' | 'RATE_LIMITED' | 'QUOTA_EXHAUSTED' | 'TIMEOUT' | 'NETWORK' | 'UNSAFE_URL' | 'INVALID_JSON';

  constructor(
    message: string,
    category: ProviderHttpError['category'],
    status: number | null = null,
  ) {
    super(message);
    this.name = 'ProviderHttpError';
    this.category = category;
    this.status = status;
  }
}

export type FetchJsonOptions = {
  provider: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  signal?: AbortSignal;
  /** Wait at most this long for a Retry-After before giving up. */
  maxRetryAfterMs?: number;
};

export type FetchJsonResult<T> = {
  data: T;
  status: number;
  headers: Headers;
  latencyMs: number;
  attempts: number;
};

const requestWindows = new Map<string, number[]>();

/** In-process politeness limit; provider adapters also cap their request count. */
export function takeRateLimitToken(key: string, limit: number, windowMs = 60_000) {
  const now = Date.now();
  const recent = (requestWindows.get(key) ?? []).filter((time) => now - time < windowMs);
  if (recent.length >= limit) {
    requestWindows.set(key, recent);
    return false;
  }
  recent.push(now);
  requestWindows.set(key, recent);
  return true;
}

function assertAllowedUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ProviderHttpError('Invalid provider URL', 'UNSAFE_URL');
  }
  if (url.protocol !== 'https:') throw new ProviderHttpError('Provider URL must use HTTPS', 'UNSAFE_URL');
  if (url.username || url.password) throw new ProviderHttpError('Provider URL must not include credentials', 'UNSAFE_URL');
  const host = url.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) {
    throw new ProviderHttpError(`Provider host is not allowed: ${host}`, 'UNSAFE_URL');
  }
  return url;
}

function retryDelayMs(attempt: number, retryAfterHeader: string | null, maxRetryAfterMs: number) {
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, maxRetryAfterMs);
    const date = Date.parse(retryAfterHeader);
    if (Number.isFinite(date)) return Math.max(0, Math.min(date - Date.now(), maxRetryAfterMs));
  }
  return Math.min(500 * 2 ** attempt, 3_000);
}

function sleep(ms: number, signal?: AbortSignal) {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        },
        { once: true },
      );
    }
  });
}

/**
 * Fetch JSON from a documented provider host only.
 *
 * The URL is never accepted from an admin or user; callers construct it from
 * a fixed base plus a validated board token. DNS is not resolved here because
 * the host allowlist is exact and all providers are public SaaS endpoints.
 */
export async function fetchProviderJson<T>(rawUrl: string, options: FetchJsonOptions): Promise<FetchJsonResult<T>> {
  const url = assertAllowedUrl(rawUrl);
  const attempts = Math.max(1, (options.retries ?? 1) + 1);
  const timeoutMs = options.timeoutMs ?? 12_000;
  const maxRetryAfterMs = options.maxRetryAfterMs ?? 5_000;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': process.env.JOB_DISCOVERY_USER_AGENT?.trim() || 'teChiaJobs/1.0 (+https://techiacareers.com)',
          ...options.headers,
        },
        cache: 'no-store',
        signal: controller.signal,
      });

      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        if (attempt < attempts - 1) {
          await sleep(retryDelayMs(attempt, retryAfter, maxRetryAfterMs), options.signal);
          continue;
        }
        const lower = (await response.text().catch(() => '')).toLowerCase();
        throw new ProviderHttpError(
          lower.includes('data_limit') || lower.includes('quota') ? 'Provider quota exhausted' : 'Provider rate limit reached',
          lower.includes('data_limit') || lower.includes('quota') ? 'QUOTA_EXHAUSTED' : 'RATE_LIMITED',
          429,
        );
      }

      if (response.status >= 500) {
        if (attempt < attempts - 1) {
          await sleep(retryDelayMs(attempt, response.headers.get('retry-after'), maxRetryAfterMs), options.signal);
          continue;
        }
        throw new ProviderHttpError(`Provider returned HTTP ${response.status}`, 'HTTP_ERROR', response.status);
      }

      if (!response.ok) {
        throw new ProviderHttpError(`Provider returned HTTP ${response.status}`, 'HTTP_ERROR', response.status);
      }

      let data: T;
      try {
        data = (await response.json()) as T;
      } catch {
        throw new ProviderHttpError('Provider returned invalid JSON', 'INVALID_JSON', response.status);
      }

      return {
        data,
        status: response.status,
        headers: response.headers,
        latencyMs: Date.now() - startedAt,
        attempts: attempt + 1,
      };
    } catch (error) {
      lastError = error;
      if (error instanceof ProviderHttpError) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') {
        if (options.signal?.aborted) throw error;
        if (attempt < attempts - 1) continue;
        throw new ProviderHttpError('Provider request timed out', 'TIMEOUT');
      }
      if (attempt < attempts - 1) {
        await sleep(retryDelayMs(attempt, null, maxRetryAfterMs), options.signal);
        continue;
      }
      throw new ProviderHttpError(
        error instanceof Error ? `Provider request failed: ${error.message}` : 'Provider request failed',
        'NETWORK',
      );
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }
  }

  throw lastError instanceof Error ? lastError : new ProviderHttpError('Provider request failed', 'NETWORK');
}

export function parseNumberHeader(headers: Headers, name: string): number | null {
  const value = headers.get(name);
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
