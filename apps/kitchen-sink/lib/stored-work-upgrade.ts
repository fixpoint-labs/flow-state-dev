/**
 * The workforce's one-off upgrade of what an earlier version stored, run once
 * per process before the first router is built (which starts the durability
 * sweep), so no wake fires before it is owed: `backfillBoardWakes`, which gives
 * a board debt stored before debts had wakes one.
 *
 * It is idempotent: a second process, or a later start, finds nothing.
 *
 * A failed upgrade fails the start: every `getRouter()` and `ready()` rejects
 * with it, so the host refuses to serve records it can't resume, as Shift
 * Manager's `openLab` does.
 */
import { resolveUserStorageKey, type FlowState } from "@flow-state-dev/engine";
import { backfillBoardWakes } from "@flow-state-dev/workforce";

/**
 * `flowstate`, with the upgrade run before its first `getRouter()` or
 * `ready()`. Every other property is the flowstate's own.
 *
 * @param flowstate The app's FlowState.
 */
export function afterStoredWorkUpgrade<T extends FlowState>(flowstate: T): T {
  let upgraded: Promise<void> | undefined;
  const upgrade = (): Promise<void> =>
    (upgraded ??= (async () => {
      const runtime = await flowstate.getRuntime();
      await backfillBoardWakes(runtime.stores, {
        userCell: (userId, orgId) => resolveUserStorageKey(userId, orgId, { id: "", isolateUserState: false }),
      });
    })());
  return new Proxy(flowstate, {
    get(target, key) {
      if (key === "getRouter") return async () => (await upgrade(), target.getRouter());
      if (key === "ready") return async () => (await upgrade(), target.ready());
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
