/**
 * Which worker a name on a task means: the one lookup the hand-over, the
 * filing check and the wake all ask.
 *
 * A task names its worker the way `discover` lists it — `eng.coder`, or the
 * id a worker was hired under. The lookup answers with the flow id of the one
 * worker holding that name for the running request: a worker the files
 * declare, a worker hired for the organization, or one the running member
 * hired for themselves. The organization and the member come from the run,
 * never from the task, so a name cannot reach another organization's worker or
 * a teammate's own (BP-031).
 *
 * **It reads the host's live registry, not the list it booted with.** A hire
 * registers its worker the moment it lands and a fire releases it, so a name
 * resolves for a worker hired a moment ago and stops resolving the moment the
 * worker is fired, with no restart and nothing to rebuild.
 *
 * A name two workers hold for one caller (the organization's and the caller's
 * own) is refused as ambiguous, naming both. Never resolved by precedence: a
 * task filed for one would silently run on the other.
 */

import type { BlockContext, FlowInstance, TaskFlowTarget } from "@flow-state-dev/core/types";
import { seatAddress } from "./roster/address";

/**
 * The task entry every worker kind takes tasks through. **Pinned**: a list's
 * fallback hands over to it, and so does the wake.
 */
export const WORKER_TASK_ENTRY = "work";

export interface WorkerLookupOptions {
  /**
   * The flow registered at an id right now — the host registry's own getter
   * (`(id) => runtime.registry.get(id)`), the same one the hire tool takes as
   * `instanceAt`. Read on every lookup; never a copy.
   */
  instanceAt: (id: string) => FlowInstance | undefined;
  /**
   * The ids of the workers the files declare, as `hireWorkforce` registered
   * them. A declared worker is registered at its own id; this list is what
   * tells it apart from any other flow registered at that id (a mailbox, say).
   */
  declared: Iterable<string>;
}

/** What the lookup answers for one name. */
export type WorkerLookupAnswer =
  | { found: true; flowId: string }
  | {
      found: false;
      reason: "not-found" | "ambiguous" | "takes-no-tasks";
      /** One sentence naming the worker, for the refusal a door or a hand-over shows. */
      message: string;
    };

/** The lookup, and the two shapes the framework plugs it in as. */
export interface WorkerLookup {
  /** Which worker `name` means for the request `ctx` runs. */
  find(name: string, ctx: BlockContext): WorkerLookupAnswer;
  /**
   * The per-task target for a list's fallback:
   * `dispatcher({ action: "work", session: "per-task", flowKind: lookup.flowKind })`.
   * A name nobody holds answers nothing, which refuses the hand-over
   * `flow-not-found` naming it; an ambiguous name, or a worker whose kind
   * takes no tasks, throws its own sentence. Either way the claim is still
   * held, so the task fails through the list's ordinary error path.
   */
  flowKind: TaskFlowTarget;
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
 * Build the worker lookup over the host's live registry.
 *
 * @param options The registry getter and the declared worker ids.
 * @returns `find` for the filing check and the wake, `flowKind` for a list's fallback.
 */
export function createWorkerLookup(options: WorkerLookupOptions): WorkerLookup {
  const declared = new Set(options.declared);
  const { instanceAt } = options;

  const find = (name: string, ctx: BlockContext): WorkerLookupAnswer => {
    const orgId = ctx.org?.identity.orgId ?? ctx.org?.identity.id;
    const userId = ctx.user?.identity.userId ?? ctx.user?.identity.id;

    // Every worker this caller could mean by the name. The addresses carry the
    // organization and the owner, so another organization's hire and a
    // teammate's own are simply never asked about.
    const held: Array<{ id: string; whose: string }> = [];
    if (declared.has(name) && instanceAt(name) !== undefined) {
      held.push({ id: name, whose: "declared in the files" });
    }
    if (typeof orgId === "string" && orgId.length > 0) {
      const org = addressOrUndefined(orgId, name);
      if (org !== undefined && instanceAt(org) !== undefined) {
        held.push({ id: org, whose: "hired for the organization" });
      }
      if (typeof userId === "string" && userId.length > 0) {
        const own = addressOrUndefined(orgId, name, userId);
        if (own !== undefined && instanceAt(own) !== undefined) {
          held.push({ id: own, whose: "your own" });
        }
      }
    }

    if (held.length === 0) {
      return { found: false, reason: "not-found", message: `No worker is named "${name}".` };
    }
    if (held.length > 1) {
      return {
        found: false,
        reason: "ambiguous",
        message:
          `"${name}" names ${held.length} workers: ${held.map((h) => `one ${h.whose}`).join(" and ")}. ` +
          `Fire or rename one of them so the name means one worker.`,
      };
    }
    const [only] = held;
    const flow = instanceAt(only!.id)!;
    if (!Object.prototype.hasOwnProperty.call(flow.task?.actions ?? {}, WORKER_TASK_ENTRY)) {
      return {
        found: false,
        reason: "takes-no-tasks",
        message: `"${name}" takes no tasks: its kind "${flow.kind}" declares no \`${WORKER_TASK_ENTRY}\` task entry.`,
      };
    }
    return { found: true, flowId: only!.id };
  };

  const flowKind: TaskFlowTarget = (task, ctx) => {
    const answer = find(task.assignee, ctx);
    if (answer.found) return answer.flowId;
    if (answer.reason === "not-found") return undefined;
    throw new Error(`[workforce] task "${task.taskId}" could not be handed over: ${answer.message}`);
  };

  const filingCheck: WorkerLookup["filingCheck"] = (aliases = {}) => (name, listId, ctx) => {
    if (Object.hasOwn(aliases, listId) && aliases[listId]!.includes(name)) return undefined;
    const answer = find(name, ctx);
    return answer.found ? undefined : answer.message;
  };

  return { find, flowKind, filingCheck };
}

/** A hired worker's address, or `undefined` for a name no address can carry. */
function addressOrUndefined(orgId: string, name: string, userId?: string): string | undefined {
  try {
    return seatAddress(orgId, name, userId);
  } catch {
    return undefined;
  }
}
