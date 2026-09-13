import * as vscode from 'vscode';
import { DashboardProvider } from './dashboardProvider';
import { registerFindStaleFlagsTool } from './lmTool';
import {
  StaleFlagService,
  type ProviderConfig,
  type StaleFlag,
  type StaleReport,
} from './service';

const PROVIDER_CONFIG_KEY = 'staleFlags.providerConfig';
const LAST_REPORT_KEY = 'staleFlags.lastReport';
const SELECTED_KEY = 'staleFlags.selectedFlag';
const SECRET_PREFIX = 'staleFlags.token.';

function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function createService(): StaleFlagService | undefined {
  const root = workspaceRoot();
  if (!root) {
    vscode.window.showErrorMessage('Stale Flag Finder needs an open workspace folder.');
    return undefined;
  }
  return new StaleFlagService(root);
}

export function activate(context: vscode.ExtensionContext) {
  const dashboard = new DashboardProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('stale-flag-finderView', dashboard)
  );

  const getConfig = () => context.globalState.get<ProviderConfig>(PROVIDER_CONFIG_KEY);
  const setReport = (report: StaleReport) => {
    void context.workspaceState.update(LAST_REPORT_KEY, report);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('staleFlags.configureProvider', async () => {
      const picked = await vscode.window.showQuickPick(
        [
          { label: 'LaunchDarkly', providerKind: 'launchdarkly' as const },
          { label: 'Unleash', providerKind: 'unleash' as const },
          {
            label: 'Split (coming soon)',
            providerKind: 'split' as const,
            description: 'Not yet supported',
          },
        ],
        { title: 'Select flag provider' }
      );
      if (!picked || picked.providerKind === 'split') {
        if (picked?.providerKind === 'split') {
          vscode.window.showWarningMessage('Split.io support is planned for a later release.');
        }
        return;
      }

      const projectOrUrl = await vscode.window.showInputBox({
        title:
          picked.providerKind === 'launchdarkly'
            ? 'LaunchDarkly project key'
            : 'Unleash API base URL (e.g. https://unleash.example.com)',
        value: getConfig()?.projectOrUrl,
        ignoreFocusOut: true,
      });
      if (!projectOrUrl) {
        return;
      }

      const environment = await vscode.window.showInputBox({
        title:
          picked.providerKind === 'launchdarkly'
            ? 'LaunchDarkly environment key (e.g. production)'
            : 'Unleash project id (optional)',
        value: getConfig()?.environment ?? (picked.providerKind === 'launchdarkly' ? 'production' : ''),
        ignoreFocusOut: true,
      });

      const token = await vscode.window.showInputBox({
        title: 'API token (stored in SecretStorage — never in workspace files)',
        password: true,
        ignoreFocusOut: true,
      });
      if (!token) {
        return;
      }

      const config: ProviderConfig = {
        kind: picked.providerKind,
        projectOrUrl,
        environment: environment || undefined,
      };
      await context.globalState.update(PROVIDER_CONFIG_KEY, config);
      await context.secrets.store(SECRET_PREFIX + picked.providerKind, token);
      dashboard.setSummary(`Configured ${picked.label}. Token saved in SecretStorage.`);
      vscode.window.showInformationMessage(`Provider configured: ${picked.label}`);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('staleFlags.sync', async (opts?: { minDaysAtTerminal?: number }) => {
      const service = createService();
      if (!service) {
        return undefined;
      }
      const config = getConfig();
      dashboard.setSummary('Syncing flags…');
      try {
        let token: string | undefined;
        if (config) {
          token = await context.secrets.get(SECRET_PREFIX + config.kind);
          if (!token) {
            vscode.window.showWarningMessage('No API token found — run Configure Provider first.');
            dashboard.setSummary('Missing API token.');
            return undefined;
          }
        }
        const report = await service.sync({
          provider: config,
          token,
          minDaysAtTerminal: opts?.minDaysAtTerminal,
        });
        setReport(report);
        dashboard.showReport(report);
        dashboard.setSummary(
          `${report.flags.length} candidate(s) · synced ${new Date(report.syncedAt).toLocaleString()}`
        );
        return report;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        dashboard.setSummary(`Sync failed: ${msg}`);
        vscode.window.showErrorMessage(`Flag sync failed: ${msg}`);
        return undefined;
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('staleFlags.viewList', async () => {
      let report = context.workspaceState.get<StaleReport>(LAST_REPORT_KEY);
      if (!report) {
        report = await vscode.commands.executeCommand<StaleReport | undefined>('staleFlags.sync');
      }
      if (!report) {
        return;
      }
      dashboard.showReport(report);
      await vscode.commands.executeCommand('stale-flag-finderView.focus');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('staleFlags.generateRemovalPr', async (payload?: { key?: string }) => {
      const service = createService();
      const report = context.workspaceState.get<StaleReport>(LAST_REPORT_KEY);
      if (!service || !report) {
        vscode.window.showWarningMessage('Sync flags first.');
        return;
      }

      let flag: StaleFlag | undefined = report.flags.find(
        (f) => f.key === (payload?.key ?? context.workspaceState.get<string>(SELECTED_KEY))
      );
      if (!flag) {
        const pick = await vscode.window.showQuickPick(
          report.flags
            .filter((f) => f.callSites.length > 0)
            .map((f) => ({
              label: f.key,
              description: f.reason,
              detail: `${f.callSites.length} call site(s)`,
              flag: f,
            })),
          { title: 'Generate removal preview — select flag' }
        );
        if (!pick) {
          return;
        }
        flag = pick.flag;
      }

      if (!flag.callSites.length) {
        vscode.window.showInformationMessage('No call sites to rewrite for that flag.');
        return;
      }

      const preview = service.previewRemoval(flag);
      if (!preview.files.length) {
        vscode.window.showWarningMessage('Codemod produced no file changes.');
        return;
      }

      // Show diff preview in an untitled document — never write until Apply.
      const diffDoc = await vscode.workspace.openTextDocument({
        content: preview.files.map((f) => f.unifiedDiff).join('\n\n'),
        language: 'diff',
      });
      await vscode.window.showTextDocument(diffDoc, { preview: false });

      const choice = await vscode.window.showWarningMessage(
        `Apply removal of "${flag.key}" to ${preview.files.length} file(s)? Review the diff first.`,
        { modal: true },
        'Apply Changes',
        'Mark Permanent Instead'
      );
      if (choice === 'Mark Permanent Instead') {
        const file = service.markPermanent(flag.key);
        vscode.window.showInformationMessage(`Marked permanent in ${file}`);
        await vscode.commands.executeCommand('staleFlags.sync');
        return;
      }
      if (choice !== 'Apply Changes') {
        return;
      }

      const written = service.applyRemoval(preview);
      vscode.window.showInformationMessage(
        `Updated ${written.length} file(s). Create a branch/PR from source control when ready.`
      );
      await vscode.commands.executeCommand('staleFlags.sync');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('staleFlags.jumpToUsage', async (payload?: { key?: string }) => {
      const report = context.workspaceState.get<StaleReport>(LAST_REPORT_KEY);
      const key = payload?.key ?? context.workspaceState.get<string>(SELECTED_KEY);
      const flag = report?.flags.find((f) => f.key === key);
      const site = flag?.callSites[0];
      const root = workspaceRoot();
      if (!site || !root) {
        return;
      }
      const uri = vscode.Uri.file(`${root}/${site.file}`);
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc);
      const pos = new vscode.Position(Math.max(0, site.line - 1), 0);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos));
    })
  );

  dashboard.onSelectFlag((key) => {
    void context.workspaceState.update(SELECTED_KEY, key);
  });

  registerFindStaleFlagsTool(context, () => createService(), async (minDays) => {
    const config = getConfig();
    const token = config ? await context.secrets.get(SECRET_PREFIX + config.kind) : undefined;
    return { provider: config, token, minDaysAtTerminal: minDays };
  }, setReport, dashboard);
}

export function deactivate() {}
