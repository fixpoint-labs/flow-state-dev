/**
 * Where the harness seeds a user's data: the cell the run under test reads.
 * Not on the public `@flow-state-dev/testing` index — `testFlow` and
 * `createTestContext` both seed through it.
 *
 * The engine decides a key's owner inside `createExecutionContext`, with no
 * export to call, so this applies the same rules from the same public helpers
 * (`resourceStorageKeys`, `getPatternPrefix`): an exact single wins outright,
 * otherwise the longest matching collection prefix. The parity test in
 * `test/harness-user-cell.test.ts` runs both over one declaration matrix, so a
 * drift fails it.
 */
import { resolveUserStorageKey } from "@flow-state-dev/engine";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { getPatternPrefix, isCollectionConfig, resourceStorageKeys } from "@flow-state-dev/core/types";

type UserDeclaration = { scope?: string; flowIsolation?: boolean; pattern?: string };

/**
 * The `flowIsolation` of the user-scoped declaration that owns `storageKey`,
 * or `undefined` when none does.
 */
function owningIsolation(flow: FlowInstance, storageKey: string): boolean | undefined {
  const all = (flow.resources ?? {}) as Record<string, UserDeclaration>;
  const user: Record<string, UserDeclaration> = {};
  for (const [accessor, config] of Object.entries(all)) {
    if (config?.scope === "user") user[accessor] = config;
  }
  const canonical = resourceStorageKeys(user);
  let best: { length: number; isolation: boolean | undefined } | undefined;
  for (const [accessor, config] of Object.entries(user)) {
    if (!isCollectionConfig(config)) {
      if ((canonical[accessor] ?? accessor) === storageKey) return config.flowIsolation ?? flow.isolateUserState;
      continue;
    }
    const raw = getPatternPrefix(config.pattern as string);
    const prefix = raw === "" ? "" : `${raw}/`;
    if ((prefix === "" || storageKey.startsWith(prefix)) && (best === undefined || prefix.length > best.length)) {
      best = { length: prefix.length, isolation: config.flowIsolation ?? flow.isolateUserState };
    }
  }
  return best?.isolation;
}

/**
 * The storage key a seeded user record or user resource lives at: the user's
 * cell in the run's org, plus the flow when the data is flow-isolated, from
 * the engine's own derivation. The owning declaration's `flowIsolation` wins
 * over the flow's `isolateUserState`, as it does at run time; an undeclared
 * key follows the flow.
 *
 * @param resourceKey The seeded resource's storage key, or `undefined` for the
 *   user record itself.
 */
export function userSeedCell(
  flow: FlowInstance,
  userId: string,
  orgId: string,
  resourceKey?: string
): string {
  const isolated =
    (resourceKey === undefined ? undefined : owningIsolation(flow, resourceKey)) ??
    flow.isolateUserState === true;
  return resolveUserStorageKey(userId, orgId, { id: flow.id, isolateUserState: isolated });
}
