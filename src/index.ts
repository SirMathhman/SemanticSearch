import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

const server = await createServer();
await server.connect(new StdioServerTransport());
console.error("semantic-search MCP server running on stdio");
