import type { Embedder } from "./embedder.js";
import { createIndex, type SearchResult } from "./index.js";
import { loadCorpus, saveCorpus } from "./persistence.js";

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
   * Find the most similar documents to a query (cosine similarity).
   *
   * @param query - The query text.
   * @param limit - Maximum number of results to return.
   * @returns Up to `limit` results, best score first.
   */
  search(query: string, limit: number): Promise<SearchResult[]>;
}

/**
 * Create a semantic search store, optionally persisted to a JSON file.
 *
 * @param embedder - The embedder used for documents and queries.
 * @param options - Store options (e.g. a persistence file path).
 * @returns A store with addDocument and search operations.
 * @throws When a configured corpus file exists but cannot be loaded.
 */
export function createStore(
  embedder: Embedder,
  options: StoreOptions = {},
): Store {
  const { filePath } = options;
  const index = createIndex();
  let nextId = 1;

  if (filePath) {
    const loaded = loadCorpus(filePath);
    if (!loaded.ok) {
      throw new Error(`Cannot load corpus at ${filePath}: ${loaded.error}`);
    }
    for (const doc of loaded.corpus.docs) index.insert(doc);
    nextId = loaded.corpus.nextId;
  }

  async function upsertMany(
    docs: { key: string; text: string }[],
  ): Promise<number[]> {
    if (docs.length === 0) return [];
    const ids = docs.map((d) => {
      const existing = index.entries().find((e) => e.key === d.key);
      return existing ? existing.id : nextId++;
    });
    const vectors = await embedder.embed(docs.map((d) => d.text));
    docs.forEach((d, i) =>
      index.upsert({
        key: d.key,
        id: ids[i],
        text: d.text,
        vector: vectors[i],
      }),
    );
    if (filePath) saveCorpus(filePath, { nextId, docs: index.entries() });
    return ids;
  }

  return {
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

    async search(query: string, limit: number): Promise<SearchResult[]> {
      const [q] = await embedder.embed([query]);
      return index.search(q, limit);
    },
  };
}
