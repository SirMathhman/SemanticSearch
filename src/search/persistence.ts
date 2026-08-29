import { readFileSync, renameSync, writeFileSync } from "node:fs";
import type { IndexEntry } from "./index.js";

/** On-disk shape of the persisted corpus. */
export interface CorpusFile {
  nextId: number;
  docs: IndexEntry[];
}

/** Result of loading a corpus file. */
export type LoadResult =
  | { ok: true; corpus: CorpusFile }
  | { ok: false; error: string };

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
    return { ok: false, error: String(err) };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { ok: false, error: `invalid JSON: ${String(err)}` };
  }

  const file = parsed as CorpusFile;
  if (typeof file?.nextId !== "number" || !Array.isArray(file?.docs)) {
    return { ok: false, error: "unexpected corpus shape" };
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
 * @returns Nothing.
 */
export function saveCorpus(filePath: string, corpus: CorpusFile): void {
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, JSON.stringify(corpus));
  renameSync(tmp, filePath);
}
