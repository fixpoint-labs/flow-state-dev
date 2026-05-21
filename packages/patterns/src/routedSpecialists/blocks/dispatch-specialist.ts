/**
 * Router that dispatches to the specialist named by the controller's
 * decision. Throws when the name is missing — that's a controller bug,
 * not a runtime condition to swallow. The unregistered-name error is
 * raised by `router.byName` itself with the registered key list.
 */
import { router } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z } from "zod";

export function createDispatchSpecialist(
  name: string,
  specialists: Record<string, BlockDefinition<any, any>>
) {
  return router.byName({
    name: `${name}-dispatch`,
    inputSchema: z.object({
      specialist: z.string().nullable(),
      done: z.boolean(),
      reasoning: z.string(),
    }),
    outputSchema: z.any(),
    blocks: specialists,
    select: (input: { specialist: string | null }) => {
      if (!input.specialist) {
        throw new Error(
          `[routedSpecialists] Controller returned null specialist without done=true in "${name}"`
        );
      }
      return input.specialist;
    },
  });
}
