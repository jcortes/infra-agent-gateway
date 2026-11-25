import type { PolicyEngine } from "../ports.js";
import { exec } from "./exec.js";

type ConftestResult = { failures?: { msg: string }[] };

/** Evaluates plan JSON with `conftest test` against the Rego in `policyDir`. */
export function createConftest(options: { policyDir: string }): PolicyEngine {
  return {
    async evaluate(planJson) {
      const { stdout } = await exec(
        "conftest",
        ["test", "--policy", options.policyDir, "--output", "json", "--parser", "json", "-"],
        { input: JSON.stringify(planJson), okExitCodes: [1] }, // exit 1 = policy failures
      );
      const results = JSON.parse(stdout) as ConftestResult[];
      return { violations: results.flatMap((r) => (r.failures ?? []).map((f) => f.msg)) };
    },
  };
}
