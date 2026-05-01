/**
 * Router that dispatches to the specialist named by the controller's
 * decision. Throws when the name is missing or unregistered — those are
 * controller bugs, not runtime conditions to swallow.
 */
import { router } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z } from "zod";

export function createDispatchSpecialist(
  name: string,
  specialists: Record<string, BlockDefinition<any, any>>
) {
  return router({
    name: `${name}-dispatch`,
    inputSchema: z.object({
      specialist: z.string().nullable(),
      done: z.boolean(),
      reasoning: z.string(),
    }),
    outputSchema: z.any(),
    routes: Object.values(specialists),
    execute: (input: { specialist: string | null }) => {
      if (!input.specialist) {
        throw new Error(
          `[routedSpecialists] Controller returned null specialist without done=true in "${name}"`
        );
      }
      const target = specialists[input.specialist];
      if (!target) {
        throw new Error(
          `[routedSpecialists] No specialist registered for "${input.specialist}" in "${name}". ` +
            `Available: ${Object.keys(specialists).join(", ")}`
        );
      }
      return target;
    },
  });
}
