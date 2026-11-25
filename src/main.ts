import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRealGateway } from "./config.js";
import { createMcpServer } from "./mcp.js";

const server = createMcpServer(createRealGateway(), { agentId: process.env.AGENT_ID ?? "agent:claude" });
await server.connect(new StdioServerTransport());
