import * as vscode from 'vscode';
import { DashboardProvider } from './dashboardProvider';
import { registerFindStaleFlagsTool } from './lmTool';

export function activate(context: vscode.ExtensionContext) {
  const dashboard = new DashboardProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("stale-flag-finderView", dashboard)
  );

  context.subscriptions.push(vscode.commands.registerCommand("staleFlags.configureProvider", () => {
    // TODO (Configure Provider): Prompts for the flag provider (LaunchDarkly/Unleash/Split) and stores the API token in vscode.SecretStorage — never in a workspace file.
    vscode.window.showInformationMessage("Configure Provider \u2014 not yet implemented, see DIRECTIVE.md");
  }));

  context.subscriptions.push(vscode.commands.registerCommand("staleFlags.sync", () => {
    // TODO (Sync Flags): Pulls current flag metadata from the provider API and merges it with the last local AST scan.
    vscode.window.showInformationMessage("Sync Flags \u2014 not yet implemented, see DIRECTIVE.md");
  }));

  context.subscriptions.push(vscode.commands.registerCommand("staleFlags.viewList", () => {
    // TODO (View Stale List): Shows flags ranked by days-at-terminal-rollout, each with its call-site count and a jump-to-first-usage link.
    vscode.window.showInformationMessage("View Stale List \u2014 not yet implemented, see DIRECTIVE.md");
  }));

  context.subscriptions.push(vscode.commands.registerCommand("staleFlags.generateRemovalPr", () => {
    // TODO (Generate Removal PR): Runs a codemod that inlines the surviving branch and removes the flag check for a selected flag, opening the diff for review before any file is written.
    vscode.window.showInformationMessage("Generate Removal PR \u2014 not yet implemented, see DIRECTIVE.md");
  }));

  // Exposes the same capability to Copilot Chat / Claude Code / any MCP-aware
  // agent via the Language Model Tool API — see contributes.languageModelTools
  // in package.json and DIRECTIVE.md, section "Language Model Tool".
  registerFindStaleFlagsTool(context);
}

export function deactivate() {}
