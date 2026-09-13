export type {
  CallSite,
  FlagMetadata,
  FlagProviderKind,
  ProviderConfig,
  RemovalPreview,
  StaleFlag,
  StaleReason,
  StaleReport,
} from './types';
export { DEFAULT_MIN_DAYS, PERMANENT_FILENAME } from './types';

export { createProviderClient, MockFlagClient, LaunchDarklyClient, UnleashClient } from './providers';
export { scanFlagUsages, scanFlagUsagesInFiles } from './scan';
export { joinAndRank, markPermanent, readPermanentFlags } from './rank';
export { applyRemovalPreview, previewRemoval, makeUnifiedDiff } from './codemod';

import { createProviderClient } from './providers';
import { scanFlagUsages } from './scan';
import { joinAndRank, markPermanent, readPermanentFlags } from './rank';
import { applyRemovalPreview, previewRemoval } from './codemod';
import type {
  FlagMetadata,
  FlagProviderClient,
  ProviderConfig,
  RemovalPreview,
  StaleFlag,
  StaleReport,
} from './types';
import { DEFAULT_MIN_DAYS } from './types';

export interface SyncOptions {
  minDaysAtTerminal?: number;
  client?: FlagProviderClient;
  token?: string;
  provider?: ProviderConfig;
  fetchImpl?: typeof fetch;
  mockFlags?: FlagMetadata[];
}

/**
 * VS Code–free facade. Token handling / SecretStorage stays in the extension host.
 * Codemod apply is exposed but LM tool must not call it.
 */
export class StaleFlagService {
  constructor(private readonly root: string) {}

  async sync(options: SyncOptions = {}): Promise<StaleReport> {
    const minDays = options.minDaysAtTerminal ?? DEFAULT_MIN_DAYS;
    const caveats: string[] = [];

    let flags: FlagMetadata[] = [];
    if (options.client) {
      flags = await options.client.listFlags();
    } else if (options.provider && options.token) {
      const client = createProviderClient(
        options.provider.kind,
        options.token,
        options.provider,
        options.fetchImpl ?? fetch,
        options.mockFlags
      );
      flags = await client.listFlags();
    } else if (options.mockFlags) {
      flags = options.mockFlags;
    } else {
      caveats.push('No provider configured — reporting orphaned code usages only.');
    }

    const { byKey, scannedFiles } = scanFlagUsages(this.root);
    const permanent = readPermanentFlags(this.root);
    const report = joinAndRank(flags, byKey, permanent, minDays, caveats);
    report.scannedFiles = scannedFiles;
    report.provider = options.provider;
    return report;
  }

  previewRemoval(flag: StaleFlag): RemovalPreview {
    const keepTruthy = (flag.rolloutPercentage ?? 100) >= 100;
    return previewRemoval(this.root, flag.key, flag.callSites, keepTruthy);
  }

  applyRemoval(preview: RemovalPreview): string[] {
    return applyRemovalPreview(this.root, preview);
  }

  markPermanent(key: string): string {
    return markPermanent(this.root, key);
  }

  formatReport(report: StaleReport): string {
    const lines = [
      `Stale flags synced at ${report.syncedAt}`,
      `Scanned ${report.scannedFiles} file(s); threshold ${report.minDaysAtTerminal} days at terminal rollout`,
      `Findings: ${report.flags.length}`,
      '',
    ];
    if (!report.flags.length) {
      lines.push('No stale flag candidates.');
    }
    for (const f of report.flags) {
      const days =
        f.daysAtTerminal !== undefined ? `${f.daysAtTerminal}d at terminal` : 'days unknown';
      const rollout =
        f.rolloutPercentage !== undefined ? `${f.rolloutPercentage}%` : 'n/a';
      lines.push(
        `[${f.reason}] ${f.key} — rollout ${rollout}, ${days}, ${f.callSites.length} call site(s)`
      );
      if (f.callSites[0]) {
        lines.push(`  first: ${f.callSites[0].file}:${f.callSites[0].line}`);
      }
    }
    if (report.caveats.length) {
      lines.push('', 'Caveats:', ...report.caveats.map((c) => `- ${c}`));
    }
    return lines.join('\n');
  }
}
