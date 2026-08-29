import { existsSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadConfig } from "./search/config.js";
import { indexDirectories } from "./search/corpus.js";
import { extractDirectory } from "./search/extract.js";
import { type SearchResult } from "./search/index.js";
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
  await indexDirectories(configResult.config, store);
  for (const directory of configResult.config.directories) {
    if (!existsSync(directory)) continue;
    watchDirectory(directory, () => {
      const r = extractDirectory(directory);
      if (r.ok) {
        void store.reindexDirectory(directory, r.docs);
      } else {
        const e = r.error;
        console.error(`Extraction error at ${e.where}: ${e.why}. ${e.fix}`);
      }
    });
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
          : results.map(formatResult).join("\n");
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

  return server;
}

/**
 * Format a single search result as a line for the search tool output.
 *
 * @param r - The search result to format.
 * @returns A line like `[0.812] (id 3) src/foo.ts:10 — name\n<text>`,
 *   with the `file:line` location included when the result carries one.
 */
function formatResult(r: SearchResult): string {
  const loc = r.file ? ` ${r.file}${r.line ? `:${r.line}` : ""}` : "";
  return `[${r.score.toFixed(3)}] (id ${r.id})${loc}\n${r.text}`;
}
