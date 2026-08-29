import { readdirSync, readFileSync } from "node:fs";
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
 * A subdirectory that vanishes or is unreadable mid-walk is skipped rather
 * than thrown on: the walk runs under the file watcher, where races are
 * normal.
 *
 * @param root - The directory to walk.
 * @returns Relative file paths (forward slashes), skipping node_modules, dist, and dot-directories.
 */
export function listTypeScriptFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
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
 * @param label - The file path used in each document's key and text. Use an
 *   absolute, forward-slash path so keys are globally unique and scopable by directory.
 * @param source - The file's source text.
 * @returns One document per named top-level declaration, or a single whole-file document when none exist.
 */
export function extractSymbols(label: string, source: string): SymbolDoc[] {
  const sf = ts.createSourceFile(label, source, ts.ScriptTarget.Latest, true);
  const docs: SymbolDoc[] = [];

  for (const stmt of sf.statements) {
    for (const { name, node } of topLevelDeclarations(stmt)) {
      docs.push({
        key: `${label}::${name}`,
        text: `${label} — ${name}\n${node.getText()}`,
      });
    }
  }

  if (docs.length === 0) {
    docs.push({ key: label, text: `${label}\n${source}` });
  }
  return docs;
}

/** The kind of extraction failure. */
export type ExtractErrorKind = "unreadable";

/** Structured error for a failed directory extraction. */
export interface ExtractError {
  /** What kind of failure this is. */
  kind: ExtractErrorKind;
  /** Where: the file or directory involved. */
  where: string;
  /** Why this is an error. */
  why: string;
  /** What to do to make the error go away. */
  fix: string;
}

/** Result of extracting symbol documents from a directory. */
export type ExtractResult =
  | { ok: true; docs: SymbolDoc[] }
  | { ok: false; error: ExtractError };

/**
 * Extract symbol documents for every TypeScript file under a directory.
 * Keys use absolute, forward-slash paths so entries are globally unique and
 * can be scoped to their source directory.
 *
 * A file that vanishes or is unreadable mid-walk is skipped rather than
 * thrown on: the walk runs under the file watcher, where races are normal.
 * Only a directory that cannot be listed at all is a hard error.
 *
 * @param directory - The directory to walk.
 * @returns All symbol documents in file order, or a structured error when the directory cannot be listed.
 */
export function extractDirectory(directory: string): ExtractResult {
  let files: string[];
  try {
    files = listTypeScriptFiles(directory);
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "unreadable",
        where: directory,
        why: `the directory could not be listed: ${String(err)}`,
        fix: "check the path and permissions, or remove it from the config",
      },
    };
  }
  const docs: SymbolDoc[] = [];
  for (const rel of files) {
    const label = toKeyPath(path.join(directory, rel));
    let source: string;
    try {
      source = readFileSync(label, "utf8");
    } catch {
      continue;
    }
    docs.push(...extractSymbols(label, source));
  }
  return { ok: true, docs };
}

/**
 * Normalize a path to forward slashes for use as a stable key.
 *
 * @param p - The path to normalize.
 * @returns The path with forward slashes.
 */
function toKeyPath(p: string): string {
  return p.split(path.sep).join("/");
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
