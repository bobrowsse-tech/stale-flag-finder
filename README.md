# Stale Feature-Flag Finder

Finds feature flags that are safe to remove by joining your flag provider’s rollout data with real call sites in the repo.

1. **Configure Provider** — LaunchDarkly or Unleash; API token goes in VS Code SecretStorage only.
2. **Sync Flags** — pulls metadata and AST-scans the workspace for `variation` / `isEnabled`-style checks.
3. **View Stale List** — ranked list (orphaned code first, then long-terminal rollouts).
4. **Generate Removal PR** — shows a diff preview; writes files only after you confirm (or mark a kill-switch permanent via `.stale-flags-permanent`).

Agents can call `find_stale_flags` for a report-only ranking — never an automatic rewrite.

## Development

```bash
npm install
npm run watch
npm run test:unit
```

Press `F5` in VS Code to launch an Extension Development Host.

## License

MIT
