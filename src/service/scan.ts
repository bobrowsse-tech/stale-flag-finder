import * as fs from 'fs';
import * as path from 'path';
import { Project, Node } from 'ts-morph';
import type { CallSite } from './types';

const DEFAULT_METHODS = [
  'variation',
  'boolVariation',
  'stringVariation',
  'numberVariation',
  'jsonVariation',
  'isEnabled',
  'isFeatureEnabled',
  'checkGate',
  'getFlag',
  'getFeatureFlag',
];

export interface ScanOptions {
  /** Extra method names to treat as flag checks. */
  extraMethods?: string[];
  includeGlobs?: string[];
}

function collectFromProject(
  project: Project,
  root: string,
  methodSet: Set<string>
): { byKey: Map<string, CallSite[]>; scannedFiles: number } {
  const byKey = new Map<string, CallSite[]>();
  let scannedFiles = 0;

  for (const sf of project.getSourceFiles()) {
    const filePath = sf.getFilePath();
    const rel = path.relative(root, filePath).replace(/\\/g, '/');
    if (
      rel.includes('node_modules/') ||
      rel.includes('/dist/') ||
      rel.startsWith('dist/') ||
      rel.includes('.git/')
    ) {
      continue;
    }
    scannedFiles++;

    sf.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) {
        return;
      }
      const expr = node.getExpression();
      const methodName = Node.isPropertyAccessExpression(expr)
        ? expr.getName()
        : Node.isIdentifier(expr)
          ? expr.getText()
          : undefined;
      if (!methodName || !methodSet.has(methodName)) {
        return;
      }

      const first = node.getArguments()[0];
      if (!first || (!Node.isStringLiteral(first) && !Node.isNoSubstitutionTemplateLiteral(first))) {
        return;
      }
      const key = first.getLiteralText();
      const sites = byKey.get(key) ?? [];
      sites.push({
        file: rel,
        line: node.getStartLineNumber(),
        snippet: node.getText().slice(0, 120),
        pattern: methodName,
      });
      byKey.set(key, sites);
    });
  }

  return { byKey, scannedFiles };
}

/**
 * AST-scan TypeScript/JavaScript sources for known flag-check call patterns.
 */
export function scanFlagUsages(
  root: string,
  options: ScanOptions = {}
): { byKey: Map<string, CallSite[]>; scannedFiles: number } {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: true },
  });

  const globs = options.includeGlobs ?? [
    path.join(root, '**/*.ts'),
    path.join(root, '**/*.tsx'),
    path.join(root, '**/*.js'),
    path.join(root, '**/*.jsx'),
  ];
  project.addSourceFilesAtPaths(globs);

  const methodSet = new Set([...DEFAULT_METHODS, ...(options.extraMethods ?? [])]);
  return collectFromProject(project, root, methodSet);
}

/**
 * Scan an explicit file list (useful for fixtures/tests).
 */
export function scanFlagUsagesInFiles(root: string, relativeFiles: string[]): Map<string, CallSite[]> {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: true },
  });
  for (const rel of relativeFiles) {
    const abs = path.join(root, rel);
    if (fs.existsSync(abs)) {
      project.addSourceFileAtPath(abs);
    }
  }
  return collectFromProject(project, root, new Set(DEFAULT_METHODS)).byKey;
}
