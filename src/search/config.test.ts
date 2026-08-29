import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG_FILE_NAME, defaultConfig, loadConfig } from "./config.js";

let dir: string;
let originalCwd: string;

before(() => {
  originalCwd = process.cwd();
  dir = mkdtempSync(path.join(tmpdir(), "semantic-search-config-"));
  process.chdir(dir);
});

after(() => {
  process.chdir(originalCwd);
  rmSync(dir, { recursive: true, force: true });
});

test("loadConfig creates the config file with defaults when missing", () => {
  const result = loadConfig();
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected ok");
  assert.deepEqual(result.config, defaultConfig());
  const onDisk = JSON.parse(
    readFileSync(path.join(dir, CONFIG_FILE_NAME), "utf8"),
  );
  assert.deepEqual(onDisk, defaultConfig());
});

test("loadConfig is idempotent: an existing file is not rewritten", () => {
  loadConfig();
  const before = readFileSync(path.join(dir, CONFIG_FILE_NAME), "utf8");
  const result = loadConfig();
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected ok");
  assert.deepEqual(result.config, defaultConfig());
  assert.equal(readFileSync(path.join(dir, CONFIG_FILE_NAME), "utf8"), before);
});

test("loadConfig reads a user-edited corpusPath", () => {
  writeFileSync(
    path.join(dir, CONFIG_FILE_NAME),
    JSON.stringify({ corpusPath: "my-corpus.json" }),
  );
  const result = loadConfig();
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected ok");
  assert.deepEqual(result.config, { corpusPath: "my-corpus.json" });
});

test("loadConfig returns an invalid-json error on invalid JSON", () => {
  writeFileSync(path.join(dir, CONFIG_FILE_NAME), "{ not json");
  const result = loadConfig();
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("expected error");
  assert.equal(result.error.kind, "invalid-json");
  assert.ok(result.error.where.includes(CONFIG_FILE_NAME));
  assert.ok(result.error.why.length > 0);
  assert.ok(result.error.fix.length > 0);
});

test("loadConfig returns an invalid-shape error when corpusPath is missing", () => {
  writeFileSync(path.join(dir, CONFIG_FILE_NAME), JSON.stringify({}));
  const result = loadConfig();
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("expected error");
  assert.equal(result.error.kind, "invalid-shape");
});

test("loadConfig returns an invalid-shape error when corpusPath is not a string", () => {
  writeFileSync(
    path.join(dir, CONFIG_FILE_NAME),
    JSON.stringify({ corpusPath: 42 }),
  );
  const result = loadConfig();
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("expected error");
  assert.equal(result.error.kind, "invalid-shape");
});
