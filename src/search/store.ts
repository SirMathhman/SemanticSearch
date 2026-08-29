import type { Embedder } from "./embedder.js";

/** A stored document: its text plus its embedding. */
interface Document {
  id: number;
  text: string;
  vector: number[];
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
 * Create an in-memory vector store.
 *
 * @param embedder - The embedder used for documents and queries.
 * @returns A store with addDocument and search operations.
 */
export function createStore(embedder: Embedder): Store {
  const docs: Document[] = [];
  let nextId = 1;

  return {
    async addDocument(text: string): Promise<number> {
      const [vector] = await embedder.embed([text]);
      const id = nextId++;
      docs.push({ id, text, vector });
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
