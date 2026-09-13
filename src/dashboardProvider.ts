import * as vscode from 'vscode';
import type { StaleReport } from './service';

const BUTTONS: { label: string; command: string }[] = [
  { label: 'Configure Provider', command: 'staleFlags.configureProvider' },
  { label: 'Sync Flags', command: 'staleFlags.sync' },
  { label: 'View Stale List', command: 'staleFlags.viewList' },
  { label: 'Generate Removal PR', command: 'staleFlags.generateRemovalPr' },
];

export class DashboardProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private summary = 'Configure a provider, then Sync Flags.';
  private report?: StaleReport;
  private selectHandler?: (key: string) => void;

  constructor(private readonly extensionUri: vscode.Uri) {}

  onSelectFlag(handler: (key: string) => void) {
    this.selectHandler = handler;
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtml();
    webviewView.webview.onDidReceiveMessage((message) => {
      if (message.type === 'runCommand') {
        void vscode.commands.executeCommand(message.command, message.payload);
      } else if (message.type === 'select') {
        this.selectHandler?.(message.key);
      } else if (message.type === 'jump') {
        void vscode.commands.executeCommand('staleFlags.jumpToUsage', { key: message.key });
      } else if (message.type === 'remove') {
        void vscode.commands.executeCommand('staleFlags.generateRemovalPr', { key: message.key });
      }
    });
    if (this.report) {
      this.showReport(this.report);
    }
  }

  setSummary(text: string) {
    this.summary = text;
    this.post({ type: 'summary', text });
  }

  showReport(report: StaleReport) {
    this.report = report;
    this.post({
      type: 'report',
      report: {
        syncedAt: report.syncedAt,
        caveats: report.caveats,
        flags: report.flags.map((f) => ({
          key: f.key,
          reason: f.reason,
          daysAtTerminal: f.daysAtTerminal,
          rolloutPercentage: f.rolloutPercentage,
          callSiteCount: f.callSites.length,
          firstUsage: f.callSites[0]
            ? `${f.callSites[0].file}:${f.callSites[0].line}`
            : undefined,
        })),
      },
    });
  }

  private post(message: unknown) {
    void this.view?.webview.postMessage(message);
  }

  private getHtml(): string {
    const buttonsHtml = BUTTONS.map(
      (b) => `<button data-command="${b.command}">${b.label}</button>`
    ).join('\n');
    const nonce = String(Date.now());
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 8px; font-size: var(--vscode-font-size); }
    button {
      display: block; width: 100%; margin-bottom: 6px; padding: 6px 10px;
      background: var(--vscode-button-background); color: var(--vscode-button-foreground);
      border: none; border-radius: 4px; cursor: pointer; text-align: left;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary {
      display: inline-block; width: auto; margin: 0 4px 0 0; padding: 2px 8px; font-size: 0.75em;
      background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);
    }
    #summary { margin: 8px 0 12px; font-size: 0.85em; color: var(--vscode-descriptionForeground); }
    .flag { border-bottom: 1px solid var(--vscode-widget-border, transparent); padding: 6px 0; }
    .flag.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
    .reason { text-transform: uppercase; font-size: 0.7em; color: var(--vscode-descriptionForeground); }
    .reason.orphaned { color: var(--vscode-testing-iconFailed); }
    .reason.terminal { color: var(--vscode-editorWarning-foreground); }
    .meta { font-size: 0.8em; color: var(--vscode-descriptionForeground); }
    .hint { font-size: 0.75em; color: var(--vscode-descriptionForeground); margin-top: 8px; }
  </style>
</head>
<body>
  <div id="summary">${escapeHtml(this.summary)}</div>
  ${buttonsHtml}
  <div id="list"></div>
  <p class="hint">API tokens live in SecretStorage only. Removal always shows a diff before applying. LM tool is report-only.</p>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const listEl = document.getElementById('list');
    const summaryEl = document.getElementById('summary');
    document.querySelectorAll('button[data-command]').forEach((btn) => {
      btn.addEventListener('click', () => vscode.postMessage({ type: 'runCommand', command: btn.dataset.command }));
    });
    function esc(s) {
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'summary') summaryEl.textContent = msg.text;
      if (msg.type === 'report') {
        listEl.innerHTML = '';
        for (const f of msg.report.flags) {
          const div = document.createElement('div');
          div.className = 'flag';
          div.innerHTML =
            '<div><span class="reason ' + esc(f.reason) + '">' + esc(f.reason) + '</span> <strong>' + esc(f.key) + '</strong></div>' +
            '<div class="meta">' +
              (f.daysAtTerminal != null ? f.daysAtTerminal + 'd at terminal · ' : '') +
              (f.rolloutPercentage != null ? f.rolloutPercentage + '% · ' : '') +
              f.callSiteCount + ' call site(s)' +
              (f.firstUsage ? ' · ' + esc(f.firstUsage) : '') +
            '</div>';
          const actions = document.createElement('div');
          if (f.firstUsage) {
            const jump = document.createElement('button');
            jump.className = 'secondary';
            jump.textContent = 'Jump';
            jump.addEventListener('click', (e) => { e.stopPropagation(); vscode.postMessage({ type: 'jump', key: f.key }); });
            actions.appendChild(jump);
          }
          if (f.callSiteCount > 0) {
            const rem = document.createElement('button');
            rem.className = 'secondary';
            rem.textContent = 'Remove…';
            rem.addEventListener('click', (e) => { e.stopPropagation(); vscode.postMessage({ type: 'remove', key: f.key }); });
            actions.appendChild(rem);
          }
          div.appendChild(actions);
          div.addEventListener('click', () => {
            listEl.querySelectorAll('.flag').forEach((x) => x.classList.remove('selected'));
            div.classList.add('selected');
            vscode.postMessage({ type: 'select', key: f.key });
          });
          listEl.appendChild(div);
        }
        if (msg.report.caveats?.length) {
          const c = document.createElement('p');
          c.className = 'hint';
          c.textContent = msg.report.caveats.join(' ');
          listEl.appendChild(c);
        }
      }
    });
  </script>
</body>
</html>`;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
