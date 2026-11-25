import type { ChangeIntent } from "./intent.js";

export type PlanArtifact = {
  /** Path to the saved plan, applied later exactly as reviewed. */
  planFile: string;
  /** `tofu show -json` output, what the policies evaluate. */
  planJson: unknown;
  /** One human-readable line per resource change. */
  summary: string[];
};

export interface Tofu {
  plan(intent: ChangeIntent): Promise<PlanArtifact>;
  readPlanBytes(planFile: string): Promise<string>;
  apply(planFile: string): Promise<{ output: string }>;
  /** Re-plans `intent` against real infrastructure; read-only. */
  detectDrift(intent: ChangeIntent): Promise<{ drifted: boolean; changes: string[] }>;
}

export interface PolicyEngine {
  evaluate(planJson: unknown): Promise<{ violations: string[] }>;
}

export type PlanStatus = "planned" | "denied" | "pending_approval" | "applied" | "rejected";

export type PlanRecord = {
  planId: string;
  intent: ChangeIntent;
  planFile: string;
  planHash: string;
  summary: string[];
  violations: string[];
  status: PlanStatus;
  requestedBy: string;
  appliedAt?: string;
};

export interface PlanStore {
  save(record: PlanRecord): Promise<void>;
  get(planId: string): Promise<PlanRecord | undefined>;
  /** The most recently applied plan for workspace `name`. */
  latestApplied(name: string): Promise<PlanRecord | undefined>;
}

export type AuditEntry = {
  at: string;
  action: string;
  actor: string;
  planId?: string;
  outcome: string;
  detail?: unknown;
};

export interface AuditLog {
  append(entry: AuditEntry): Promise<void>;
  list(limit?: number): Promise<AuditEntry[]>;
}

export type GatewayPorts = {
  tofu: Tofu;
  policy: PolicyEngine;
  plans: PlanStore;
  audit: AuditLog;
  now: () => Date;
};
