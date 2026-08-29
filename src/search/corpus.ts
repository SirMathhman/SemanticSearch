import { existsSync } from "node:fs";
import type { Config } from "./config.js";
import { extractDirectory } from "./extract.js";
import type { Store } from "./query.js";

/**
 * Index every configured directory into the store: extract each directory's
 * symbols and reindex them. This is a pure domain operation — it does not
 * start watchers and does not touch the MCP layer.
 *
 * A directory that does not exist is skipped with a warning on stderr. A
 * directory that cannot be listed is logged and skipped.
 *
 * @param config - The server config (provides the directories to index).
 * @param store - The store to index into.
 * @returns Nothing.
 */
export async function indexDirectories(
  config: Config,
  store: Store,
): Promise<void> {
  for (const directory of config.directories) {
    if (!existsSync(directory)) {
      console.error(`Configured directory not found, skipping: ${directory}`);
      continue;
    }
    const extracted = extractDirectory(directory);
    if (!extracted.ok) {
      const e = extracted.error;
      console.error(`Extraction error at ${e.where}: ${e.why}. ${e.fix}`);
      continue;
    }
    await store.reindexDirectory(directory, extracted.docs);
  }
}
