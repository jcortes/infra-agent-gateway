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

export type ChangeIntent = z.infer<typeof vmIntent>;
