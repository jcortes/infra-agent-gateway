import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createGateway } from "../src/gateway.js";
import { createMcpServer } from "../src/mcp.js";
import { createFakeWorld } from "./fakes.js";

async function connect(world = createFakeWorld()) {
  const server = createMcpServer(createGateway(world.ports), { agentId: "agent:claude" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-agent", version: "0.0.0" });
  await client.connect(clientTransport);
  return { client, world };
}

describe("MCP server", () => {
  it("exposes agent-safe tools only: there is no approve tool", async () => {
    const { client } = await connect();

    const { tools } = await client.listTools();

    expect(tools.map((t) => t.name).sort()).toEqual(["deploy_workload", "detect_drift", "get_audit_log", "plan_change", "request_apply"]);
  });

  it("rejects malformed intents before anything is planned", async () => {
    const { client, world } = await connect();

    const result = await client.callTool({
      name: "plan_change",
      arguments: { kind: "vm", name: "Bad Name!", environment: "dev", instanceType: "t3.small", owner: "data" },
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toMatch(/lowercase letters/);
    expect(await world.ports.audit.list()).toEqual([]);
  });

  it("tells the agent why a request was refused instead of failing silently", async () => {
    const { client } = await connect(createFakeWorld({ violations: ["SSH open to 0.0.0.0/0"] }));
    const planned = await client.callTool({
      name: "plan_change",
      arguments: { kind: "vm", name: "web", environment: "dev", instanceType: "t3.small", owner: "web" },
    });
    const { planId } = JSON.parse((planned.content as { text: string }[])[0]!.text);

    const result = await client.callTool({ name: "request_apply", arguments: { planId } });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toMatch(/denied by policy: SSH open to 0.0.0.0\/0/);
  });

  it("lets the agent check an applied workspace for drift, read-only", async () => {
    const world = createFakeWorld();
    const gateway = createGateway(world.ports);
    const { planId } = await gateway.planChange(
      { kind: "vm", name: "web", environment: "dev", instanceType: "t3.small", owner: "web" },
      "agent:claude",
    );
    await gateway.requestApply(planId, "agent:claude");
    await gateway.approve(planId, "human:jorge");
    world.driftOutsideTofu("web", ["~ aws_instance.vm (t3.small)"]);
    const { client } = await connect(world);

    const { tools } = await client.listTools();
    const result = await client.callTool({ name: "detect_drift", arguments: { name: "web" } });

    expect(tools.find((t) => t.name === "detect_drift")?.annotations?.readOnlyHint).toBe(true);
    expect(JSON.parse((result.content as { text: string }[])[0]!.text)).toEqual({
      name: "web",
      drifted: true,
      changes: ["~ aws_instance.vm (t3.small)"],
    });
    expect(world.applied).toEqual(["plan-1.tfplan"]);
  });

  it("queues a compliant workload for human approval without deploying it", async () => {
    const { client, world } = await connect();

    const result = await client.callTool({
      name: "deploy_workload",
      arguments: { name: "web", namespace: "team-apps", image: "nginx:1.27", replicas: 2, cpu: "250m", memory: "128Mi" },
    });

    expect(JSON.parse((result.content as { text: string }[])[0]!.text)).toMatchObject({
      status: "pending_approval",
      summary: ["+ deployment/team-apps/web (nginx:1.27, 2 replicas)"],
      violations: [],
    });
    expect(world.appliedManifests).toEqual([]);
  });

  it("does not queue a workload that policy denied, and says why", async () => {
    const { client, world } = await connect(createFakeWorld({ violations: ["deployment/team-apps/web: container web must not run privileged"] }));

    const result = await client.callTool({
      name: "deploy_workload",
      arguments: { name: "web", namespace: "team-apps", image: "nginx:1.27", replicas: 1, privileged: true },
    });

    expect(JSON.parse((result.content as { text: string }[])[0]!.text)).toMatchObject({
      status: "denied",
      violations: ["deployment/team-apps/web: container web must not run privileged"],
    });
    expect((await world.ports.audit.list()).map((e) => e.action)).toEqual(["plan_change"]);
  });
});
