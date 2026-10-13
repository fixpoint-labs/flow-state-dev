/**
 * The one delegate check: every add, every delivery and every filing, from
 * the app or a worker's own tool, on any flow, asks it about the record's
 * worker.
 *
 * A worker passes when it is on the session's user's roster now (one of
 * their own, read at their scope, or a standard one), its row can be read,
 * and its flow can take the work: a delegated post for a delivery; a task for
 * a filing or a task's hand-over; a delegated post or a task for an add
 * (FIX-1802 D1). Another user's worker is simply not on this user's roster,
 * so it gets exactly the answer a worker that doesn't exist gets.
 *
 * Removing a delegate and naming the fallback ask only whether the record is
 * on the session's list, so a fired delegate can still be removed. That
 * lives in `delegate-list.ts`, not here.
 *
 * The check answers "is it yours, and can it take this", never "may it run":
 * FIX-1788's create check still links each delegate session at create, and
 * the delegate's own turn still loads its worker.
 *
 * `flowTakes` reads the same two facts about a flow, for `listDelegates` to
 * say what each delegate takes.
 */
import type { FlowType } from "@flow-state-dev/core/types";
import type { RosterWorker, WorkerInstallation, WorkerTurnContext } from "../workers/installation";
import { DELEGATED_POST_ENTRY, takesConversationTasks } from "../worker-task-entry";

/** What the check came to. */
export type DelegateCheck =
  | { readonly ok: true; readonly worker: RosterWorker; readonly takesPost: boolean }
  | { readonly ok: false; readonly message: string };

/** Whether a worker flow declares the delegated-post entry, among its task entries. */
export function takesDelegatedPost(flow: unknown): boolean {
  const actions = (flow as { task?: { actions?: Record<string, unknown> } } | undefined)?.task?.actions;
  return actions !== undefined && Object.hasOwn(actions, DELEGATED_POST_ENTRY);
}

/**
 * Whether a worker flow still declares the delegated-post entry where it used
 * to go, among its internal entries: a coordinator refuses such a delegate
 * flow by name rather than treat it as one that takes no post (BP-030).
 */
export function declaresInternalPostEntry(flow: unknown): boolean {
  const actions = (flow as { internal?: { actions?: Record<string, unknown> } } | undefined)?.internal?.actions;
  return actions !== undefined && Object.hasOwn(actions, DELEGATED_POST_ENTRY);
}

/** What a delegate takes, as `listDelegates` says it. */
export const DELEGATE_TAKES = ["posts", "tasks", "both", "nothing"] as const;

export type DelegateTakes = (typeof DELEGATE_TAKES)[number];

/**
 * What a worker on flow `flowKind` takes, read as the check below reads it: a
 * delegated post when `postFlows` holds the flow, a task when the flow
 * declares a task entry that takes a conversation's tasks (FIX-1842).
 */
export function flowTakes(installation: WorkerInstallation, postFlows: ReadonlySet<string>, flowKind: string): DelegateTakes {
  const post = postFlows.has(flowKind);
  const task = takesConversationTasks(installation.workerFlows()[flowKind]?.flow);
  if (post) return task ? "both" : "posts";
  return task ? "tasks" : "nothing";
}

/**
 * The names of the installation's worker flows that take a delegated post,
 * read now: each one that declares {@link DELEGATED_POST_ENTRY}.
 */
export function postTakingFlows(installation: WorkerInstallation): ReadonlySet<string> {
  const flows = new Set<string>();
  for (const [flow, entry] of Object.entries(installation.workerFlows())) {
    if (takesDelegatedPost(entry.flow)) flows.add(flow);
  }
  return flows;
}

/**
 * The check, bound to an installation and the flows a delivery can reach.
 *
 * @param installation The worker installation the session's worker runs on.
 * @param postFlows The names of the worker flows that take a delegated post:
 *   the ones a coordinator can dispatch to. Omitted, every worker flow on the
 *   installation that declares the delegated-post entry, read per check.
 */
export function createDelegateCheck(installation: WorkerInstallation, postFlows?: ReadonlySet<string>) {
  /**
   * Check `workerId` for `use`.
   *
   * @param ctx A block context that declares the installation's resources.
   * @param use `add` for a change to the list; `post` for a delivery; `task`
   *   for a filing or a task's hand-over (FIX-1794).
   */
  return async (ctx: WorkerTurnContext, workerId: string, use: "add" | "post" | "task"): Promise<DelegateCheck> => {
    const worker = await installation.rosterWorker(ctx, workerId);
    const posts = postFlows ?? postTakingFlows(installation);
    if (worker === undefined) return { ok: false, message: `No worker "${workerId}" on your roster.` };
    if (worker.problem !== undefined) {
      return { ok: false, message: `Worker "${workerId}" can't be a delegate: ${worker.problem}.` };
    }
    const takesPost = posts.has(worker.flow);
    const flow = (installation.workerFlows()[worker.flow]?.flow ?? undefined) as FlowType<any, any> | undefined;
    if (use === "task") {
      return takesConversationTasks(flow)
        ? { ok: true, worker, takesPost }
        : { ok: false, message: `Worker "${workerId}" runs on flow "${worker.flow}", which takes no task.` };
    }
    if (takesPost) return { ok: true, worker, takesPost };
    if (use === "add" && takesConversationTasks(flow)) return { ok: true, worker, takesPost };
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
