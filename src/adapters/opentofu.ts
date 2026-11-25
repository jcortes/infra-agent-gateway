import { mkdir, readFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { VmIntent } from "../intent.js";
import type { PlanArtifact, Tofu } from "../ports.js";
import { exec } from "./exec.js";

type ResourceChange = { address: string; type: string; change: { actions: string[]; after?: Record<string, unknown> | null } };

const symbol: Record<string, string> = { create: "+", delete: "-", update: "~", "no-op": "=" };

/** Runs the `tofu` CLI against `moduleDir`, one workspace per intent name. */
export function createOpenTofu(options: { moduleDir: string; planDir: string; awsEndpoint?: string | null }): Tofu {
  const { moduleDir, planDir } = options;
  const tofu = (args: string[], okExitCodes?: number[]) => exec("tofu", args, { cwd: moduleDir, okExitCodes });
  let initialized: Promise<unknown> | undefined;

  const selectWorkspace = async (name: string) => {
    await (initialized ??= tofu(["init", "-input=false", "-no-color"]));
    await tofu(["workspace", "select", "-or-create", name]);
  };

  const varArgs = (intent: VmIntent) => {
    const vars: Record<string, string | undefined> = {
      name: intent.name,
      environment: intent.environment,
      instance_type: intent.instanceType,
      owner: intent.owner,
      ssh_cidr: intent.sshCidr,
    };
    const args = Object.entries(vars)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `-var=${k}=${v}`);
    if (options.awsEndpoint === null) args.push("-var=aws_endpoint=null");
    else if (options.awsEndpoint) args.push(`-var=aws_endpoint=${options.awsEndpoint}`);
    return args;
  };

  /** Saves a plan to `planFile`; returns its JSON, its changes and tofu's exit code. */
  const savePlan = async (intent: VmIntent, planFile: string, extraArgs: string[] = []) => {
    await selectWorkspace(intent.name);
    await mkdir(path.dirname(planFile), { recursive: true });
    const { code } = await tofu(["plan", "-input=false", "-no-color", `-out=${planFile}`, ...extraArgs, ...varArgs(intent)], [2]);
    const { stdout } = await tofu(["show", "-json", planFile]);
    const planJson = JSON.parse(stdout) as { resource_changes?: ResourceChange[] };
    const changes = (planJson.resource_changes ?? [])
      .filter((rc) => !rc.change.actions.includes("no-op"))
      .map((rc) => {
        const action = rc.change.actions.map((a) => symbol[a] ?? a).join("/");
        const type = rc.change.after?.instance_type;
        return `${action} ${rc.address}${type ? ` (${type})` : ""}`;
      });
    return { planJson, changes, code };
  };

  return {
    async plan(intent: VmIntent): Promise<PlanArtifact> {
      const planFile = path.join(planDir, intent.name, `${randomUUID()}.tfplan`);
      const { planJson, changes } = await savePlan(intent, planFile);
      return { planFile, planJson, summary: changes.length ? changes : ["no changes"] };
    },

    async detectDrift(intent) {
      // Never applied: lives outside the reviewed-plan directory.
      const planFile = path.join(planDir, ".drift", `${randomUUID()}.tfplan`);
      try {
        const { changes, code } = await savePlan(intent, planFile, ["-detailed-exitcode"]);
        return { drifted: code === 2, changes };
      } finally {
        await rm(planFile, { force: true });
      }
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
