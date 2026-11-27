/**
 * Workforce as a kit, for the FIX-2622 proof only: what the workforce package
 * would export once it converts. Never shipped; `run.sh` copies it beside the
 * lab's host for the run.
 *
 * - **Its directory** is `workforce/` in the app, read at install by
 *   workforce's own schema reader (`readDeclaredRoster`) after the shared walk
 *   primitive opened it. A tree with any problem is refused whole, naming each.
 * - **Its one slot**, `workerFlows`, a keyed map: the worker flows by name, as
 *   `createWorkerInstallation` takes them. A `workerFlow(...)` builder is built
 *   on the installation, so a flow that needs it never closes over a variable
 *   filled in later.
 * - **Its install** builds the installation and registers every copy
 *   `hireWorkforce` returns (one per worker flow, and `workforce-roster`). No
 *   app calls either. It publishes the installation, for an app flow that
 *   reads the standard workers.
 * - **Its config** is every other `createWorkerInstallation` and
 *   `hireWorkforce` option, as they are.
 */
import {
  createWorkerInstallation,
  hireWorkforce,
  type HireWorkforceOptions,
  type WorkerFlowEntry,
  type WorkerInstallation,
  type WorkerInstallationOptions,
} from "@flow-state-dev/workforce";
import { readDeclaredRoster, type DeclaredRoster } from "@flow-state-dev/workforce/loader";
import { defineKit } from "./define-kit.ts";

type WorkforceConfig = Omit<WorkerInstallationOptions, "standardWorkers" | "workerFlows"> & HireWorkforceOptions;

export const workforce = defineKit<WorkforceConfig, DeclaredRoster, { workerFlows: Record<string, WorkerFlowEntry> | undefined }, { installation: WorkerInstallation }>({
  name: "workforce",
  slots: { workerFlows: "keyed" },
  directory: {
    path: "workforce",
    load: async (root) => {
      const roster = await readDeclaredRoster(root);
      if (roster.problems.length > 0) {
        throw new Error(`workforce: the workers did not load: ${roster.problems.map((p) => `${p.layer} ${p.path}`).join(", ")}`);
      }
      return roster;
    },
  },
  install: ({ config, directory, slots }) => {
    const { taskChainLimit, messages, routines, ...options } = config;
    const installation = createWorkerInstallation({ ...options, standardWorkers: directory.workers, workerFlows: slots.workerFlows });
    const flows = hireWorkforce(installation, {
      ...(taskChainLimit === undefined ? {} : { taskChainLimit }),
      ...(messages === undefined ? {} : { messages }),
      ...(routines === undefined ? {} : { routines }),
    });
    return { flows, exports: { installation } };
  },
});
