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

/** A document to upsert into the store. */
export interface DocInput {
  /** Stable identity for the document. */
  key: string;
  /** The text to embed. */
  text: string;
  /** Source file the document came from, when known. */
  file?: string;
  /** 1-based line of the declaration in `file`, when known. */
  line?: number;
}

/** A semantic search store over an embedder. */
export interface Store {
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
  upsertDocuments(docs: DocInput[]): Promise<number[]>;

  /**
   * Re-index a directory: upsert the current symbols and remove any previously
   * indexed symbols from that directory that no longer exist.
   *
   * @param directory - The directory that was indexed (used to scope removals).
   * @param docs - The current symbol documents for that directory.
   * @returns The ids of the stored documents, in input order.
   */
  reindexDirectory(directory: string, docs: DocInput[]): Promise<number[]>;

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

/** Shared state for the store operation factories. */
interface StoreContext {
  /** The in-memory vector index. */
  index: ReturnType<typeof createIndex>;
  /** The embedder used for documents and queries. */
  embedder: Embedder;
  /** Path to the persistence file, or undefined for an in-memory store. */
  filePath?: string;
  /** Mutable counter for the next document id. */
  nextIdRef: { current: number };
  /**
   * Tail of the mutation chain. Every mutating operation is enqueued after
   * this promise so that concurrent mutations (e.g. the background initial
   * index and a watcher reindex) run strictly one at a time, in issue order.
   */
  chain: Promise<unknown>;
}

/**
 * Run a mutating operation after all previously enqueued mutations have
 * completed, preserving issue order. The chain itself never rejects (so one
 * failed mutation does not wedge later ones); the caller still receives the
 * operation's own result or error.
 *
 * @param ctx - The store context (holds the chain tail).
 * @param op - The mutation to run once the chain reaches it.
 * @returns A promise for the operation's result.
 */
function enqueue<T>(ctx: StoreContext, op: () => Promise<T>): Promise<T> {
  const next = ctx.chain.then(op, op);
  ctx.chain = next.catch(() => {});
  return next;
}

/**
 * Embed and upsert many documents under stable keys in a single batch.
 * Only documents whose text changed are re-embedded; the corpus is saved
 * once. A failed save is logged to stderr and the in-memory index stays
 * authoritative until the next save retries.
 *
 * @param ctx - The store context.
 * @param docs - The documents to upsert, each with a stable key and text.
 * @returns The ids of the stored documents, in input order.
 */
async function upsertMany(
  ctx: StoreContext,
  docs: DocInput[],
): Promise<number[]> {
  const { index, embedder, filePath, nextIdRef } = ctx;
  if (docs.length === 0) return [];
  const existing = new Map(index.entries().map((e) => [e.key, e]));
  // Only re-embed documents whose text actually changed; unchanged entries
  // keep their stored vectors. This makes watcher re-indexes cheap.
  const changed = docs.filter((d) => {
    const e = existing.get(d.key);
    return !e || e.text !== d.text;
  });
  const ids = new Map(
    docs.map((d) => [d.key, existing.get(d.key)?.id ?? nextIdRef.current++]),
  );
  if (changed.length > 0) {
    const vectors = await embedder.embed(changed.map((d) => d.text));
    changed.forEach((d, i) =>
      index.upsert({
        key: d.key,
        id: ids.get(d.key)!,
        text: d.text,
        vector: vectors[i],
        file: d.file,
        line: d.line,
      }),
    );
    if (filePath) {
      const saved = saveCorpus(filePath, {
        nextId: nextIdRef.current,
        docs: index.entries(),
      });
      if (!saved.ok) {
        const e = saved.error;
        console.error(`Corpus save failed at ${e.where}: ${e.why}. ${e.fix}`);
      }
    }
  }
  return docs.map((d) => ids.get(d.key)!);
}

/**
 * Build the `upsertDocument` operation: embed and store a document under a
 * stable key.
 *
 * @param ctx - The store context.
 * @returns The upsertDocument operation.
 */
function makeUpsertDocument(ctx: StoreContext) {
  return (key: string, text: string): Promise<number> =>
    enqueue(ctx, async () => (await upsertMany(ctx, [{ key, text }]))[0]);
}

/**
 * Build the `upsertDocuments` operation: embed and store many documents under
 * stable keys in a single batch.
 *
 * @param ctx - The store context.
 * @returns The upsertDocuments operation.
 */
function makeUpsertDocuments(ctx: StoreContext) {
  return (docs: DocInput[]): Promise<number[]> =>
    enqueue(ctx, () => upsertMany(ctx, docs));
}

/**
 * Build the `reindexDirectory` operation: upsert the current symbols and
 * remove any previously indexed symbols from that directory that no longer
 * exist.
 *
 * @param ctx - The store context.
 * @returns The reindexDirectory operation.
 */
function makeReindexDirectory(ctx: StoreContext) {
  return (directory: string, docs: DocInput[]): Promise<number[]> =>
    enqueue(ctx, async () => {
      // Drop stale entries: previously indexed keys under this directory
      // that are no longer present in the fresh extraction.
      const prefix = normalizeDir(directory);
      const current = new Set(docs.map((d) => d.key));
      for (const e of ctx.index.entries()) {
        if (e.key.startsWith(prefix) && !current.has(e.key)) {
          ctx.index.remove(e.key);
        }
      }
      return upsertMany(ctx, docs);
    });
}

/**
 * Build the `search` operation: find the most similar documents to a query.
 *
 * @param ctx - The store context.
 * @returns The search operation.
 */
function makeSearch(ctx: StoreContext) {
  return async (query: string, limit: number): Promise<SearchResult[]> => {
    const [q] = await ctx.embedder.embed([query]);
    return ctx.index.search(q, limit);
  };
}

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
  const nextIdRef = { current: 1 };

  if (filePath) {
    const loaded = loadCorpus(filePath);
    if (!loaded.ok) {
      return { ok: false, error: loaded.error };
    }
    for (const doc of loaded.corpus.docs) index.insert(doc);
    nextIdRef.current = loaded.corpus.nextId;
  }

  const ctx: StoreContext = {
    index,
    embedder,
    filePath,
    nextIdRef,
    chain: Promise.resolve(),
  };
  return {
    ok: true,
    store: {
      upsertDocument: makeUpsertDocument(ctx),
      upsertDocuments: makeUpsertDocuments(ctx),
      reindexDirectory: makeReindexDirectory(ctx),
      search: makeSearch(ctx),
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
