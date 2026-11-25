import { describe, expect, it } from "vitest";
import { createGateway } from "../src/gateway.js";
import { createFakeWorld } from "./fakes.js";

const devVm = {
  kind: "vm" as const,
  name: "data-sandbox",
  environment: "dev" as const,
  instanceType: "t3.small",
  owner: "data-team",
};

describe("planChange", () => {
  it("plans a compliant change and records it in the audit log", async () => {
    const world = createFakeWorld();
    const gateway = createGateway(world.ports);

    const result = await gateway.planChange(devVm, "agent:claude");

    expect(result.status).toBe("planned");
    expect(result.summary).toEqual(["+ aws_instance.data-sandbox (t3.small)"]);
    expect(await world.ports.audit.list()).toMatchObject([
      { action: "plan_change", actor: "agent:claude", planId: result.planId, outcome: "planned" },
    ]);
  });
});

describe("requestApply", () => {
  it("queues the plan for human approval without applying anything", async () => {
    const world = createFakeWorld();
    const gateway = createGateway(world.ports);
    const { planId } = await gateway.planChange(devVm, "agent:claude");

    const result = await gateway.requestApply(planId, "agent:claude");

    expect(result).toMatchObject({ planId, status: "pending_approval" });
    expect(world.applied).toEqual([]);
  });
});

describe("policy denials", () => {
  it("refuses to queue a plan that failed policy checks", async () => {
    const world = createFakeWorld({ violations: ["aws_instance.data-sandbox: SSH open to 0.0.0.0/0"] });
    const gateway = createGateway(world.ports);
    const { planId, status, violations } = await gateway.planChange(devVm, "agent:claude");

    expect(status).toBe("denied");
    expect(violations).toEqual(["aws_instance.data-sandbox: SSH open to 0.0.0.0/0"]);
    await expect(gateway.requestApply(planId, "agent:claude")).rejects.toThrow(/denied by policy/);
  });
});

describe("approve", () => {
  it("applies exactly the reviewed plan and records who approved it", async () => {
    const world = createFakeWorld();
    const gateway = createGateway(world.ports);
    const { planId } = await gateway.planChange(devVm, "agent:claude");
    await gateway.requestApply(planId, "agent:claude");

    const result = await gateway.approve(planId, "human:jorge");

    expect(result.status).toBe("applied");
    expect(world.applied).toEqual(["plan-1.tfplan"]);
    expect((await world.ports.audit.list()).at(-1)).toMatchObject({
      action: "approve",
      actor: "human:jorge",
      planId,
      outcome: "applied",
    });
  });
});

describe("approval guardrails", () => {
  it("refuses to apply a plan whose file changed after review", async () => {
    const world = createFakeWorld();
    const gateway = createGateway(world.ports);
    const { planId } = await gateway.planChange(devVm, "agent:claude");
    await gateway.requestApply(planId, "agent:claude");
    world.tamperWith("plan-1.tfplan");

    await expect(gateway.approve(planId, "human:jorge")).rejects.toThrow(/changed since it was reviewed/);
    expect(world.applied).toEqual([]);
  });

  it("refuses to apply a plan that nobody requested to apply", async () => {
    const world = createFakeWorld();
    const gateway = createGateway(world.ports);
    const { planId } = await gateway.planChange(devVm, "agent:claude");

    await expect(gateway.approve(planId, "human:jorge")).rejects.toThrow(/not pending approval/);
    expect(world.applied).toEqual([]);
  });

  it("does not let an agent approve a plan", async () => {
    const world = createFakeWorld();
    const gateway = createGateway(world.ports);
    const { planId } = await gateway.planChange(devVm, "agent:claude");
    await gateway.requestApply(planId, "agent:claude");

    await expect(gateway.approve(planId, "agent:claude")).rejects.toThrow(/only a human can approve/);
    expect(world.applied).toEqual([]);
  });
});

describe("detectDrift", () => {
  it("reports drift between the last applied intent and the real infrastructure", async () => {
    const world = createFakeWorld();
    const gateway = createGateway(world.ports);
    const { planId } = await gateway.planChange(devVm, "agent:claude");
    await gateway.requestApply(planId, "agent:claude");
    await gateway.approve(planId, "human:jorge");
    world.driftOutsideTofu("data-sandbox", ["~ aws_instance.vm (t3.small)"]);

    const result = await gateway.detectDrift("data-sandbox", "agent:claude");

    expect(result).toEqual({ name: "data-sandbox", drifted: true, changes: ["~ aws_instance.vm (t3.small)"] });
  });

  it("records each drift check in the audit log", async () => {
    const world = createFakeWorld();
    const gateway = createGateway(world.ports);
    const { planId } = await gateway.planChange(devVm, "agent:claude");
    await gateway.requestApply(planId, "agent:claude");
    await gateway.approve(planId, "human:jorge");

    await gateway.detectDrift("data-sandbox", "agent:claude");

    expect((await world.ports.audit.list()).at(-1)).toMatchObject({
      action: "detect_drift",
      actor: "agent:claude",
      planId,
      outcome: "in_sync",
    });
  });

  it("refuses to check a workspace with nothing applied, even if plans are pending", async () => {
    const world = createFakeWorld();
    const gateway = createGateway(world.ports);
    const { planId } = await gateway.planChange(devVm, "agent:claude");
    await gateway.requestApply(planId, "agent:claude");

    await expect(gateway.detectDrift("data-sandbox", "agent:claude")).rejects.toThrow(/Nothing has been applied to data-sandbox/);
  });
});
