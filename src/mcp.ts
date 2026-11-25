import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Gateway } from "./gateway.js";
import { vmIntent } from "./intent.js";

const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
});

/**
 * The agent-facing surface. Deliberately has no approve tool: applying a
 * change always takes a human running `pnpm approve` outside the agent.
 */
export function createMcpServer(gateway: Gateway, options: { agentId: string }) {
  const server = new McpServer({ name: "infra-agent-gateway", version: "0.1.0" });
  const actor = options.agentId;

  server.registerTool(
    "plan_change",
    {
      description:
        "Plan an infrastructure change from a structured intent. Runs `tofu plan` and policy checks; never changes anything. Returns a planId, a summary and any policy violations.",
      inputSchema: vmIntent.shape,
      annotations: { readOnlyHint: true },
    },
    async (intent) => text(await gateway.planChange(intent, actor)),
  );

  server.registerTool(
    "request_apply",
    {
      description:
        "Ask a human to approve and apply a plan. Does not apply anything; the plan waits as pending_approval.",
      inputSchema: { planId: z.string() },
    },
    async ({ planId }) => text(await gateway.requestApply(planId, actor)),
  );

  server.registerTool(
    "get_audit_log",
    {
      description: "Read the most recent audit log entries.",
      inputSchema: { limit: z.number().int().min(1).max(100).default(20) },
      annotations: { readOnlyHint: true },
    },
    async ({ limit }) => text(await gateway.auditLog(limit)),
  );

  return server;
}
