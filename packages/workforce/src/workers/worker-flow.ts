/**
 * `workerFlow`: a worker flow built on the installation that runs its workers.
 *
 * A worker flow declares its installation's session and resources, so it is
 * built with the installation in hand. An app that defines its flows beside
 * the installation passes them in `workerFlows` already built. A flow that
 * lives in its own file, under `workforce/flows/workers/` where `fsdev gen`
 * finds it, has no installation to import, so its module exports a builder
 * instead, and the installation builds it, once, with itself:
 *
 * ```ts
 * // workforce/flows/workers/desk-clerk.ts
 * export default workerFlow((installation) =>
 *   defineFlow({
 *     kind: "desk-clerk",
 *     session: installation.session(),
 *     resources: { ...installation.resources },
 *     ...
 *   })
 * );
 * ```
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import type { WorkerInstallation } from "./installation";
import type { WorkerRole } from "../worker-roles";

// FIX-2877 D2.
/**
 * Who takes a task a model files for one of a flow's workers from outside
 * that flow's work: the worker id the server writes as its assignee, in place
 * of the one the model named, chosen from `delegates`, the filer's own
 * task-taking delegates (worker id to flow). Resolves to `undefined` to keep
 * the model's. Throws `TaskWriteRefusedError` to refuse the filing, saying why.
 * An answer outside `delegates` is refused.
 *
 * "Outside" is a filing from a session that doesn't run on the flow and wasn't
 * opened by a task one filed. A user's own move on the board (an action,
 * such as a re-file onto a worker they chose) is never rewritten.
 */
export type NoPickAssignee = (
  ctx: BlockContext,
  installation: WorkerInstallation,
  delegates: ReadonlyMap<string, string>
) => Promise<string | undefined>;

const BUILDER = Symbol.for("flow-state-dev/workforce/worker-flow");

/** A worker flow waiting for its installation. See {@link workerFlow}. */
export interface WorkerFlowBuilder {
  readonly [BUILDER]: true;
  /** Builds the flow on the installation that runs its workers. Called once per installation. */
  readonly build: (installation: WorkerInstallation) => unknown;
  /** Whether the app keeps the flow for the workers its files define. */
  readonly standardOnly: boolean;
  /**
   * The roles the flow declares, beside every worker's door; `undefined` when
   * the builder names none, so a built-in flow it builds keeps its own.
   */
  readonly roles: readonly WorkerRole[] | undefined;
  /** The flow's settings a user may see on the roster; empty when it names none. */
  readonly showSettings: readonly string[];
  /** Whether the flow's tasks work in a project's files, so a task filed with none is refused. */
  readonly needsProject: boolean;
  /** Who takes a task a model files for one of its workers from outside its work; `undefined` when the model's assignee stands. */
  readonly noPickAssignee: NoPickAssignee | undefined;
  /** Settings the flow no longer takes: a stored worker that set one reads without it, and a hire or an edit naming one is refused. */
  readonly retiredSettings: readonly string[];
}

/**
 * Declare a worker flow built on its installation.
 *
 * @param build Builds the flow (`defineFlow({ ..., session: installation.session() })`).
 * @param options `standardOnly` keeps the flow for the workers the app's files define.
 *   `roles` declares what it does beside taking a user's message on `respond`:
 *   `contributor` (takes tasks on `work`, from `workerTaskEntry`) and
 *   `manager` (runs its delegation board on `dispatch`, from
 *   `defineSessionBoard`). The hire checks each role's entries, and refuses a
 *   role's piece on a flow that doesn't declare it. `showSettings` names the
 *   flow's settings a user may see on the roster. `needsProject` says its
 *   tasks work in a project's files, as a coding run does: a task for one of
 *   its workers filed with no project is refused at filing (`no_project`).
 *   `noPickAssignee` decides who takes a task a model files for one of its
 *   workers from outside its work ({@link NoPickAssignee}). `retiredSettings`
 *   names settings it no longer takes: a stored worker that set one reads
 *   without it, and a hire or an edit naming one is refused.
 * @returns An entry for `createWorkerInstallation({ workerFlows })`, and for
 *   the `workerFlows` map `fsdev gen` writes.
 */
export function workerFlow(
  build: (installation: WorkerInstallation) => unknown,
  options: {
    standardOnly?: boolean;
    roles?: readonly WorkerRole[];
    showSettings?: readonly string[];
    needsProject?: boolean;
    noPickAssignee?: NoPickAssignee;
    retiredSettings?: readonly string[];
  } = {}
): WorkerFlowBuilder {
  return {
    [BUILDER]: true,
    build,
    standardOnly: options.standardOnly === true,
    roles: options.roles === undefined ? undefined : [...options.roles],
    showSettings: [...(options.showSettings ?? [])],
    needsProject: options.needsProject === true,
    noPickAssignee: options.noPickAssignee,
    retiredSettings: [...(options.retiredSettings ?? [])]
  };
}

/** Whether a `workerFlows` entry is a {@link workerFlow} builder. */
export function isWorkerFlowBuilder(entry: unknown): entry is WorkerFlowBuilder {
  return typeof entry === "object" && entry !== null && (entry as Record<symbol, unknown>)[BUILDER] === true;
}
