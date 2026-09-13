import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MockFlagClient,
  StaleFlagService,
  joinAndRank,
  previewRemoval,
  scanFlagUsagesInFiles,
  readPermanentFlags,
} from '../service';
import type { FlagMetadata } from '../service';

const repo = path.join(__dirname, 'fixtures', 'repo');

const providerFlags: FlagMetadata[] = [
  {
    key: 'legacy-checkout',
    rolloutPercentage: 100,
    lastModified: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    daysAtTerminal: 60,
    historyAvailable: false,
  },
  {
    key: 'dark-mode',
    rolloutPercentage: 50,
    lastModified: new Date().toISOString(),
    historyAvailable: false,
  },
  {
    key: 'kill-switch-payments',
    rolloutPercentage: 0,
    lastModified: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
    daysAtTerminal: 90,
    historyAvailable: false,
  },
];

describe('scanFlagUsagesInFiles', () => {
  it('finds SDK-direct, wrapped, and orphaned patterns', () => {
    const byKey = scanFlagUsagesInFiles(repo, [
      'src/sdkDirect.ts',
      'src/wrapped.ts',
      'src/orphaned.ts',
    ]);
    assert.ok(byKey.has('legacy-checkout'));
    assert.ok(byKey.has('dark-mode'));
    assert.ok(byKey.has('deleted-upstream-flag'));
    assert.equal(byKey.get('legacy-checkout')![0].pattern, 'variation');
    assert.equal(byKey.get('dark-mode')![0].pattern, 'isEnabled');
  });
});

describe('joinAndRank', () => {
  it('ranks orphaned highest, terminal next, ignores permanent', () => {
    const usages = scanFlagUsagesInFiles(repo, [
      'src/sdkDirect.ts',
      'src/wrapped.ts',
      'src/orphaned.ts',
    ]);
    // Simulate kill-switch usage so permanent filter is exercised
    usages.set('kill-switch-payments', [
      { file: 'src/ks.ts', line: 1, snippet: "isEnabled('kill-switch-payments')", pattern: 'isEnabled' },
    ]);
    const permanent = readPermanentFlags(repo);
    const report = joinAndRank(providerFlags, usages, permanent, 30);

    assert.ok(report.flags.some((f) => f.key === 'deleted-upstream-flag' && f.reason === 'orphaned'));
    assert.ok(report.flags.some((f) => f.key === 'legacy-checkout' && f.reason === 'terminal'));
    assert.ok(!report.flags.some((f) => f.key === 'dark-mode')); // not terminal
    assert.ok(!report.flags.some((f) => f.key === 'kill-switch-payments')); // permanent

    // Orphaned ranks above terminal
    const orphanIdx = report.flags.findIndex((f) => f.reason === 'orphaned');
    const terminalIdx = report.flags.findIndex((f) => f.reason === 'terminal');
    assert.ok(orphanIdx >= 0 && terminalIdx >= 0 && orphanIdx < terminalIdx);
  });
});

describe('StaleFlagService with mock provider', () => {
  it('syncs mock metadata with fixture code', async () => {
    const service = new StaleFlagService(repo);
    const report = await service.sync({
      client: new MockFlagClient(providerFlags),
      minDaysAtTerminal: 30,
    });
    assert.ok(report.flags.some((f) => f.key === 'deleted-upstream-flag'));
    assert.ok(report.flags.some((f) => f.key === 'legacy-checkout'));
    const text = service.formatReport(report);
    assert.match(text, /orphaned|terminal/);
  });
});

describe('previewRemoval', () => {
  it('inlines the surviving branch without writing disk until apply', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stale-flag-'));
    const file = 'sample.ts';
    const original = `
export function f(flags: { isEnabled: (k: string) => boolean }) {
  if (flags.isEnabled('x')) {
    return 'on';
  } else {
    return 'off';
  }
}
`;
    fs.writeFileSync(path.join(dir, file), original);
    const preview = previewRemoval(
      dir,
      'x',
      [{ file, line: 3, snippet: "isEnabled('x')", pattern: 'isEnabled' }],
      true
    );
    assert.equal(preview.files.length, 1);
    assert.match(preview.files[0].modified, /return 'on'/);
    assert.doesNotMatch(preview.files[0].modified, /isEnabled\('x'\)/);
    // Original file untouched
    assert.equal(fs.readFileSync(path.join(dir, file), 'utf8'), original);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
