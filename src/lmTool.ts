import * as vscode from 'vscode';
import type { StaleFlagService, StaleReport, SyncOptions } from './service';
import type { DashboardProvider } from './dashboardProvider';

interface ToolInput {
  minDaysAtTerminal?: number;
}

/**
 * Report-only LM tool — never runs the removal codemod.
 */
export function registerFindStaleFlagsTool(
  context: vscode.ExtensionContext,
  getService: () => StaleFlagService | undefined,
  getSyncOptions: (minDays?: number) => Promise<SyncOptions>,
  setReport: (report: StaleReport) => void,
  dashboard: DashboardProvider
) {
  context.subscriptions.push(
    vscode.lm.registerTool('find_stale_flags', {
      async invoke(
        options: vscode.LanguageModelToolInvocationOptions<ToolInput>,
        _token: vscode.CancellationToken
      ) {
        const service = getService();
        if (!service) {
          return textResult('No workspace folder is open.');
        }
        const minDays = options.input?.minDaysAtTerminal;
        const syncOpts = await getSyncOptions(minDays);
        try {
          const report = await service.sync(syncOpts);
          setReport(report);
          dashboard.showReport(report);
          dashboard.setSummary(`${report.flags.length} stale candidate(s)`);
          return textResult(service.formatReport(report));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return textResult(`Flag sync failed: ${msg}`);
        }
      },
    })
  );
}

function textResult(text: string): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
}
