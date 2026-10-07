/**
 * Where the harness seeds a user's data: the cell the run under test reads.
 * Not on the public `@flow-state-dev/testing` index — `testFlow` and
 * `createTestContext` both seed through it.
 */
import { resolveUserStorageKey } from "@flow-state-dev/engine";
import type { FlowInstance } from "@flow-state-dev/core/types";

/**
 * The storage key a seeded user record or user resource lives at: the user's
 * cell in the run's org, plus the flow when the data is flow-isolated, from
 * the engine's own derivation. A resource's own `flowIsolation` wins over the
 * flow's `isolateUserState`, as it does at run time.
 *
 * @param resourceKey The seeded resource's key, or `undefined` for the user
 *   record itself.
 */
export function userSeedCell(
  flow: FlowInstance,
  userId: string,
  orgId: string,
  resourceKey?: string
): string {
  const declared =
    resourceKey === undefined
      ? undefined
      : (flow.resources as Record<string, { scope?: string; flowIsolation?: boolean }> | undefined)?.[
          resourceKey
        ];
  const isolated =
    declared?.scope === "user" && declared.flowIsolation !== undefined
      ? declared.flowIsolation
      : flow.isolateUserState === true;
  return resolveUserStorageKey(userId, orgId, { id: flow.id, isolateUserState: isolated });
}
