/** A stored document: its text plus its embedding. */
export interface IndexEntry {
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

/** A pure in-memory vector index (no I/O, no embedder). */
export interface Index {
  /**
   * Add an entry to the index.
   *
   * @param entry - The entry to insert.
   * @returns Nothing.
   */
  insert(entry: IndexEntry): void;

  /**
   * Find the entries most similar to a query vector (cosine similarity).
   *
   * @param queryVector - The (normalized) query vector.
   * @param limit - Maximum number of results to return.
   * @returns Up to `limit` results, best score first.
   */
  search(queryVector: number[], limit: number): SearchResult[];

  /**
   * All entries currently in the index.
   *
   * @returns The entries, in insertion order.
   */
  entries(): IndexEntry[];
}

/**
 * Create an empty in-memory vector index.
 *
 * @returns A new index with insert, search, and entries operations.
 */
export function createIndex(): Index {
  const entries: IndexEntry[] = [];

  return {
    insert(entry: IndexEntry): void {
      entries.push(entry);
    },

    search(queryVector: number[], limit: number): SearchResult[] {
      return entries
        .map((e) => ({
          id: e.id,
          text: e.text,
          score: dot(queryVector, e.vector),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    },

    entries(): IndexEntry[] {
      return entries;
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
