/**
 * A better workforce install API, with no kit: for the FIX-2622 proof only.
 * What the workforce package would add to its `./loader` (Node-only) subpath,
 * as one call. Never shipped; `run.sh` copies it beside the lab's host for
 * the run.
 *
 * `installWorkforce` does what every host on workforce does by hand today, in
 * the order they do it:
 *
 * 1. reads the tree (`readDeclaredRoster`) and refuses one with any problem,
 *    naming each;
 * 2. builds the installation on those workers and the worker flows given,
 *    where a `workerFlow(...)` builder is built on the installation, so a flow
 *    that needs it never closes over a variable filled in later;
 * 3. registers every copy `hireWorkforce` returns (one per worker flow, and
 *    `workforce-roster`), keyed by id, ready for `createFlowState({ flows })`.
 *
 * It takes every other `createWorkerInstallation` and `hireWorkforce` option
 * as they are, so a host that needs one still has it.
 */
import { fileURLToPath } from "node:url";
import type { FlowInstance } from "@flow-state-dev/core/types";
import {
  createWorkerInstallation,
  hireWorkforce,
  type HireWorkforceOptions,
  type WorkerFlowEntry,
  type WorkerInstallation,
  type WorkerInstallationOptions,
} from "@flow-state-dev/workforce";
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";

export interface InstallWorkforceOptions extends Omit<WorkerInstallationOptions, "standardWorkers" | "workerFlows">, HireWorkforceOptions {
  /** The workforce tree: a path, or a `file:` URL (`new URL("./workforce", import.meta.url)`). */
  tree: string | URL;
  /** The worker flows, by name; a `workerFlow(...)` builder is built on the installation. */
  workerFlows?: Record<string, WorkerFlowEntry>;
}

export interface InstalledWorkforce {
  installation: WorkerInstallation;
  /** Every flow to serve, by id: one copy per worker flow, and `workforce-roster`. */
  flows: Record<string, FlowInstance>;
}

export async function installWorkforce(options: InstallWorkforceOptions): Promise<InstalledWorkforce> {
  const { tree, workerFlows, taskChainLimit, messages, routines, ...installation } = options;
  const root = tree instanceof URL ? fileURLToPath(tree) : tree;
  const roster = await readDeclaredRoster(root);
  if (roster.problems.length > 0) {
    throw new Error(`workforce: the workers did not load: ${roster.problems.map((p) => `${p.layer} ${p.path}`).join(", ")}`);
  }
  const installed = createWorkerInstallation({ ...installation, standardWorkers: roster.workers, workerFlows });
  const copies = hireWorkforce(installed, {
    ...(taskChainLimit === undefined ? {} : { taskChainLimit }),
    ...(messages === undefined ? {} : { messages }),
    ...(routines === undefined ? {} : { routines }),
  });
  return { installation: installed, flows: Object.fromEntries(copies.map((copy) => [copy.id, copy])) };
}
