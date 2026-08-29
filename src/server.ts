import { existsSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadConfig } from "./search/config.js";
import { extractDirectory } from "./search/extract.js";
import { localEmbedder } from "./search/local-embedder.js";
import { createStore } from "./search/query.js";
import { watchDirectory } from "./search/watcher.js";

/**
 * Build the MCP server with its tools registered.
 *
 * Loads the server config (creating `semantic-search.json` in the working
 * directory on first start) and uses its corpus path for persistence.
 * Each configured directory is indexed and watched at startup; a directory
 * that does not exist is skipped with a warning on stderr.
 * This is the single place that turns a failed config or corpus load into
 * a process-level failure: the structured error is logged to stderr and the
 * process exits with a non-zero code.
 *
 * @returns A configured (not yet connected) MCP server.
 */
export async function createServer(): Promise<McpServer> {
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
  const store = storeResult.store;
  for (const directory of configResult.config.directories) {
    if (!existsSync(directory)) {
      console.error(`Configured directory not found, skipping: ${directory}`);
      continue;
    }
    const docs = extractDirectory(directory);
    await store.reindexDirectory(directory, docs);
    // Keep the corpus in sync with future edits to this directory.
    watchDirectory(directory, () =>
      store.reindexDirectory(directory, extractDirectory(directory)),
    );
  }
  const server = new McpServer({
    name: "semantic-search",
    version: "0.1.0",
  });

  server.registerTool(
    "search",
    {
      title: "Semantic search",
      description: "Search the corpus semantically for a query.",
      inputSchema: {
        query: z.string().describe("The search query"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(5)
          .describe("Max results"),
      },
    },
    async ({ query, limit }) => {
      const results = await store.search(query, limit);
      const text =
        results.length === 0
          ? "No documents in the corpus yet."
          : results
              .map((r) => `[${r.score.toFixed(3)}] (id ${r.id}) ${r.text}`)
              .join("\n");
      return { content: [{ type: "text", text }] };
    },
  );

  server.registerTool(
    "add_document",
    {
      title: "Add document",
      description: "Embed and store a document in the corpus.",
      inputSchema: {
        text: z.string().describe("The document text to index"),
      },
    },
    async ({ text }) => {
      const id = await store.addDocument(text);
      return { content: [{ type: "text", text: `Added document ${id}` }] };
    },
  );

  server.registerTool(
    "index_directory",
    {
      title: "Index directory",
      description:
        "Extract top-level symbols from every .ts file under a directory and upsert them into the corpus. Re-running is idempotent: symbols are keyed by path and name, so edits replace existing entries instead of duplicating them.",
      inputSchema: {
        directory: z
          .string()
          .describe("Absolute path to the directory to index"),
      },
    },
    async ({ directory }) => {
      const docs = extractDirectory(directory);
      await store.reindexDirectory(directory, docs);
      // Keep the corpus in sync with future edits to this directory.
      watchDirectory(directory, () =>
        store.reindexDirectory(directory, extractDirectory(directory)),
      );
      return {
        content: [
          {
            type: "text",
            text: `Indexed ${docs.length} symbols under ${directory}. Watching for changes.`,
          },
        ],
      };
    },
  );

  return server;
}
