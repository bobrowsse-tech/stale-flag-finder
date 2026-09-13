export type FlagProviderKind = 'launchdarkly' | 'unleash' | 'split' | 'mock';

export interface ProviderConfig {
  kind: FlagProviderKind;
  /** LaunchDarkly project key, Unleash API URL, etc. */
  projectOrUrl: string;
  /** LaunchDarkly environment key / Unleash project. */
  environment?: string;
}

export interface FlagMetadata {
  key: string;
  /** Most conservative rollout across environments (0–100). */
  rolloutPercentage: number;
  lastModified: string;
  /** Days at 0% or 100%; undefined if unknown (history unavailable). */
  daysAtTerminal?: number;
  historyAvailable: boolean;
  archived?: boolean;
}

export interface CallSite {
  file: string;
  line: number;
  snippet: string;
  pattern: string;
}

export type StaleReason =
  | 'orphaned' // call sites but no provider flag
  | 'terminal' // at 0/100 for long enough with call sites
  | 'unused-provider'; // in provider but no call sites (informational)

export interface StaleFlag {
  key: string;
  reason: StaleReason;
  rolloutPercentage?: number;
  daysAtTerminal?: number;
  historyAvailable: boolean;
  callSites: CallSite[];
  permanent: boolean;
  rankScore: number;
}

export interface StaleReport {
  syncedAt: string;
  provider?: ProviderConfig;
  flags: StaleFlag[];
  scannedFiles: number;
  minDaysAtTerminal: number;
  caveats: string[];
}

export interface RemovalPreview {
  flagKey: string;
  keepTruthyBranch: boolean;
  files: Array<{
    file: string;
    original: string;
    modified: string;
    unifiedDiff: string;
  }>;
}

export interface FlagProviderClient {
  listFlags(): Promise<FlagMetadata[]>;
}

export const PERMANENT_FILENAME = '.stale-flags-permanent';
export const DEFAULT_MIN_DAYS = 30;
