import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { extractDirectory, extractSymbols } from "./extract.js";

test("extractSymbols captures key, file, and line for a top-level function", () => {
  const label = "src/foo.ts";
  const source = "function foo() {\n  return 1;\n}";
  const docs = extractSymbols(label, source);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].key, "src/foo.ts::foo");
  assert.equal(docs[0].file, "src/foo.ts");
  assert.equal(docs[0].line, 1);
  assert.ok(docs[0].text.startsWith("src/foo.ts — foo\n"));
});

test("extractSymbols captures one doc per declaration with correct lines", () => {
  const label = "src/bar.ts";
  const source =
    "const a = 1;\nconst b = 2;\nfunction foo() {\n  return a + b;\n}";
  const docs = extractSymbols(label, source);
  assert.equal(docs.length, 3);
  assert.deepEqual(
    docs.map((d) => d.line),
    [1, 2, 3],
  );
  assert.deepEqual(
    docs.map((d) => d.key),
    ["src/bar.ts::a", "src/bar.ts::b", "src/bar.ts::foo"],
  );
});

test("extractSymbols falls back to the whole file when there are no named declarations", () => {
  const label = "src/empty.ts";
  const source = "// no declarations here";
  const docs = extractSymbols(label, source);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].key, "src/empty.ts");
  assert.equal(docs[0].file, "src/empty.ts");
  assert.equal(docs[0].line, 1);
});

let dir: string;
before(() => {
  dir = mkdtempSync(path.join(tmpdir(), "semantic-search-extract-"));
});
after(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("extractDirectory returns docs with absolute forward-slash file paths", () => {
  const file = path.join(dir, "mod.ts");
  writeFileSync(file, "function baz() {\n  return 2;\n}");
  const result = extractDirectory(dir);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected ok");
  assert.equal(result.docs.length, 1);
  const expectedFile = file.split(path.sep).join("/");
  const doc = result.docs[0];
  assert.equal(doc.file, expectedFile);
  assert.equal(doc.line, 1);
  assert.equal(doc.key, `${expectedFile}::baz`);
});
