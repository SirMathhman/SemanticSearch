import { readFileSync, renameSync, writeFileSync } from "node:fs";
import type { IndexEntry } from "./index.js";

/** On-disk shape of the persisted corpus. */
export interface CorpusFile {
  nextId: number;
  docs: IndexEntry[];
}

/** The kind of corpus failure. */
export type CorpusErrorKind =
  | "unreadable"
  | "invalid-json"
  | "invalid-shape"
  | "write-failed";

/** Structured error for a corpus load or save failure. */
export interface CorpusError {
  /** What kind of failure this is. */
  kind: CorpusErrorKind;
  /** Where: path of the corpus file involved. */
  where: string;
  /** Why this is an error. */
  why: string;
  /** What to do to make the error go away. */
  fix: string;
}

/** Result of loading a corpus file. */
export type LoadResult =
  | { ok: true; corpus: CorpusFile }
  | { ok: false; error: CorpusError };

/** Result of saving a corpus file. */
export type SaveResult = { ok: true } | { ok: false; error: CorpusError };

/**
 * Load a persisted corpus from disk.
 *
 * @param filePath - Path to the corpus JSON file.
 * @returns The corpus, or a structured error if the file is unreadable or corrupt. A missing file yields an empty corpus.
 */
export function loadCorpus(filePath: string): LoadResult {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: true, corpus: { nextId: 1, docs: [] } };
    }
    return {
      ok: false,
      error: {
        kind: "unreadable",
        where: filePath,
        why: `the file could not be read: ${String(err)}`,
        fix: "check file permissions, or delete the file to regenerate it",
      },
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "invalid-json",
        where: filePath,
        why: `the file is not valid JSON: ${String(err)}`,
        fix: "fix the JSON, or delete the file to regenerate it",
      },
    };
  }

  const file = parsed as CorpusFile;
  if (typeof file?.nextId !== "number" || !Array.isArray(file?.docs)) {
    return {
      ok: false,
      error: {
        kind: "invalid-shape",
        where: filePath,
        why: "the file is not a valid corpus (expected { nextId, docs })",
        fix: "restore a valid corpus file, or delete it to start fresh",
      },
    };
  }
  // Legacy entries have no key; derive one so upserts stay stable.
  const docs: IndexEntry[] = file.docs.map((d) => ({
    key: d.key ?? `doc-${d.id}`,
    id: d.id,
    text: d.text,
    vector: d.vector,
  }));
  return { ok: true, corpus: { nextId: file.nextId, docs } };
}

/**
 * Persist the corpus to disk atomically (write temp file, then rename).
 *
 * @param filePath - Path to the corpus JSON file.
 * @param corpus - The corpus to write.
 * @returns A structured error if the write or rename fails (e.g. disk full,
 * permissions); otherwise a success marker. Never throws.
 */
export function saveCorpus(filePath: string, corpus: CorpusFile): SaveResult {
  const tmp = `${filePath}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(corpus));
    renameSync(tmp, filePath);
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "write-failed",
        where: filePath,
        why: `the corpus could not be written: ${String(err)}`,
        fix: "check disk space and file permissions, then retry",
      },
    };
  }
  return { ok: true };
}
