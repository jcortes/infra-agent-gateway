import { z } from "zod";

/** A structured request for infrastructure. Agents never send raw HCL. */
export const vmIntent = z.object({
  kind: z.literal("vm"),
  name: z.string().regex(/^[a-z][a-z0-9-]{2,30}$/, "lowercase letters, digits and dashes, 3-31 chars"),
  environment: z.enum(["dev", "staging", "prod"]),
  instanceType: z.string(),
  owner: z.string().min(1),
  sshCidr: z.string().optional(),
});

/** A Deployment on Kubernetes. The gateway renders the manifest; agents never send YAML. */
export const workloadIntent = z.object({
  kind: z.literal("workload"),
  name: vmIntent.shape.name,
  namespace: z.string().regex(/^[a-z][a-z0-9-]{0,62}$/),
  image: z.string().min(1),
  replicas: z.number().int().min(1).max(10),
  cpu: z.string().optional(),
  memory: z.string().optional(),
  privileged: z.boolean().optional(),
});

export type VmIntent = z.infer<typeof vmIntent>;
export type WorkloadIntent = z.infer<typeof workloadIntent>;
export type ChangeIntent = VmIntent | WorkloadIntent;
