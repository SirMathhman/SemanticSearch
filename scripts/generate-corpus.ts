import { loadConfig } from "../src/search/config.js";
import { indexDirectories } from "../src/search/corpus.js";
import { localEmbedder } from "../src/search/local-embedder.js";
import { createStore } from "../src/search/query.js";

// Generate the corpus by running the same domain indexing the server uses:
// load config, create the store (persisted to the configured corpus path),
// and index every configured directory. No MCP server and no watchers are
// started, so the process exits cleanly when indexing completes.
const configResult = loadConfig();
if (!configResult.ok) {
  const e = configResult.error;
  console.error(`Config error at ${e.where}: ${e.why}. ${e.fix}`);
  process.exit(1);
}
const storeResult = createStore(localEmbedder, {
  filePath: configResult.config.corpusPath,
});
if (!storeResult.ok) {
  const e = storeResult.error;
  console.error(`Corpus error at ${e.where}: ${e.why}. ${e.fix}`);
  process.exit(1);
}
await indexDirectories(configResult.config, storeResult.store);
console.error("Corpus generated.");
