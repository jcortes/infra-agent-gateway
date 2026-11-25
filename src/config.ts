import path from "node:path";
import { fileURLToPath } from "node:url";
import { createConftest } from "./adapters/conftest.js";
import { createFilePlanStore, createJsonlAuditLog } from "./adapters/files.js";
import { createOpenTofu } from "./adapters/opentofu.js";
import { createGateway } from "./gateway.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function createRealGateway(stateDir = process.env.GATEWAY_STATE_DIR ?? path.join(root, ".state")) {
  return createGateway({
    tofu: createOpenTofu({
      moduleDir: path.join(root, "terraform"),
      planDir: path.join(stateDir, "tfplans"),
      awsEndpoint: process.env.AWS_ENDPOINT === "aws" ? null : process.env.AWS_ENDPOINT,
    }),
    policy: createConftest({ policyDir: path.join(root, "policy") }),
    plans: createFilePlanStore(path.join(stateDir, "plans")),
    audit: createJsonlAuditLog(path.join(stateDir, "audit.jsonl")),
    now: () => new Date(),
  });
}
