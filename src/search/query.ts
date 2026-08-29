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

  async function upsert(
    key: string,
    text: string,
    id: number,
  ): Promise<number> {
    const [vector] = await embedder.embed([text]);
    index.upsert({ key, id, text, vector });
    if (filePath) saveCorpus(filePath, { nextId, docs: index.entries() });
    return id;
  }

  return {
    async addDocument(text: string): Promise<number> {
      const id = nextId++;
      return upsert(`doc-${id}`, text, id);
    },

    async upsertDocument(key: string, text: string): Promise<number> {
      const existing = index.entries().find((e) => e.key === key);
      const id = existing ? existing.id : nextId++;
      return upsert(key, text, id);
    },

    async search(query: string, limit: number): Promise<SearchResult[]> {
      const [q] = await embedder.embed([query]);
      return index.search(q, limit);
    },
  };
}
