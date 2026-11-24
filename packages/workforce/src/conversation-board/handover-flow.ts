// FIX-2894.
/**
 * The flow a hand-over gives a task to, read once per hand-over. A hand-over
 * asks twice: for the flow whose `work` entry it dispatches to (the
 * address's `flowKind`) and for the flow it writes on the session it opens
 * (`taskFlow`, in the address's `state`). Both now come from one read of the
 * session's delegates, keyed by the request, the task and its worker, so a
 * roster that moves between the two asks can't make them disagree. The
 * claim's own check (the running entry is the authority) stays behind it.
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import type { TaskDelegates } from "../delegates/worker-delegates";

/** What one read of the delegates says about a task's worker. */
export interface HandedFlow {
  readonly flow: string | undefined;
  readonly unavailable: string | undefined;
}

/**
 * The flow a hand-over gives `taskId` to, or the hand-over refused by name:
 * no session is born without the flow it was handed to.
 */
export function handedFlowOrRefuse(handed: HandedFlow, taskId: string, assignee: string): string {
  if (handed.flow !== undefined) return handed.flow;
  throw new Error(`Task "${taskId}" wasn't handed to "${assignee}": ${handed.unavailable ?? "it isn't one of this session's delegates"}.`);
}

/**
 * A reader of the flow each hand-over gives a task to, over `reach`.
 *
 * @param reach The running session's delegates, read now.
 */
export function handoverFlowReader(reach: (ctx: BlockContext) => Promise<TaskDelegates>) {
  const reads = new WeakMap<object, Map<string, Promise<HandedFlow>>>();
  return (ctx: BlockContext, taskId: string, assignee: string): Promise<HandedFlow> => {
    const scope = ((ctx as { request?: object }).request ?? ctx) as object;
    let byTask = reads.get(scope);
    if (byTask === undefined) reads.set(scope, (byTask = new Map()));
    const key = JSON.stringify([taskId, assignee]);
    let read = byTask.get(key);
    if (read === undefined) {
      read = reach(ctx).then((delegates) => ({ flow: delegates.available.get(assignee), unavailable: delegates.unavailable.get(assignee) }));
      byTask.set(key, read);
    }
    return read;
  };
}
