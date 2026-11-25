// Real OpenTofu + Conftest. Apply additionally needs LocalStack:
//   docker run -d --name localstack -p 4566:4566 localstack/localstack:4
// Run with: INTEGRATION=1 pnpm test test/integration.test.ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createRealGateway } from "../src/config.js";

const enabled = process.env.INTEGRATION === "1";
const localstack = await fetch("http://localhost:4566/_localstack/health").then((r) => r.ok, () => false);
const unique = (base: string) => `${base}-${Date.now().toString(36)}`;

describe.skipIf(!enabled)("integration: real OpenTofu and Conftest", () => {
  const gateway = async () => createRealGateway(await mkdtemp(path.join(tmpdir(), "iag-")));
  const intent = { kind: "vm" as const, environment: "dev" as const, instanceType: "t3.small", owner: "data-team" };

  it("plans a compliant VM", async () => {
    const result = await (await gateway()).planChange({ ...intent, name: unique("ok") }, "agent:test");

    expect(result.violations).toEqual([]);
    expect(result.status).toBe("planned");
    expect(result.summary).toContain("+ aws_instance.vm (t3.small)");
  }, 120_000);

  it("denies a VM with SSH open to the internet, from the real plan JSON", async () => {
    const result = await (await gateway()).planChange({ ...intent, name: unique("ssh"), sshCidr: "0.0.0.0/0" }, "agent:test");

    expect(result.status).toBe("denied");
    expect(result.violations).toEqual(["aws_security_group.vm: SSH open to 0.0.0.0/0"]);
  }, 120_000);

  it("denies prod and oversized instances together", async () => {
    const result = await (await gateway()).planChange(
      { ...intent, name: unique("big"), environment: "prod", instanceType: "m5.24xlarge" },
      "agent:test",
    );

    expect(result.violations).toEqual(
      expect.arrayContaining([
        "aws_instance.vm: agents cannot change prod; open a PR instead",
        "aws_instance.vm: instance type m5.24xlarge is not allowed (allowed: t3.micro, t3.small, t3.medium)",
      ]),
    );
  }, 120_000);

  it.skipIf(!localstack)("applies an approved plan on LocalStack", async () => {
    const gw = await gateway();
    const { planId } = await gw.planChange({ ...intent, name: unique("apply") }, "agent:test");
    await gw.requestApply(planId, "agent:test");

    const result = await gw.approve(planId, "human:test");

    expect(result.status).toBe("applied");
    expect(result.output).toMatch(/Apply complete! Resources: 2 added/);
  }, 180_000);
});
