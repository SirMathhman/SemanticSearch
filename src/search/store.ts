import { readFileSync, writeFileSync } from "node:fs";
import type { Embedder } from "./embedder.js";

/** A stored document: its text plus its embedding. */
interface Document {
  id: number;
  text: string;
  vector: number[];
}

/** On-disk shape of the persisted corpus. */
interface CorpusFile {
  nextId: number;
  docs: Document[];
}

/** Options for creating a store. */
export interface StoreOptions {
  /**
   * Path to a JSON file for persisting the corpus.
   * When omitted, the store is purely in-memory.
   */
  filePath?: string;
}

/** A search hit: document id, text, and cosine similarity score. */
export interface SearchResult {
  id: number;
  text: string;
  score: number;
}

/** An in-memory vector store over an embedder. */
export interface Store {
  /**
   * Embed and store a document.
   *
   * @param text - The document text to index.
   * @returns The id assigned to the new document.
   */
  addDocument(text: string): Promise<number>;

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
 * Create a vector store, optionally persisted to a JSON file.
 *
 * @param embedder - The embedder used for documents and queries.
 * @param options - Store options (e.g. a persistence file path).
 * @returns A store with addDocument and search operations.
 */
export function createStore(
  embedder: Embedder,
  options: StoreOptions = {},
): Store {
  const { filePath } = options;
  const { docs, nextId: startId } = loadCorpus(filePath);
  let nextId = startId;

  return {
    async addDocument(text: string): Promise<number> {
      const [vector] = await embedder.embed([text]);
      const id = nextId++;
      docs.push({ id, text, vector });
      saveCorpus(filePath, { nextId, docs });
      return id;
    },

    async search(query: string, limit: number): Promise<SearchResult[]> {
      const [q] = await embedder.embed([query]);
      return docs
        .map((d) => ({ id: d.id, text: d.text, score: dot(q, d.vector) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    },
  };
}

/**
 * Load a persisted corpus, or start empty when no file exists.
 *
 * @param filePath - Path to the corpus JSON file, or undefined for in-memory.
 * @returns The stored documents and the next id to assign.
 */
function loadCorpus(filePath: string | undefined): CorpusFile {
  if (!filePath) return { nextId: 1, docs: [] };
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as CorpusFile;
    return { nextId: parsed.nextId, docs: parsed.docs };
  } catch {
    return { nextId: 1, docs: [] };
  }
}

/**
 * Persist the corpus to disk (no-op when no file path is configured).
 *
 * @param filePath - Path to the corpus JSON file, or undefined.
 * @param corpus - The corpus to write.
 * @returns Nothing.
 */
function saveCorpus(filePath: string | undefined, corpus: CorpusFile): void {
  if (!filePath) return;
  writeFileSync(filePath, JSON.stringify(corpus));
}

/**
 * Dot product of two equal-length vectors.
 *
 * @param a - First vector.
 * @param b - Second vector.
 * @returns The dot product (cosine similarity, since vectors are normalized).
 */
function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}
