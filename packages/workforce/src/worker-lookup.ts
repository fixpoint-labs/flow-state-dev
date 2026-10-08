/**
 * Which worker a name on a task means: the one lookup the hand-over, the
 * filing check and the wake all ask.
 *
 * A task names its worker by id, as `discover` lists it (`eng.coder`). A task
 * on a board is handed to a standard worker: one the installation's files
 * declare, which every user has. The lookup answers with the flow it runs on,
 * whose one registered copy runs it, and the hand-over opens the task's
 * session naming the worker in its starting state, which the flow's create
 * check confirms. A user's own worker isn't handed board tasks: the session
 * would be created by whoever drains the board, who can't name another
 * user's worker.
 *
 * The lookup reads the installation, not a list it booted with, so a worker
 * the files no longer declare stops resolving at the next boot.
 */

import type { BlockContext, TaskFlowTarget, TaskStateTarget } from "@flow-state-dev/core/types";
import { AGENT_KIND } from "./agent-worker-flow";
import { WORKER_TASK_ENTRY } from "./worker-task-entry";
import type { WorkerInstallation } from "./workers/installation";
import { WORKER_ID_STATE_KEY } from "./workers/keys";
import { standardWorkerFlow } from "./workers/standard-workers";

export interface WorkerLookupOptions {
  /** The installation whose standard workers a task can name. */
  installation: WorkerInstallation;
}

/** What the lookup answers for one name. */
export type WorkerLookupAnswer =
  | { found: true; flowId: string }
  | {
      found: false;
      reason: "not-found";
      /** One sentence naming the worker, for the refusal a door or a hand-over shows. */
      message: string;
    }
  | {
      found: false;
      /** The name means a worker, but its flow declares no task entry. */
      reason: "takes-no-tasks";
      /** The flow the worker runs on, for a caller that wants it for something other than a task. */
      flowId: string;
      message: string;
    };

/** The lookup, and the shapes the framework plugs it in as. */
export interface WorkerLookup {
  /** Which worker `name` means: the flow it runs on, or why there is none. */
  find(name: string, ctx?: BlockContext): WorkerLookupAnswer;
  /**
   * The per-task target for a list's fallback:
   * `dispatcher({ action: "work", session: "per-task", flowKind: lookup.flowKind, state: lookup.state })`.
   * A name no worker holds answers nothing, which refuses the hand-over
   * `flow-not-found` naming it; a worker whose flow takes no tasks throws its
   * own sentence. Either way the claim is still held, so the task fails
   * through the list's ordinary error path.
   */
  flowKind: TaskFlowTarget;
  /**
   * The per-task child state, beside {@link flowKind}: names the worker the
   * task names, so the worker flow's create check confirms it when the task's
   * session is created. Read from the task the board hands over, never from
   * its input.
   */
  state: TaskStateTarget;
  /**
   * The check a door makes before it files a task for `name` on list
   * `listId`: `undefined` when the name is fine, else the sentence to refuse
   * with. A name a board over that list declares as its own seat (DevTeam's
   * `coder`) passes without the lookup, since that board routes it itself.
   *
   * @param aliases Each list's own seat names, by list id, as the host read
   *   them off the boards it built.
   */
  filingCheck(
    aliases?: Readonly<Record<string, readonly string[]>>
  ): (name: string, listId: string, ctx: BlockContext) => string | undefined;
}

/**
 * Build the worker lookup over an installation.
 *
 * @param options The installation.
 * @returns `find` for the filing check and the wake, `flowKind` and `state` for a list's fallback.
 */
export function createWorkerLookup(options: WorkerLookupOptions): WorkerLookup {
  const { installation } = options;

  const find = (name: string): WorkerLookupAnswer => {
    const worker = installation.standardWorker(name);
    if (worker === undefined) {
      return { found: false, reason: "not-found", message: `No worker is named "${name}".` };
    }
    const flowId = standardWorkerFlow(worker, AGENT_KIND)!;
    const flow = installation.workerFlows()[flowId]?.flow as { task?: { actions?: Record<string, unknown> } } | undefined;
    if (!Object.prototype.hasOwnProperty.call(flow?.task?.actions ?? {}, WORKER_TASK_ENTRY)) {
      return {
        found: false,
        reason: "takes-no-tasks",
        flowId,
        message: `"${name}" takes no tasks: its flow "${flowId}" declares no \`${WORKER_TASK_ENTRY}\` task entry.`
      };
    }
    return { found: true, flowId };
  };

  const flowKind: TaskFlowTarget = (task) => {
    const answer = find(task.assignee);
    if (answer.found) return answer.flowId;
    if (answer.reason === "not-found") return undefined;
    throw new Error(`[workforce] task "${task.taskId}" could not be handed over: ${answer.message}`);
  };

  const filingCheck: WorkerLookup["filingCheck"] = (aliases = {}) => (name, listId) => {
    if (Object.hasOwn(aliases, listId) && aliases[listId]!.includes(name)) return undefined;
    const answer = find(name);
    return answer.found ? undefined : answer.message;
  };

  const state: TaskStateTarget = (task) => ({ [WORKER_ID_STATE_KEY]: task.assignee });

  return { find, flowKind, state, filingCheck };
}
