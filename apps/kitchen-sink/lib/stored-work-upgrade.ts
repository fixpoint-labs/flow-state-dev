/**
 * The workforce's one-off upgrades of what an earlier version stored, run once
 * per process before the first router is built (which starts the durability
 * sweep), so no wake fires before it is owed or renamed:
 *
 * - `backfillBoardWakes`: a board debt stored before debts had wakes gets one.
 * - `upgradeWorkerEntryNames`: a request left unfinished under a worker's old
 *   door (`run`), and a request or wake under the board's old pass
 *   (`runTaskBoard`), resume under `respond` and `dispatch`.
 *
 * Both are idempotent: a second process, or a later start, finds nothing.
 *
 * A failed upgrade fails the start: every `getRouter()` and `ready()` rejects
 * with it, so the host refuses to serve records it can't resume, as Shift
 * Manager's `openLab` does.
 */
import { resolveRequestIncarnation, resolveUserStorageKey, type FlowState } from "@flow-state-dev/engine";
import { backfillBoardWakes, upgradeWorkerEntryNames, type EntryNameFlow } from "@flow-state-dev/workforce";

/**
 * `flowstate`, with the upgrades run before its first `getRouter()` or
 * `ready()`. Every other property is the flowstate's own.
 *
 * @param flowstate The app's FlowState.
 * @param copies The workforce's registered copies (`hireWorkforce`'s answer).
 */
export function afterStoredWorkUpgrade<T extends FlowState>(flowstate: T, copies: readonly EntryNameFlow[]): T {
  let upgraded: Promise<void> | undefined;
  const upgrade = (): Promise<void> =>
    (upgraded ??= (async () => {
      const runtime = await flowstate.getRuntime();
      await backfillBoardWakes(runtime.stores, {
        userCell: (userId, orgId) => resolveUserStorageKey(userId, orgId, { id: "", isolateUserState: false }),
      });
      await upgradeWorkerEntryNames(runtime.stores, copies, { incarnationOf: resolveRequestIncarnation });
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
