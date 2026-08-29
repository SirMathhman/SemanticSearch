import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore, type Store } from "./query.js";
import type { Embedder } from "./embedder.js";

/**
 * A fake embedder that returns a stable, distinct one-hot vector per text and
 * records how many texts it was asked to embed on each call. The same text
 * always maps to the same vector, so a query matching a document scores 1 and
 * a non-matching one scores 0.
 */
function makeFakeEmbedder(): { embedder: Embedder; calls: number[] } {
  const calls: number[] = [];
  const dim = 64;
  const vectors = new Map<string, number[]>();
  let next = 0;
  const vectorFor = (t: string): number[] => {
    let v = vectors.get(t);
    if (!v) {
      v = new Array<number>(dim).fill(0);
      v[next % dim] = 1;
      next++;
      vectors.set(t, v);
    }
    return v;
  };
  const embedder: Embedder = {
    async embed(texts: string[]): Promise<number[][]> {
      calls.push(texts.length);
      return texts.map(vectorFor);
    },
  };
  return { embedder, calls };
}

/** Build an in-memory store backed by the fake embedder. */
async function makeStore(): Promise<{ store: Store; calls: number[] }> {
  const { embedder, calls } = makeFakeEmbedder();
  const result = createStore(embedder);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected ok");
  return { store: result.store, calls };
}

test("search returns file and line for documents that carry them", async () => {
  const { store } = await makeStore();
  await store.upsertDocuments([
    {
      key: "src/a.ts::foo",
      text: "function foo() {}",
      file: "src/a.ts",
      line: 3,
    },
  ]);
  const results = await store.search("function foo() {}", 5);
  assert.equal(results.length, 1);
  assert.equal(results[0].file, "src/a.ts");
  assert.equal(results[0].line, 3);
});

test("search omits file and line for ad-hoc documents", async () => {
  const { store } = await makeStore();
  await store.addDocument("a plain note");
  const results = await store.search("a plain note", 5);
  assert.equal(results.length, 1);
  assert.equal(results[0].file, undefined);
  assert.equal(results[0].line, undefined);
});

test("reindexDirectory removes stale keys from the directory", async () => {
  const { store } = await makeStore();
  await store.reindexDirectory("src", [
    {
      key: "src/a.ts::foo",
      text: "function foo() {}",
      file: "src/a.ts",
      line: 1,
    },
    {
      key: "src/a.ts::bar",
      text: "function bar() {}",
      file: "src/a.ts",
      line: 5,
    },
  ]);
  // Re-index with only foo present; bar should be dropped.
  await store.reindexDirectory("src", [
    {
      key: "src/a.ts::foo",
      text: "function foo() {}",
      file: "src/a.ts",
      line: 1,
    },
  ]);
  const results = await store.search("function bar() {}", 5);
  assert.ok(
    !results.some((r) => r.text === "function bar() {}"),
    "stale bar document should have been removed",
  );
});

test("upsertDocuments does not re-embed unchanged documents", async () => {
  const { store, calls } = await makeStore();
  await store.upsertDocuments([
    {
      key: "src/a.ts::foo",
      text: "function foo() {}",
      file: "src/a.ts",
      line: 1,
    },
  ]);
  const callsAfterFirst = calls.length;
  // Same text: no re-embed should occur.
  await store.upsertDocuments([
    {
      key: "src/a.ts::foo",
      text: "function foo() {}",
      file: "src/a.ts",
      line: 1,
    },
  ]);
  assert.equal(calls.length, callsAfterFirst);
});

test("concurrent reindexes serialize so the later-issued one wins", async () => {
  // An embedder whose first call is deliberately slow and whose later calls
  // are fast. Without serialization, the fast second reindex would finish
  // first and the slow first would then resurrect the removed document.
  const dim = 8;
  const vectors = new Map<string, number[]>();
  let next = 0;
  const vectorFor = (t: string): number[] => {
    let v = vectors.get(t);
    if (!v) {
      v = new Array<number>(dim).fill(0);
      v[next % dim] = 1;
      next++;
      vectors.set(t, v);
    }
    return v;
  };
  let calls = 0;
  const embedder: Embedder = {
    async embed(texts: string[]): Promise<number[][]> {
      const isSlow = calls === 0;
      calls++;
      if (isSlow) await new Promise((r) => setTimeout(r, 50));
      return texts.map(vectorFor);
    },
  };
  const result = createStore(embedder);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected ok");
  const store = result.store;

  // Two reindexes for the same directory, issued concurrently: the first (A)
  // still has bar, the second (B) has dropped bar. A's embed is the slow one.
  const a = store.reindexDirectory("src", [
    {
      key: "src/a.ts::foo",
      text: "function foo() {}",
      file: "src/a.ts",
      line: 1,
    },
    {
      key: "src/a.ts::bar",
      text: "function bar() {}",
      file: "src/a.ts",
      line: 5,
    },
  ]);
  const b = store.reindexDirectory("src", [
    {
      key: "src/a.ts::foo",
      text: "function foo() {}",
      file: "src/a.ts",
      line: 1,
    },
  ]);
  await Promise.all([a, b]);

  // B (later-issued) must win: bar is removed, not resurrected by A.
  const results = await store.search("function bar() {}", 5);
  assert.ok(
    !results.some((r) => r.text === "function bar() {}"),
    "bar should have been removed by the later reindex",
  );
});
