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
 * malformed file is a hard error so a user-edited config is never clobbered.
 *
 * @returns The loaded (or freshly created) config.
 * @throws When the config file exists but cannot be read or parsed.
 */
export function loadConfig(): Config {
  const filePath = path.join(process.cwd(), CONFIG_FILE_NAME);
  if (!existsSync(filePath)) {
    const config = defaultConfig();
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(config, null, 2) + "\n");
    return config;
  }

  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (err) {
    throw new Error(`Cannot read config at ${filePath}: ${String(err)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Invalid JSON in config at ${filePath}: ${String(err)}. Fix or delete the file to regenerate it.`,
    );
  }

  const file = parsed as Partial<Config>;
  if (typeof file?.corpusPath !== "string" || file.corpusPath.length === 0) {
    throw new Error(
      `Config at ${filePath} is missing a non-empty "corpusPath" string. Fix or delete the file to regenerate it.`,
    );
  }
  return { corpusPath: file.corpusPath };
}
