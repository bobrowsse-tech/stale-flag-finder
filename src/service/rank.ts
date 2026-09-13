import * as fs from 'fs';
import * as path from 'path';
import type { CallSite, FlagMetadata, StaleFlag, StaleReport } from './types';
import { DEFAULT_MIN_DAYS, PERMANENT_FILENAME } from './types';

export function readPermanentFlags(root: string): Set<string> {
  const file = path.join(root, PERMANENT_FILENAME);
  if (!fs.existsSync(file)) {
    return new Set();
  }
  return new Set(
    fs
      .readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
  );
}

export function markPermanent(root: string, key: string): string {
  const file = path.join(root, PERMANENT_FILENAME);
  const existing = readPermanentFlags(root);
  if (existing.has(key)) {
    return file;
  }
  const prefix =
    fs.existsSync(file) && !fs.readFileSync(file, 'utf8').endsWith('\n') ? '\n' : '';
  fs.appendFileSync(file, `${prefix}${key}\n`, 'utf8');
  return file;
}

function isTerminal(pct: number): boolean {
  return pct <= 0 || pct >= 100;
}

/**
 * Join provider metadata with code usages and rank stale candidates.
 * Orphaned call sites (no provider match) rank highest.
 */
export function joinAndRank(
  providerFlags: FlagMetadata[],
  usages: Map<string, CallSite[]>,
  permanent: Set<string>,
  minDaysAtTerminal = DEFAULT_MIN_DAYS,
  caveats: string[] = []
): StaleReport {
  const byProvider = new Map(providerFlags.map((f) => [f.key, f]));
  const flags: StaleFlag[] = [];
  const allKeys = new Set([...byProvider.keys(), ...usages.keys()]);

  for (const key of allKeys) {
    const meta = byProvider.get(key);
    const callSites = usages.get(key) ?? [];
    const isPermanent = permanent.has(key);

    if (callSites.length && !meta) {
      flags.push({
        key,
        reason: 'orphaned',
        historyAvailable: false,
        callSites,
        permanent: isPermanent,
        rankScore: isPermanent ? -1 : 10_000 + callSites.length,
      });
      continue;
    }

    if (meta && callSites.length) {
      const terminal = isTerminal(meta.rolloutPercentage);
      const days = meta.daysAtTerminal ?? 0;
      if (terminal && days >= minDaysAtTerminal) {
        flags.push({
          key,
          reason: 'terminal',
          rolloutPercentage: meta.rolloutPercentage,
          daysAtTerminal: days,
          historyAvailable: meta.historyAvailable,
          callSites,
          permanent: isPermanent,
          rankScore: isPermanent ? -1 : 1_000 + days + callSites.length * 10,
        });
      }
      continue;
    }

    if (meta && !callSites.length) {
      flags.push({
        key,
        reason: 'unused-provider',
        rolloutPercentage: meta.rolloutPercentage,
        daysAtTerminal: meta.daysAtTerminal,
        historyAvailable: meta.historyAvailable,
        callSites: [],
        permanent: isPermanent,
        rankScore: isPermanent ? -1 : 10 + (meta.daysAtTerminal ?? 0),
      });
    }
  }

  const filtered = flags
    .filter((f) => !f.permanent && f.rankScore >= 0)
    .sort((a, b) => b.rankScore - a.rankScore || b.callSites.length - a.callSites.length);

  if (providerFlags.some((f) => !f.historyAvailable)) {
    caveats.push(
      'daysAtTerminal falls back to lastModified when provider change-history is unavailable.'
    );
  }

  return {
    syncedAt: new Date().toISOString(),
    flags: filtered,
    scannedFiles: 0,
    minDaysAtTerminal,
    caveats: [...new Set(caveats)],
  };
}
