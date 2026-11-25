import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { WorkloadIntent } from "../intent.js";
import type { Kubernetes } from "../ports.js";
import { exec } from "./exec.js";

/** The Deployment the policies check and `kubectl apply` receives, byte for byte. */
function renderDeployment(intent: WorkloadIntent) {
  const limits = Object.fromEntries(
    Object.entries({ cpu: intent.cpu, memory: intent.memory }).filter(([, v]) => v !== undefined),
  );
  const labels = { app: intent.name, "app.kubernetes.io/managed-by": "infra-agent-gateway" };
  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: intent.name, namespace: intent.namespace, labels },
    spec: {
      replicas: intent.replicas,
      selector: { matchLabels: { app: intent.name } },
      template: {
        metadata: { labels },
        spec: {
          containers: [
            {
              name: intent.name,
              image: intent.image,
              ...(Object.keys(limits).length ? { resources: { limits } } : {}),
              ...(intent.privileged !== undefined ? { securityContext: { privileged: intent.privileged } } : {}),
            },
          ],
        },
      },
    },
  };
}

/**
 * Runs `kubectl` against one pinned context, never the user's current one,
 * so the gateway cannot touch a cluster it wasn't configured for.
 */
export function createKubectl(options: { context: string; planDir: string }): Kubernetes {
  const kubectl = (args: string[]) => exec("kubectl", ["--context", options.context, ...args]);

  return {
    async plan(intent) {
      const manifest = renderDeployment(intent);
      await mkdir(options.planDir, { recursive: true });
      const planFile = path.join(options.planDir, `${randomUUID()}.json`);
      await writeFile(planFile, JSON.stringify(manifest, null, 2));

      const { stdout } = await kubectl(["get", "deployment", intent.name, "-n", intent.namespace, "--ignore-not-found", "-o", "name"]);
      const action = stdout.trim() ? "~" : "+";
      const summary = [`${action} deployment/${intent.namespace}/${intent.name} (${intent.image}, ${intent.replicas} replicas)`];
      return { planFile, planJson: manifest, summary };
    },

    async readPlanBytes(planFile) {
      return (await readFile(planFile)).toString("base64");
    },

    async apply(planFile) {
      const { stdout } = await kubectl(["apply", "-f", planFile]);
      return { output: stdout.trim() };
    },
  };
}
