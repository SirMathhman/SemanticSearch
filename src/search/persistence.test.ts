import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus, saveCorpus } from "./persistence.js";

let dir: string;
let corpusPath: string;

before(() => {
  dir = mkdtempSync(path.join(tmpdir(), "semantic-search-persistence-"));
  corpusPath = path.join(dir, "corpus.json");
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("loadCorpus returns an empty corpus when the file is missing", () => {
  const result = loadCorpus(corpusPath);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected ok");
  assert.deepEqual(result.corpus, { nextId: 1, docs: [] });
});

test("loadCorpus returns an invalid-json error on invalid JSON", () => {
  writeFileSync(corpusPath, "{ not json");
  const result = loadCorpus(corpusPath);
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("expected error");
  assert.equal(result.error.kind, "invalid-json");
  assert.equal(result.error.where, corpusPath);
  assert.ok(result.error.why.length > 0);
  assert.ok(result.error.fix.length > 0);
});

test("loadCorpus returns an invalid-shape error on a wrong shape", () => {
  writeFileSync(corpusPath, JSON.stringify({ foo: "bar" }));
  const result = loadCorpus(corpusPath);
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("expected error");
  assert.equal(result.error.kind, "invalid-shape");
});

test("loadCorpus reads a valid corpus and derives keys for legacy entries", () => {
  writeFileSync(
    corpusPath,
    JSON.stringify({
      nextId: 3,
      docs: [{ id: 1, text: "hello", vector: [0.1, 0.2] }],
    }),
  );
  const result = loadCorpus(corpusPath);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected ok");
  assert.equal(result.corpus.nextId, 3);
  assert.deepEqual(result.corpus.docs, [
    { key: "doc-1", id: 1, text: "hello", vector: [0.1, 0.2] },
  ]);
});

test("saveCorpus writes a corpus that loadCorpus can read back", () => {
  const saved = saveCorpus(corpusPath, {
    nextId: 2,
    docs: [{ key: "doc-1", id: 1, text: "hi", vector: [0.5] }],
  });
  assert.deepEqual(saved, { ok: true });
  const loaded = loadCorpus(corpusPath);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) throw new Error("expected ok");
  assert.deepEqual(loaded.corpus, {
    nextId: 2,
    docs: [{ key: "doc-1", id: 1, text: "hi", vector: [0.5] }],
  });
});

test("saveCorpus returns a write-failed error when the path is not writable", () => {
  const badPath = path.join(dir, "no-such-dir", "corpus.json");
  const saved = saveCorpus(badPath, { nextId: 1, docs: [] });
  assert.equal(saved.ok, false);
  if (saved.ok) throw new Error("expected error");
  assert.equal(saved.error.kind, "write-failed");
  assert.equal(saved.error.where, badPath);
  assert.ok(saved.error.why.length > 0);
  assert.ok(saved.error.fix.length > 0);
});
