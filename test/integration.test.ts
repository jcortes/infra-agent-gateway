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

/** Changes a VM behind OpenTofu's back, like someone clicking in the console. */
async function retagOutsideTofu(name: string, owner: string) {
  const ec2 = (params: Record<string, string>) =>
    fetch("http://localhost:4566/", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: "AWS4-HMAC-SHA256 Credential=test/20260101/us-east-1/ec2/aws4_request, SignedHeaders=host, Signature=x",
      },
      body: new URLSearchParams({ Version: "2016-11-15", ...params }),
    }).then((r) => r.text());
  const xml = await ec2({ Action: "DescribeInstances", "Filter.1.Name": "tag:Name", "Filter.1.Value.1": name });
  const instanceId = xml.match(/<instanceId>(i-[^<]+)<\/instanceId>/)?.[1];
  if (!instanceId) throw new Error(`no instance tagged ${name}`);
  await ec2({ Action: "CreateTags", "ResourceId.1": instanceId, "Tag.1.Key": "Owner", "Tag.1.Value": owner });
}

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

  it.skipIf(!localstack)("detects a change made outside OpenTofu after apply", async () => {
    const gw = await gateway();
    const name = unique("drift");
    const { planId } = await gw.planChange({ ...intent, name }, "agent:test");
    await gw.requestApply(planId, "agent:test");
    await gw.approve(planId, "human:test");
    expect(await gw.detectDrift(name, "agent:test")).toMatchObject({ drifted: false, changes: [] });

    await retagOutsideTofu(name, "someone-by-hand");

    expect(await gw.detectDrift(name, "agent:test")).toEqual({ name, drifted: true, changes: ["~ aws_instance.vm (t3.small)"] });
  }, 240_000);
});
