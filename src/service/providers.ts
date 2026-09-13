import type { FlagMetadata, FlagProviderClient, ProviderConfig } from './types';

type FetchFn = typeof fetch;

function daysBetween(fromIso: string, to = new Date()): number {
  const from = new Date(fromIso).getTime();
  if (Number.isNaN(from)) {
    return 0;
  }
  return Math.max(0, Math.floor((to.getTime() - from) / (24 * 60 * 60 * 1000)));
}

function isTerminal(pct: number): boolean {
  return pct <= 0 || pct >= 100;
}

/**
 * LaunchDarkly Admin REST API (not the evaluation SDK).
 * Docs: GET /api/v2/flags/{projectKey}
 */
export class LaunchDarklyClient implements FlagProviderClient {
  constructor(
    private readonly token: string,
    private readonly config: ProviderConfig,
    private readonly fetchImpl: FetchFn = fetch
  ) {}

  async listFlags(): Promise<FlagMetadata[]> {
    const project = this.config.projectOrUrl;
    const env = this.config.environment || 'production';
    const url = `https://app.launchdarkly.com/api/v2/flags/${encodeURIComponent(project)}?env=${encodeURIComponent(env)}&limit=100`;
    const res = await this.fetchImpl(url, {
      headers: {
        Authorization: this.token,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) {
      throw new Error(`LaunchDarkly API ${res.status}: ${await res.text()}`);
    }
    const body = (await res.json()) as {
      items?: Array<{
        key: string;
        lastModified?: number;
        environments?: Record<
          string,
          {
            on?: boolean;
            fallthrough?: { rollout?: { variations?: Array<{ weight: number }> } };
            summary?: { variations?: Record<string, { rollout?: number }> };
          }
        >;
      }>;
    };

    return (body.items ?? []).map((item) => {
      const envState = item.environments?.[env];
      const pct = estimateLdRollout(envState);
      const lastModified = item.lastModified
        ? new Date(item.lastModified).toISOString()
        : new Date().toISOString();
      return {
        key: item.key,
        rolloutPercentage: pct,
        lastModified,
        daysAtTerminal: isTerminal(pct) ? daysBetween(lastModified) : undefined,
        historyAvailable: false,
      };
    });
  }
}

function estimateLdRollout(envState: unknown): number {
  if (!envState || typeof envState !== 'object') {
    return 0;
  }
  const e = envState as {
    on?: boolean;
    fallthrough?: { rollout?: { variations?: Array<{ weight: number }> } };
  };
  if (e.on === false) {
    return 0;
  }
  const weights = e.fallthrough?.rollout?.variations;
  if (weights?.length) {
    // LD weights are in thousands (100000 = 100%).
    const first = weights[0]?.weight ?? 0;
    return Math.round(first / 1000);
  }
  return e.on ? 100 : 0;
}

/**
 * Unleash Admin REST API.
 * GET {url}/api/admin/projects/{project}/features or /api/admin/features
 */
export class UnleashClient implements FlagProviderClient {
  constructor(
    private readonly token: string,
    private readonly config: ProviderConfig,
    private readonly fetchImpl: FetchFn = fetch
  ) {}

  async listFlags(): Promise<FlagMetadata[]> {
    const base = this.config.projectOrUrl.replace(/\/$/, '');
    const project = this.config.environment;
    const url = project
      ? `${base}/api/admin/projects/${encodeURIComponent(project)}/features`
      : `${base}/api/admin/features`;
    const res = await this.fetchImpl(url, {
      headers: {
        Authorization: this.token,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) {
      throw new Error(`Unleash API ${res.status}: ${await res.text()}`);
    }
    const body = (await res.json()) as {
      features?: Array<{
        name: string;
        lastSeenAt?: string;
        createdAt?: string;
        environments?: Array<{ name: string; enabled: boolean; yes?: number; no?: number }>;
      }>;
    };

    return (body.features ?? []).map((f) => {
      const envs = f.environments ?? [];
      // Most conservative: lowest "enabled as 100 else 0" across envs; if gradual rollout fields exist use them.
      let pct = 100;
      if (!envs.length) {
        pct = 0;
      } else {
        pct = Math.min(
          ...envs.map((e) => {
            if (typeof e.yes === 'number' && typeof e.no === 'number' && e.yes + e.no > 0) {
              return Math.round((e.yes / (e.yes + e.no)) * 100);
            }
            return e.enabled ? 100 : 0;
          })
        );
      }
      const lastModified = f.lastSeenAt || f.createdAt || new Date().toISOString();
      return {
        key: f.name,
        rolloutPercentage: pct,
        lastModified,
        daysAtTerminal: isTerminal(pct) ? daysBetween(lastModified) : undefined,
        historyAvailable: false,
      };
    });
  }
}

/** In-memory provider for tests and offline demos. */
export class MockFlagClient implements FlagProviderClient {
  constructor(private readonly flags: FlagMetadata[]) {}

  async listFlags(): Promise<FlagMetadata[]> {
    return this.flags;
  }
}

export function createProviderClient(
  kind: ProviderConfig['kind'],
  token: string,
  config: ProviderConfig,
  fetchImpl: FetchFn = fetch,
  mockFlags?: FlagMetadata[]
): FlagProviderClient {
  switch (kind) {
    case 'launchdarkly':
      return new LaunchDarklyClient(token, config, fetchImpl);
    case 'unleash':
      return new UnleashClient(token, config, fetchImpl);
    case 'mock':
      return new MockFlagClient(mockFlags ?? []);
    case 'split':
      throw new Error('Split.io provider is planned for a later release — use LaunchDarkly or Unleash.');
    default:
      throw new Error(`Unknown provider: ${String(kind)}`);
  }
}
