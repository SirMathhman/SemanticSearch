import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** File name of the server config, relative to the working directory. */
export const CONFIG_FILE_NAME = "semantic-search.json";

/** Default location of the persisted corpus. */
export const DEFAULT_CORPUS_PATH = "corpus.json";

/** Server configuration. */
export interface Config {
  /**
   * Path to the JSON file that persists the corpus.
   */
  corpusPath: string;
}

/** The kind of config failure. */
export type ConfigErrorKind = "unreadable" | "invalid-json" | "invalid-shape";

/** Structured error for a failed config load. */
export interface ConfigError {
  /** What kind of failure this is. */
  kind: ConfigErrorKind;
  /** Where: path of the config file involved. */
  where: string;
  /** Why this is an error. */
  why: string;
  /** What to do to make the error go away. */
  fix: string;
}

/** Result of loading the server config. */
export type ConfigResult =
  | { ok: true; config: Config }
  | { ok: false; error: ConfigError };

/**
 * The default configuration, written to disk on first start.
 *
 * @returns A fresh default config.
 */
export function defaultConfig(): Config {
  return { corpusPath: DEFAULT_CORPUS_PATH };
}

/**
 * Load the server config from the working directory, creating the file with
 * defaults when it does not exist yet.
 *
 * The config file is `semantic-search.json` in the current working directory.
 * A missing file is created with defaults; an existing but unreadable or
 * malformed file yields a structured error so a user-edited config is never
 * clobbered.
 *
 * @returns The loaded (or freshly created) config, or a structured error.
 */
export function loadConfig(): ConfigResult {
  const filePath = path.join(process.cwd(), CONFIG_FILE_NAME);
  if (!existsSync(filePath)) {
    const config = defaultConfig();
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(config, null, 2) + "\n");
    return { ok: true, config };
  }

  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "unreadable",
        where: filePath,
        why: `the file could not be read: ${String(err)}`,
        fix: "check file permissions, or delete the file to regenerate it",
      },
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "invalid-json",
        where: filePath,
        why: `the file is not valid JSON: ${String(err)}`,
        fix: "fix the JSON, or delete the file to regenerate it",
      },
    };
  }

  const file = parsed as Partial<Config>;
  if (typeof file?.corpusPath !== "string" || file.corpusPath.length === 0) {
    return {
      ok: false,
      error: {
        kind: "invalid-shape",
        where: filePath,
        why: 'the config is missing a non-empty "corpusPath" string',
        fix: 'add "corpusPath" (a file path), or delete the file to regenerate it',
      },
    };
  }
  return { ok: true, config: { corpusPath: file.corpusPath } };
}
