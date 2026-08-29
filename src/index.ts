import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

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
      limit: z.number().int().min(1).max(50).default(5).describe("Max results"),
    },
  },
  async ({ query, limit }) => {
    // Placeholder: real semantic search will be added later.
    return {
      content: [
        { type: "text", text: `No results yet for: ${query} (limit ${limit})` },
      ],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("semantic-search MCP server running on stdio");
