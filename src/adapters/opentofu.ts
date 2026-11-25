import { mkdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { ChangeIntent } from "../intent.js";
import type { PlanArtifact, Tofu } from "../ports.js";
import { exec } from "./exec.js";

type ResourceChange = { address: string; type: string; change: { actions: string[]; after?: Record<string, unknown> | null } };

const symbol: Record<string, string> = { create: "+", delete: "-", update: "~", "no-op": "=" };

/** Runs the `tofu` CLI against `moduleDir`, one workspace per intent name. */
export function createOpenTofu(options: { moduleDir: string; planDir: string; awsEndpoint?: string | null }): Tofu {
  const { moduleDir, planDir } = options;
  const tofu = (args: string[]) => exec("tofu", args, { cwd: moduleDir });
  let initialized: Promise<unknown> | undefined;

  const selectWorkspace = async (name: string) => {
    await (initialized ??= tofu(["init", "-input=false", "-no-color"]));
    await tofu(["workspace", "select", "-or-create", name]);
  };

  return {
    async plan(intent: ChangeIntent): Promise<PlanArtifact> {
      await selectWorkspace(intent.name);
      const dir = path.join(planDir, intent.name);
      await mkdir(dir, { recursive: true });
      const planFile = path.join(dir, `${randomUUID()}.tfplan`);

      const vars: Record<string, string | undefined> = {
        name: intent.name,
        environment: intent.environment,
        instance_type: intent.instanceType,
        owner: intent.owner,
        ssh_cidr: intent.sshCidr,
      };
      const varArgs = Object.entries(vars)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `-var=${k}=${v}`);
      if (options.awsEndpoint === null) varArgs.push("-var=aws_endpoint=null");
      else if (options.awsEndpoint) varArgs.push(`-var=aws_endpoint=${options.awsEndpoint}`);

      await tofu(["plan", "-input=false", "-no-color", `-out=${planFile}`, ...varArgs]);
      const { stdout } = await tofu(["show", "-json", planFile]);
      const planJson = JSON.parse(stdout) as { resource_changes?: ResourceChange[] };

      const summary = (planJson.resource_changes ?? [])
        .filter((rc) => !rc.change.actions.includes("no-op"))
        .map((rc) => {
          const action = rc.change.actions.map((a) => symbol[a] ?? a).join("/");
          const type = rc.change.after?.instance_type;
          return `${action} ${rc.address}${type ? ` (${type})` : ""}`;
        });

      return { planFile, planJson, summary: summary.length ? summary : ["no changes"] };
    },

    async readPlanBytes(planFile) {
      return (await readFile(planFile)).toString("base64");
    },

    async apply(planFile) {
      // Plans live in <planDir>/<workspace>/<id>.tfplan.
      await selectWorkspace(path.basename(path.dirname(planFile)));
      const { stdout } = await tofu(["apply", "-input=false", "-no-color", planFile]);
      return { output: stdout.trim().split("\n").slice(-6).join("\n") };
    },
  };
}
