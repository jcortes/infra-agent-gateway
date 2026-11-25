import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AuditEntry, AuditLog, PlanRecord, PlanStore } from "../ports.js";

/** Plans persist on disk because `pnpm approve` runs in a separate process. */
export function createFilePlanStore(dir: string): PlanStore {
  const file = (id: string) => path.join(dir, `${id.replace(/[^a-z0-9-]/gi, "")}.json`);
  return {
    async save(record) {
      await mkdir(dir, { recursive: true });
      const tmp = `${file(record.planId)}.tmp`;
      await writeFile(tmp, JSON.stringify(record, null, 2));
      await rename(tmp, file(record.planId));
    },
    async get(planId) {
      try {
        return JSON.parse(await readFile(file(planId), "utf8")) as PlanRecord;
      } catch {
        return undefined;
      }
    },
  };
}

/** Append-only JSONL: one line per event, never rewritten. */
export function createJsonlAuditLog(file: string): AuditLog {
  return {
    async append(entry) {
      await mkdir(path.dirname(file), { recursive: true });
      await appendFile(file, JSON.stringify(entry) + "\n");
    },
    async list(limit) {
      let lines: string[];
      try {
        lines = (await readFile(file, "utf8")).split("\n").filter(Boolean);
      } catch {
        return [];
      }
      return (limit ? lines.slice(-limit) : lines).map((l) => JSON.parse(l) as AuditEntry);
    },
  };
}
