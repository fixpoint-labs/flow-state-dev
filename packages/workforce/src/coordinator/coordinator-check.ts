/**
 * The one delegate check: every add and every delivery, from the app or the
 * coordinator's own tool, asks it about the record's worker.
 *
 * A worker passes when it is on the conversation's user's roster now (one of
 * their own, read at their scope, or a standard one), its row can be read,
 * and its flow can take the work: a delegated post for a delivery; a
 * delegated post or a task for an add (FIX-1802 D1). Another user's worker is
 * simply not on this user's roster, so it gets exactly the answer a worker
 * that doesn't exist gets.
 *
 * Removing a delegate and naming the fallback ask only whether the record is
 * on the conversation's list, so a fired delegate can still be removed. That
 * lives in `coordinator-delegates.ts`, not here.
 *
 * The check answers "is it yours, and can it take this", never "may it run":
 * FIX-1788's create check still links each delegate session at create, and
 * the delegate's own turn still loads its worker.
 */
import type { FlowType } from "@flow-state-dev/core/types";
import type { RosterWorker, WorkerInstallation, WorkerTurnContext } from "../workers/installation";
import { WORKER_TASK_ENTRY } from "../worker-task-entry";
import { DELEGATED_POST_ENTRY } from "./coordinator-keys";

/** What the check came to. */
export type DelegateCheck =
  | { readonly ok: true; readonly worker: RosterWorker; readonly takesPost: boolean }
  | { readonly ok: false; readonly message: string };

/** Whether a worker flow declares the delegated-post entry. */
export function takesDelegatedPost(flow: unknown): boolean {
  const internal = (flow as { internal?: { actions?: Record<string, unknown> } } | undefined)?.internal;
  return internal?.actions !== undefined && Object.hasOwn(internal.actions, DELEGATED_POST_ENTRY);
}

/** Whether a worker flow declares the worker task entry. */
function takesTask(flow: unknown): boolean {
  const task = (flow as { task?: { actions?: Record<string, unknown> } } | undefined)?.task;
  return task?.actions !== undefined && Object.hasOwn(task.actions, WORKER_TASK_ENTRY);
}

/**
 * The check, bound to an installation and the flows a delivery can reach.
 *
 * @param installation The worker installation the coordinator runs on.
 * @param postFlows The kinds of the worker flows that take a delegated post,
 *   which the coordinator can dispatch to.
 */
export function createDelegateCheck(installation: WorkerInstallation, postFlows: ReadonlySet<string>) {
  /**
   * Check `workerId` for `use`.
   *
   * @param ctx A block context that declares the installation's resources.
   * @param use `add` for a change to the list; `post` for a delivery.
   */
  return async (ctx: WorkerTurnContext, workerId: string, use: "add" | "post"): Promise<DelegateCheck> => {
    const worker = await installation.rosterWorker(ctx, workerId);
    if (worker === undefined) return { ok: false, message: `No worker "${workerId}" on your roster.` };
    if (worker.problem !== undefined) {
      return { ok: false, message: `Worker "${workerId}" can't be a delegate: ${worker.problem}.` };
    }
    const takesPost = postFlows.has(worker.flow);
    if (takesPost) return { ok: true, worker, takesPost };
    const flow = (installation.workerFlows()[worker.flow]?.flow ?? undefined) as FlowType<any, any> | undefined;
    if (use === "add" && takesTask(flow)) return { ok: true, worker, takesPost };
    return {
      ok: false,
      message:
        use === "add"
          ? `Worker "${workerId}" runs on flow "${worker.flow}", which takes neither a delegated post nor a task.`
          : `Worker "${workerId}" runs on flow "${worker.flow}", which can't take a delegated post.`
    };
  };
}

export type DelegateChecker = ReturnType<typeof createDelegateCheck>;
