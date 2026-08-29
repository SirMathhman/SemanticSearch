import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { addDocument, search } from "./search/store.js";

/**
 * Build the MCP server with its tools registered.
 *
 * @returns A configured (not yet connected) MCP server.
 */
export function createServer(): McpServer {
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
      const results = await search(query, limit);
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
      const id = await addDocument(text);
      return { content: [{ type: "text", text: `Added document ${id}` }] };
    },
  );

  return server;
}
