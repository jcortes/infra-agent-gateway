import type { AuditEntry, AuditLog, PlanRecord, PlanStore } from "../ports.js";

export const newestApplied = (records: PlanRecord[], name: string) =>
  records
    .filter((r) => r.status === "applied" && r.intent.name === name)
    .sort((a, b) => (a.appliedAt ?? "").localeCompare(b.appliedAt ?? ""))
    .at(-1);

export function createMemoryPlanStore(): PlanStore {
  const records = new Map<string, PlanRecord>();
  return {
    async save(record) {
      records.set(record.planId, structuredClone(record));
    },
    async get(planId) {
      const record = records.get(planId);
      return record && structuredClone(record);
    },
    async latestApplied(name) {
      const record = newestApplied([...records.values()], name);
      return record && structuredClone(record);
    },
  };
}

export function createMemoryAuditLog(): AuditLog {
  const entries: AuditEntry[] = [];
  return {
    async append(entry) {
      entries.push(structuredClone(entry));
    },
    async list(limit) {
      return structuredClone(limit ? entries.slice(-limit) : entries);
    },
  };
}
