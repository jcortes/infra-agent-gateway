// Human approval, deliberately outside the MCP server: `pnpm approve <planId>`.
import { userInfo } from "node:os";
import { createInterface } from "node:readline/promises";
import { createRealGateway } from "../config.js";

const planId = process.argv[2];
if (!planId) {
  console.error("usage: pnpm approve <planId>");
  process.exit(2);
}

const gateway = createRealGateway();
const plan = await gateway.getPlan(planId);
if (!plan) {
  console.error(`Unknown plan ${planId}`);
  process.exit(1);
}

console.log(`Plan ${planId}  requested by ${plan.requestedBy}  status ${plan.status}\n`);
console.log(plan.summary.map((l) => `  ${l}`).join("\n") + "\n");

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question("Apply this plan? Type 'yes' to approve: ");
rl.close();
if (answer.trim() !== "yes") {
  console.log("Not approved.");
  process.exit(1);
}

const result = await gateway.approve(planId, `human:${userInfo().username}`);
console.log(`\n${result.output}`);
