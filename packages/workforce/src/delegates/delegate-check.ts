/**
 * The one delegate check: every add, every routed task and every filing,
 * from the app or a worker's own tool, on any flow, asks it about the
 * record's worker.
 *
 * A worker passes when it is on the session's user's roster now (one of
 * their own, read at their scope, or a standard one), its row can be read,
 * and its flow declares the `contributor` role: that is what makes a worker
 * a delegate, for an add, a routed message or a filing alike (FIX-2083). The
 * hire guarantees the entry behind the role, a `work` built by
 * `workerTaskEntry` that takes a conversation's tasks (FIX-1842). Another
 * user's worker is simply not on this user's roster, so it gets exactly the
 * answer a worker that doesn't exist gets.
 *
 * Removing a delegate and naming the fallback ask only whether the record is
 * on the session's list, so a fired delegate can still be removed. That
 * lives in `delegate-list.ts`, not here.
 *
 * The check answers "is it yours, and can it take this", never "may it run":
 * FIX-1788's create check still links each delegate session at create, and
 * the delegate's own turn still loads its worker.
 *
 * `flowTakes` reads the same fact about a flow, for `listDelegates` to say
 * what each delegate takes.
 */
import type { RosterWorker, WorkerInstallation, WorkerTurnContext } from "../workers/installation";
import { takesTasks } from "../worker-roles";

/** What the check came to. */
export type DelegateCheck =
  | { readonly ok: true; readonly worker: RosterWorker }
  | { readonly ok: false; readonly message: string };

/** What a delegate takes, as `listDelegates` says it. */
export const DELEGATE_TAKES = ["tasks", "nothing"] as const;

export type DelegateTakes = (typeof DELEGATE_TAKES)[number];

/**
 * What a worker on flow `flowKind` takes, read as the check below reads it: a
 * task when the flow declares the `contributor` role.
 */
export function flowTakes(installation: WorkerInstallation, flowKind: string): DelegateTakes {
  return takesTasks(installation.workerFlows()[flowKind]) ? "tasks" : "nothing";
}

/**
 * The check, bound to an installation.
 *
 * @param installation The worker installation the session's worker runs on.
 */
export function createDelegateCheck(installation: WorkerInstallation) {
  /**
   * Check `workerId` for `use`.
   *
   * @param ctx A block context that declares the installation's resources.
   * @param use `add` for a change to the list; `task` for a filing, a routed
   *   message or a task's hand-over (FIX-1794, FIX-2083).
   */
  return async (ctx: WorkerTurnContext, workerId: string, use: "add" | "task"): Promise<DelegateCheck> => {
    const worker = await installation.rosterWorker(ctx, workerId);
    if (worker === undefined) return { ok: false, message: `No worker "${workerId}" on your roster.` };
    if (worker.problem !== undefined) {
      return { ok: false, message: `Worker "${workerId}" can't be a delegate: ${worker.problem}.` };
    }
    if (takesTasks(installation.workerFlows()[worker.flow])) return { ok: true, worker };
    return {
      ok: false,
      message:
        use === "add"
          ? `Worker "${workerId}" runs on flow "${worker.flow}", which takes no task, so it can't be a delegate.`
          : `Worker "${workerId}" runs on flow "${worker.flow}", which takes no task.`
    };
  };
}

export type DelegateChecker = ReturnType<typeof createDelegateCheck>;
