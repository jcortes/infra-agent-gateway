import type { GatewayPorts, PlanArtifact, Tofu, PolicyEngine } from "../src/ports.js";
import { createMemoryAuditLog, createMemoryPlanStore } from "../src/adapters/memory.js";
import type { ChangeIntent } from "../src/intent.js";

/**
 * Fake stand-ins for the external CLIs (OpenTofu, Conftest). The in-memory
 * stores are the real in-memory adapters, not fakes.
 */
export function createFakeWorld(options: { violations?: string[] } = {}) {
  const applied: string[] = [];
  const planFiles = new Map<string, string>();
  let counter = 0;

  const tofu: Tofu = {
    async plan(intent: ChangeIntent): Promise<PlanArtifact> {
      const planFile = `plan-${++counter}.tfplan`;
      const bytes = JSON.stringify(intent);
      planFiles.set(planFile, bytes);
      return {
        planFile,
        planJson: { resource_changes: [{ address: `aws_instance.${intent.name}`, intent }] },
        summary: [`+ aws_instance.${intent.name} (${intent.instanceType})`],
      };
    },
    async readPlanBytes(planFile) {
      return planFiles.get(planFile) ?? "";
    },
    async apply(planFile) {
      applied.push(planFile);
      return { output: `Apply complete: ${planFile}` };
    },
  };

  const policy: PolicyEngine = {
    async evaluate() {
      return { violations: options.violations ?? [] };
    },
  };

  const ports: GatewayPorts = {
    tofu,
    policy,
    plans: createMemoryPlanStore(),
    audit: createMemoryAuditLog(),
    now: () => new Date("2026-11-28T10:00:00Z"),
  };

  return {
    ports,
    applied,
    /** Simulates someone swapping the plan file after it was reviewed. */
    tamperWith(planFile: string) {
      planFiles.set(planFile, "tampered");
    },
  };
}
