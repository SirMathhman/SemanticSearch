import path from "node:path";
import type { Embedder } from "./embedder.js";
import { createIndex, type SearchResult } from "./index.js";
import { loadCorpus, saveCorpus, type CorpusError } from "./persistence.js";

/** Options for creating a store. */
export interface StoreOptions {
  /**
   * Path to a JSON file for persisting the corpus.
   * When omitted, the store is purely in-memory.
   */
  filePath?: string;
}

/** A semantic search store over an embedder. */
export interface Store {
  /**
   * Embed and store a document.
   *
   * @param text - The document text to index.
   * @returns The id assigned to the new document.
   */
  addDocument(text: string): Promise<number>;

  /**
   * Embed and store a document under a stable key, replacing any existing document with that key.
   *
   * @param key - The stable identity for the document.
   * @param text - The document text to index.
   * @returns The id of the stored document.
   */
  upsertDocument(key: string, text: string): Promise<number>;

  /**
   * Embed and store many documents under stable keys in a single batch.
   * All texts are embedded in one call and the corpus is saved once.
   *
   * @param docs - The documents to upsert, each with a stable key and text.
   * @returns The ids of the stored documents, in input order.
   */
  upsertDocuments(docs: { key: string; text: string }[]): Promise<number[]>;

  /**
   * Re-index a directory: upsert the current symbols and remove any previously
   * indexed symbols from that directory that no longer exist.
   *
   * @param directory - The directory that was indexed (used to scope removals).
   * @param docs - The current symbol documents for that directory.
   * @returns The ids of the stored documents, in input order.
   */
  reindexDirectory(
    directory: string,
    docs: { key: string; text: string }[],
  ): Promise<number[]>;

  /**
   * Find the most similar documents to a query (cosine similarity).
   *
   * @param query - The query text.
   * @param limit - Maximum number of results to return.
   * @returns Up to `limit` results, best score first.
   */
  search(query: string, limit: number): Promise<SearchResult[]>;
}

/** Result of creating a store. */
export type CreateStoreResult =
  | { ok: true; store: Store }
  | { ok: false; error: CorpusError };

/**
 * Create a semantic search store, optionally persisted to a JSON file.
 *
 * @param embedder - The embedder used for documents and queries.
 * @param options - Store options (e.g. a persistence file path).
 * @returns A store with addDocument and search operations, or a structured
 * error when a configured corpus file exists but cannot be loaded.
 */
export function createStore(
  embedder: Embedder,
  options: StoreOptions = {},
): CreateStoreResult {
  const { filePath } = options;
  const index = createIndex();
  let nextId = 1;

  if (filePath) {
    const loaded = loadCorpus(filePath);
    if (!loaded.ok) {
      return { ok: false, error: loaded.error };
    }
    for (const doc of loaded.corpus.docs) index.insert(doc);
    nextId = loaded.corpus.nextId;
  }

  async function upsertMany(
    docs: { key: string; text: string }[],
  ): Promise<number[]> {
    if (docs.length === 0) return [];
    const existing = new Map(index.entries().map((e) => [e.key, e]));
    // Only re-embed documents whose text actually changed; unchanged entries
    // keep their stored vectors. This makes watcher re-indexes cheap.
    const changed = docs.filter((d) => {
      const e = existing.get(d.key);
      return !e || e.text !== d.text;
    });
    const ids = new Map(
      docs.map((d) => [d.key, existing.get(d.key)?.id ?? nextId++]),
    );
    if (changed.length > 0) {
      const vectors = await embedder.embed(changed.map((d) => d.text));
      changed.forEach((d, i) =>
        index.upsert({
          key: d.key,
          id: ids.get(d.key)!,
          text: d.text,
          vector: vectors[i],
        }),
      );
      if (filePath) {
        const saved = saveCorpus(filePath, { nextId, docs: index.entries() });
        if (!saved.ok) {
          // The in-memory index stays authoritative for this session; the
          // next save retries. Surface the failure on stderr (stdout is
          // reserved for the MCP protocol).
          const e = saved.error;
          console.error(`Corpus save failed at ${e.where}: ${e.why}. ${e.fix}`);
        }
      }
    }
    return docs.map((d) => ids.get(d.key)!);
  }

  return {
    ok: true as const,
    store: {
      async addDocument(text: string): Promise<number> {
        // Key off the next id without consuming it; upsertMany assigns it.
        return (await upsertMany([{ key: `doc-${nextId}`, text }]))[0];
      },

      async upsertDocument(key: string, text: string): Promise<number> {
        return (await upsertMany([{ key, text }]))[0];
      },

      async upsertDocuments(
        docs: { key: string; text: string }[],
      ): Promise<number[]> {
        return upsertMany(docs);
      },

      async reindexDirectory(
        directory: string,
        docs: { key: string; text: string }[],
      ): Promise<number[]> {
        // Drop stale entries: previously indexed keys under this directory
        // that are no longer present in the fresh extraction.
        const prefix = normalizeDir(directory);
        const current = new Set(docs.map((d) => d.key));
        for (const e of index.entries()) {
          if (e.key.startsWith(prefix) && !current.has(e.key)) {
            index.remove(e.key);
          }
        }
        return upsertMany(docs);
      },

      async search(query: string, limit: number): Promise<SearchResult[]> {
        const [q] = await embedder.embed([query]);
        return index.search(q, limit);
      },
    },
  };
}

/**
 * Normalize a directory path into a key prefix for scoping removals.
 *
 * @param directory - The directory that was indexed.
 * @returns A forward-slash path with a trailing slash.
 */
function normalizeDir(directory: string): string {
  return directory.split(path.sep).join("/").replace(/\/+$/, "") + "/";
}
