/**
 * The installation a goal's app builds, and the copies it registers.
 *
 * Every worker runs on one registered copy of the flow it names. A worker flow
 * is built on the installation (its `session`, its `resources`), and the
 * installation reads the flows when it first needs them, so the two are
 * built in one step:
 *
 * ```ts
 * const { installation, copies } = installWorkers(workers, (installation) => ({
 *   note: defineNoteFlow(installation),
 * }));
 * ```
 *
 * `copies` is `hireWorkforce(installation)`: one copy per worker flow, at its
 * kind (`agent` included, bound to the installation when `build` names none),
 * and the roster flow.
 */
import type { FlowInstance } from "@flow-state-dev/core/types";
import {
  createWorkerInstallation,
  hireWorkforce,
  type WorkerInstallation,
  type WorkerInstallationOptions,
  type WorkerManifest,
} from "@flow-state-dev/workforce";

/** What {@link installWorkers} takes beside the workers and the flows. */
export type InstallWorkersOptions = Omit<WorkerInstallationOptions, "standardWorkers" | "workerFlows"> & {
  /** The mailboxes' board ids, for `hireWorkforce`'s unattended-board warning. */
  mailboxBoards?: readonly string[];
};

/**
 * Build the installation over `workers` and the worker flows `build` returns
 * for it, and register one copy of each.
 *
 * @throws What `hireWorkforce` throws: a worker that would be refused on its
 *   first turn, or a worker flow that doesn't declare the installation's session.
 */
export function installWorkers(
  workers: readonly WorkerManifest[],
  build: (installation: WorkerInstallation) => Record<string, unknown>,
  options: InstallWorkersOptions = {},
): { installation: WorkerInstallation; copies: FlowInstance[] } {
  const { mailboxBoards, ...rest } = options;
  let flows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({ ...rest, standardWorkers: workers, workerFlows: () => flows as never });
  flows = build(installation);
  return {
    installation,
    copies: hireWorkforce(installation, mailboxBoards === undefined ? {} : { mailboxBoards }),
  };
}
