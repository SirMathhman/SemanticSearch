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
 *
 * @returns A configured (not yet connected) MCP server.
 * @throws When the config file exists but is unreadable or malformed.
 */
export function createServer(): McpServer {
  const config = loadConfig();
  const store = createStore(localEmbedder, { filePath: config.corpusPath });
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
