import { createServer } from "../src/server.js";

// Run the same startup indexing the server does (load config, create store,
// index + watch each configured directory, writing corpus.json), then exit.
// createServer performs the indexing before any stdio connection, so this
// produces the corpus without needing an MCP client.
await createServer();
console.error("Corpus generated.");
process.exit(0);
