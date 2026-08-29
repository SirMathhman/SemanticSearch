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
  const config = loadConfig();
  assert.deepEqual(config, defaultConfig());
  const onDisk = JSON.parse(
    readFileSync(path.join(dir, CONFIG_FILE_NAME), "utf8"),
  );
  assert.deepEqual(onDisk, defaultConfig());
});

test("loadConfig is idempotent: an existing file is not rewritten", () => {
  loadConfig();
  const before = readFileSync(path.join(dir, CONFIG_FILE_NAME), "utf8");
  const config = loadConfig();
  assert.deepEqual(config, defaultConfig());
  assert.equal(readFileSync(path.join(dir, CONFIG_FILE_NAME), "utf8"), before);
});

test("loadConfig reads a user-edited corpusPath", () => {
  writeFileSync(
    path.join(dir, CONFIG_FILE_NAME),
    JSON.stringify({ corpusPath: "my-corpus.json" }),
  );
  assert.deepEqual(loadConfig(), { corpusPath: "my-corpus.json" });
});

test("loadConfig throws on invalid JSON", () => {
  writeFileSync(path.join(dir, CONFIG_FILE_NAME), "{ not json");
  assert.throws(() => loadConfig(), /Invalid JSON in config/);
});

test("loadConfig throws when corpusPath is missing", () => {
  writeFileSync(path.join(dir, CONFIG_FILE_NAME), JSON.stringify({}));
  assert.throws(() => loadConfig(), /missing a non-empty "corpusPath"/);
});

test("loadConfig throws when corpusPath is not a string", () => {
  writeFileSync(
    path.join(dir, CONFIG_FILE_NAME),
    JSON.stringify({ corpusPath: 42 }),
  );
  assert.throws(() => loadConfig(), /missing a non-empty "corpusPath"/);
});
