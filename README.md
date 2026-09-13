# Stale Flag Finder

Finds feature flags that are fully rolled out, orphaned in code, or otherwise safe to remove — then previews a removal diff before you apply it.

## Install

```bash
git clone https://github.com/bobrowsse-tech/stale-flag-finder.git
cd stale-flag-finder
npm install
npm run package
npx @vscode/vsce package --no-dependencies
code --install-extension stale-flag-finder-0.1.0.vsix
```

Or press **F5** after `npm install`.

## Use

| Action | What it does |
|---|---|
| **Configure Provider** | LaunchDarkly or Unleash (API token → SecretStorage) |
| **Sync Flags** | Joins provider metadata with a ts-morph usage scan |
| **Preview / Apply Removal** | Diff-before-apply rewrite of the surviving branch |
| **Mark Permanent** | Adds to `.stale-flags-permanent` so it stays ignored |

Agents can call `find_stale_flags` (report-only). Removals require an explicit dashboard click.

## How it’s built

TypeScript + esbuild + `ts-morph`; provider clients use REST + `fetch` (tokens never in settings files).

```bash
npm run watch
npm run test:unit
npm run package
```

## License

MIT

## Contributing

Changes to `main` must go through a pull request. See [CONTRIBUTING.md](./CONTRIBUTING.md).
