import { readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

/** A symbol document extracted from a source file. */
export interface SymbolDoc {
  /** Stable identity: "<relPath>" or "<relPath>::<symbolName>". */
  key: string;
  /** The text to embed: a path header plus the declaration source. */
  text: string;
}

/** A named top-level declaration and its source node. */
interface NamedDecl {
  name: string;
  node: ts.Node;
}

/**
 * List TypeScript files under a directory, recursively.
 *
 * @param root - The directory to walk.
 * @returns Relative file paths (forward slashes), skipping node_modules, dist, and dot-directories.
 */
export function listTypeScriptFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (
        entry.name === "node_modules" ||
        entry.name === "dist" ||
        entry.name.startsWith(".")
      ) {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".ts")) {
        out.push(path.relative(root, full).split(path.sep).join("/"));
      }
    }
  };
  walk(root);
  return out;
}

/**
 * Extract top-level symbol documents from a TypeScript source file.
 *
 * @param relPath - The file path to embed in each document (e.g. "src/parser.ts").
 * @param source - The file's source text.
 * @returns One document per named top-level declaration, or a single whole-file document when none exist.
 */
export function extractSymbols(relPath: string, source: string): SymbolDoc[] {
  const sf = ts.createSourceFile(relPath, source, ts.ScriptTarget.Latest, true);
  const docs: SymbolDoc[] = [];

  for (const stmt of sf.statements) {
    for (const { name, node } of topLevelDeclarations(stmt)) {
      docs.push({
        key: `${relPath}::${name}`,
        text: `${relPath} — ${name}\n${node.getText()}`,
      });
    }
  }

  if (docs.length === 0) {
    docs.push({ key: relPath, text: `${relPath}\n${source}` });
  }
  return docs;
}

/**
 * Get the named top-level declarations within a statement.
 *
 * @param stmt - A top-level statement from a source file.
 * @returns The named declarations it contains (empty for imports, exports, etc.).
 */
function topLevelDeclarations(stmt: ts.Statement): NamedDecl[] {
  if (ts.isFunctionDeclaration(stmt) && stmt.name) {
    return [{ name: stmt.name.text, node: stmt }];
  }
  if (ts.isClassDeclaration(stmt) && stmt.name) {
    return [{ name: stmt.name.text, node: stmt }];
  }
  if (ts.isInterfaceDeclaration(stmt)) {
    return [{ name: stmt.name.text, node: stmt }];
  }
  if (ts.isTypeAliasDeclaration(stmt)) {
    return [{ name: stmt.name.text, node: stmt }];
  }
  if (ts.isEnumDeclaration(stmt)) {
    return [{ name: stmt.name.text, node: stmt }];
  }
  if (ts.isVariableStatement(stmt)) {
    return stmt.declarationList.declarations
      .filter((d) => ts.isIdentifier(d.name))
      .map((d) => ({ name: (d.name as ts.Identifier).text, node: d }));
  }
  return [];
}
