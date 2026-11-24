/**
 * Control `optimistic-interrupt`: Interrupt aborts nothing.
 *
 * Built into the control page in place of `src/lib/workforce.ts`. The
 * workforce client's `stopRun` answers at once and never calls the abort
 * route, so the run goes on and its record never reads `aborted`. The goal
 * must fail at "the request reads aborted first".
 */
import { useMemo } from "react";
import { useWorkforce as useRealWorkforce } from "../../../../packages/shift-manager/src/lib/workforce.ts";

export * from "../../../../packages/shift-manager/src/lib/workforce.ts";

export function useWorkforce() {
  const real = useRealWorkforce();
  return useMemo(() => ({ ...real, stopRun: async () => undefined }), [real]);
}
