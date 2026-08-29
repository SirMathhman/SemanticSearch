import { readFileSync } from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { extractSymbols, listTypeScriptFiles } from "./search/extract.js";
import { localEmbedder } from "./search/local-embedder.js";
import { createStore } from "./search/query.js";

/** Default corpus file location (override with SEMANTIC_SEARCH_CORPUS). */
const CORPUS_PATH = process.env.SEMANTIC_SEARCH_CORPUS ?? "corpus.json";

/**
 * Build the MCP server with its tools registered.
 *
 * @returns A configured (not yet connected) MCP server.
 */
export function createServer(): McpServer {
  const store = createStore(localEmbedder, { filePath: CORPUS_PATH });
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
      const files = listTypeScriptFiles(directory);
      const docs = files.flatMap((rel) =>
        extractSymbols(rel, readFileSync(path.join(directory, rel), "utf8")),
      );
      await store.upsertDocuments(docs);
      return {
        content: [
          {
            type: "text",
            text: `Indexed ${docs.length} symbols from ${files.length} files under ${directory}.`,
          },
        ],
      };
    },
  );

  return server;
}
