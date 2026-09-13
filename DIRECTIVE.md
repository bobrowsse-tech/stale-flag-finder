
# Build Directive — Stale Feature-Flag Finder

> Rank **#4** in the Unbuilt VS Code Tools roadmap. This directive is written for an AI coding agent (Claude Code, Copilot agent mode, or a human following along) to execute directly. The `stale-flag-finder/` folder next to this file already contains a working scaffold — activation, side-panel dashboard, command registration, and a Language Model Tool stub — generated per the shared conventions in `../AGENTS.md`. Everything marked `TODO` below is the real remaining work.

## 1. Objective

Pull flag metadata (rollout percentage, last-changed date) from the team's flag provider API, AST-scan the codebase for flag-check call sites, join the two on flag key, and rank flags by how long they've sat at a terminal rollout state (100%/0%) with dead code still branching on them.

## 2. Why this doesn't already exist

LaunchDarkly, Unleash, and Split all show flag status in their own dashboard; none of them cross-reference that against where the flag is actually checked in your code, so cleanup stays a manual, easily-forgotten chore.

## 3. VS Code surfaces this extension uses

- **Activity bar view container**: `stale-flag-finderContainer` (icon: `flag`)
- **Side panel dashboard**: `stale-flag-finderView`, a `WebviewViewProvider` — see `src/dashboardProvider.ts`
- **Commands**: `staleFlags.configureProvider`, `staleFlags.sync`, `staleFlags.viewList`, `staleFlags.generateRemovalPr`
- **Language Model Tool**: `find_stale_flags` — see `src/lmTool.ts` and `contributes.languageModelTools` in `package.json`. This is what lets Copilot Chat, Claude Code, or any other MCP/agent-aware surface invoke this extension's core action conversationally instead of the user hunting for the right command.

## 4. Dashboard (side panel) spec

The sidebar webview is the primary UI. It must show, at minimum, the buttons below plus a status/summary area above them (current scan state, last-run timestamp, or a short result summary — specifics depend on the feature, see phase notes).

| Button | Command | Behavior |
|---|---|---|
| **Configure Provider** | `staleFlags.configureProvider` | Prompts for the flag provider (LaunchDarkly/Unleash/Split) and stores the API token in vscode.SecretStorage — never in a workspace file. |
| **Sync Flags** | `staleFlags.sync` | Pulls current flag metadata from the provider API and merges it with the last local AST scan. |
| **View Stale List** | `staleFlags.viewList` | Shows flags ranked by days-at-terminal-rollout, each with its call-site count and a jump-to-first-usage link. |
| **Generate Removal PR** | `staleFlags.generateRemovalPr` | Runs a codemod that inlines the surviving branch and removes the flag check for a selected flag, opening the diff for review before any file is written. |

Buttons call `vscode.commands.executeCommand`, not the tool logic directly — keep exactly one implementation of the core logic (a plain TypeScript service module with no VS Code imports) called from three places: the command handler, the dashboard's message handler, and the Language Model Tool's `invoke`. Do not fork the logic across these three entry points.

## 5. Implementation phases

1. **Provider integration** — Support LaunchDarkly and Unleash first (`launchdarkly-node-server-sdk`'s server-side SDK reads project/environment flag configs; Unleash exposes a REST admin API for the same). Store the API token exclusively in `context.secrets`, scoped per-provider, and let the user pick the provider once via a QuickPick.
2. **Flag metadata sync** — For each flag: fetch `key`, `currentRolloutPercentage` (or per-environment variation weights), and `lastModified`. Compute `daysAtTerminal` as the time since the flag last sat at a non-0/100 value, using the provider's change-history endpoint where available; fall back to `lastModified` alone with a caveat in the UI when history isn't available.
3. **Code usage scan** — Use `ts-morph` to load the whole workspace as a TS project, find all call expressions matching known SDK check patterns (`client.variation('<key>', ...)`, `flags.isEnabled('<key>')`, a configurable extra pattern list for homegrown wrappers), and record file/line per flag key.
4. **Join & rank** — Join provider metadata to code usage on flag key. Flags with call sites but no provider match (already deleted upstream) are the highest-priority finding — genuinely dead code. Flags at 100%/0% for > the configurable threshold with live call sites rank next, sorted by call-site count descending.
5. **Removal codemod** — For a selected flag, use `jscodeshift` to rewrite each call site: replace `if (flags.isEnabled('x')) { A } else { B }` with just `A` or `B` per the terminal state, then remove the now-dead branch entirely. Always produce the diff into a scratch branch or as an in-editor preview — never write directly without an explicit apply step.
6. **Dashboard wiring** — WebviewView list, one row per stale flag: name, days-at-terminal, call-site count, 'Generate Removal PR' action; a top-level 'Sync Flags' button and last-synced timestamp.
7. **Language Model Tool** — Register `find_stale_flags` so an agent doing a tech-debt pass can ask 'what flags are safe to remove' and get a ranked, evidence-backed answer.
8. **Tests** — Mock provider responses fixture + a fixture repo with three flag-check patterns (SDK-direct, wrapped, and already-orphaned) to validate the join and ranking logic.

## 6. Suggested dependencies

`ts-morph`, `launchdarkly-node-server-sdk`, `unleash-client`, `jscodeshift`, `simple-git`

Install as regular `dependencies` (already stubbed into `package.json` — replace the `"latest"` version pins with the actual resolved versions once installed, per the pinning convention in `AGENTS.md`).

## 7. Edge cases & safety notes

- A flag used for a kill-switch (intentionally staying at a fixed rollout forever) is a false positive — let the user mark a flag as 'permanent' to exclude it from future reports.
- Per-environment rollout differences (100% in prod, 50% in staging) should report the most conservative (least-terminal) state, not the prod-only view.
- The removal codemod must never run automatically from the LM tool — the tool only reports; generating the PR stays a manual, reviewed action.

## 8. Definition of done

- [ ] Core logic lives in a VS Code-free service module, unit-tested against fixtures (see phase notes above for what fixtures to build).
- [ ] All buttons in the dashboard spec are wired to real behavior, not the placeholder `showInformationMessage` stub.
- [ ] The Language Model Tool calls the same service module and returns a concise, agent-readable text result (not raw JSON dumped as text).
- [ ] No destructive or external-write action (file rewrite, PR post, process kill) runs without an explicit user-initiated click — the LM tool path in particular must stay read/report-only unless the directive above says otherwise.
- [ ] `npm run package` produces a `dist/extension.js` with no bundling warnings; `vsce package` produces a `.vsix` that installs cleanly via `code --install-extension`.
- [ ] README.md (user-facing, not this directive) documents what the extension does in plain language, per `AGENTS.md`'s copy conventions.
    