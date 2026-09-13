import * as fs from 'fs';
import * as path from 'path';
import { Project, Node, SyntaxKind } from 'ts-morph';
import type { CallSite, RemovalPreview } from './types';

/**
 * Produce an in-memory removal preview for a flag.
 * Never writes files — caller must apply explicitly after review.
 *
 * Strategy: for if (flagCheck('key')) { A } else { B }, keep A when
 * keepTruthyBranch is true (100% rollout), else keep B (0% rollout).
 * Standalone expression statements / returns become the boolean literal.
 */
export function previewRemoval(
  root: string,
  flagKey: string,
  callSites: CallSite[],
  keepTruthyBranch: boolean
): RemovalPreview {
  const byFile = new Map<string, CallSite[]>();
  for (const site of callSites) {
    const list = byFile.get(site.file) ?? [];
    list.push(site);
    byFile.set(site.file, list);
  }

  const files: RemovalPreview['files'] = [];

  for (const [rel, sites] of byFile) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) {
      continue;
    }
    const original = fs.readFileSync(abs, 'utf8');
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile(rel, original);

    // Process from bottom to top so offsets stay valid.
    const calls = sf
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .filter((node) => {
        const args = node.getArguments();
        if (!args.length) {
          return false;
        }
        const first = args[0];
        if (!Node.isStringLiteral(first) && !Node.isNoSubstitutionTemplateLiteral(first)) {
          return false;
        }
        return first.getLiteralText() === flagKey;
      })
      .sort((a, b) => b.getStart() - a.getStart());

    for (const call of calls) {
      const ifStmt = call.getFirstAncestorByKind(SyntaxKind.IfStatement);
      if (ifStmt && mentionsCall(ifStmt.getExpression(), call)) {
        const thenStmt = ifStmt.getThenStatement();
        const elseStmt = ifStmt.getElseStatement();
        const keep = keepTruthyBranch ? thenStmt : elseStmt;
        if (keep) {
          const text = unwrapBlock(keep.getText());
          ifStmt.replaceWithText(text);
        } else {
          ifStmt.remove();
        }
        continue;
      }
      // Conditional expression: flagCheck('x') ? A : B
      const cond = call.getFirstAncestorByKind(SyntaxKind.ConditionalExpression);
      if (cond && mentionsCall(cond.getCondition(), call)) {
        const keep = keepTruthyBranch ? cond.getWhenTrue() : cond.getWhenFalse();
        cond.replaceWithText(keep.getText());
        continue;
      }
      // Bare call → boolean literal of terminal state
      call.replaceWithText(keepTruthyBranch ? 'true' : 'false');
    }

    const modified = sf.getFullText();
    files.push({
      file: rel,
      original,
      modified,
      unifiedDiff: makeUnifiedDiff(rel, original, modified),
    });
    void sites;
  }

  return { flagKey, keepTruthyBranch, files };
}

function mentionsCall(node: Node, call: Node): boolean {
  if (node === call) {
    return true;
  }
  return node.getDescendants().some((d) => d === call);
}

function unwrapBlock(text: string): string {
  const t = text.trim();
  if (t.startsWith('{') && t.endsWith('}')) {
    return t.slice(1, -1).trim();
  }
  return t;
}

export function makeUnifiedDiff(file: string, original: string, modified: string): string {
  if (original === modified) {
    return `--- a/${file}\n+++ b/${file}\n@@ no changes @@\n`;
  }
  const a = original.split(/\r?\n/);
  const b = modified.split(/\r?\n/);
  const lines = [`--- a/${file}`, `+++ b/${file}`, `@@ -1,${a.length} +1,${b.length} @@`];
  // Simple full-file diff (good enough for review preview).
  for (const line of a) {
    lines.push(`-${line}`);
  }
  for (const line of b) {
    lines.push(`+${line}`);
  }
  return lines.join('\n');
}

/**
 * Apply a previously reviewed preview to disk.
 */
export function applyRemovalPreview(root: string, preview: RemovalPreview): string[] {
  const written: string[] = [];
  for (const f of preview.files) {
    const abs = path.join(root, f.file);
    fs.writeFileSync(abs, f.modified, 'utf8');
    written.push(f.file);
  }
  return written;
}
