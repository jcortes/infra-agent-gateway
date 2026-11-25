import { createHash, randomUUID } from "node:crypto";
import type { ChangeIntent } from "./intent.js";
import type { GatewayPorts } from "./ports.js";

export function createGateway(ports: GatewayPorts) {
  const { tofu, policy, plans, audit, now } = ports;

  const sha256 = (data: string) => createHash("sha256").update(data).digest("hex");

  return {
    async planChange(intent: ChangeIntent, actor: string) {
      const artifact = await tofu.plan(intent);
      const { violations } = await policy.evaluate(artifact.planJson);
      const planId = randomUUID();
      const status = violations.length === 0 ? "planned" : "denied";

      await plans.save({
        planId,
        intent,
        planFile: artifact.planFile,
        planHash: sha256(await tofu.readPlanBytes(artifact.planFile)),
        summary: artifact.summary,
        violations,
        status,
        requestedBy: actor,
      });
      await audit.append({
        at: now().toISOString(),
        action: "plan_change",
        actor,
        planId,
        outcome: status,
        detail: { summary: artifact.summary, violations },
      });

      return { planId, status, summary: artifact.summary, violations };
    },

    async requestApply(planId: string, actor: string) {
      const record = await plans.get(planId);
      if (!record) throw new Error(`Unknown plan ${planId}`);
      if (record.status === "denied") {
        throw new Error(`Plan ${planId} was denied by policy: ${record.violations.join("; ")}`);
      }

      record.status = "pending_approval";
      await plans.save(record);
      await audit.append({ at: now().toISOString(), action: "request_apply", actor, planId, outcome: record.status });

      return { planId, status: record.status };
    },

    async approve(planId: string, approver: string) {
      const record = await plans.get(planId);
      if (!record) throw new Error(`Unknown plan ${planId}`);
      if (!approver.startsWith("human:")) {
        throw new Error(`Plan ${planId}: only a human can approve an apply (got ${approver})`);
      }
      if (record.status !== "pending_approval") {
        throw new Error(`Plan ${planId} is ${record.status}, not pending approval`);
      }
      if (sha256(await tofu.readPlanBytes(record.planFile)) !== record.planHash) {
        await audit.append({ at: now().toISOString(), action: "approve", actor: approver, planId, outcome: "blocked_tampered" });
        throw new Error(`Plan ${planId} changed since it was reviewed; re-plan before applying`);
      }

      const { output } = await tofu.apply(record.planFile);
      record.status = "applied";
      record.appliedAt = now().toISOString();
      await plans.save(record);
      await audit.append({ at: now().toISOString(), action: "approve", actor: approver, planId, outcome: record.status, detail: { output } });

      return { planId, status: record.status, output };
    },

    async detectDrift(name: string, actor: string) {
      const applied = await plans.latestApplied(name);
      if (!applied) throw new Error(`Nothing has been applied to ${name}, so there is no drift to detect`);
      const { drifted, changes } = await tofu.detectDrift(applied.intent);
      await audit.append({
        at: now().toISOString(),
        action: "detect_drift",
        actor,
        planId: applied.planId,
        outcome: drifted ? "drifted" : "in_sync",
        detail: { changes },
      });
      return { name, drifted, changes };
    },

    async getPlan(planId: string) {
      return plans.get(planId);
    },

    async auditLog(limit?: number) {
      return audit.list(limit);
    },
  };
}

export type Gateway = ReturnType<typeof createGateway>;
