/**
 * Read the tree, build the installation and the flows on it, register one
 * copy of each, and hand back what `fsdev.config.mts` serves and what the
 * checks need to read. Every worker is a worker on its flow's one copy; a
 * session names the worker it runs.
 *
 * Every file it reads is found by walking from one root; no worker is named
 * in this code. No file declares a board: the planner files on its own
 * conversation's board, which Workforce keeps.
 *
 * ## The three things that are the lab's rather than the framework's
 *
 * 1. **The two flows** (`workforce/flows/workers/`): the planner's, which
 *    carries the filing kit, and the workers'.
 * 2. **The desk -> delegate map** ({@link ROUTES}). It is the app's: whoever
 *    files through the planner's conversation reads it to pick a row's
 *    assignee, and nothing reads it off the tree. That is what lets
 *    `swapped-desks` and `one-worker` file a row for the wrong delegate while
 *    each worker's own `WORKER.md` still says which desk it answers for.
 * 3. **The refusal policy.** `readDeclaredRoster` collects problems rather than
 *    throwing, which is right for a library and wrong here: a worker that failed
 *    to load is a worker this lab does not have, and a short roster that still
 *    runs proves something other than what is claimed.
 */

import { DEFAULT_ORG_ID, defineFlow } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { runAction } from "@flow-state-dev/engine";
import {
  COORDINATOR_FLOW,
  createWorkerInstallation,
  defineCoordinatorFlow,
  hireWorkforce,
  inventoryWorkers,
  inventoryWriterActions,
  openInventory,
  type InventoryActionRequest,
  type WorkerInstallation,
} from "@flow-state-dev/workforce";
import { readDeclaredRoster, type DeclaredRoster } from "@flow-state-dev/workforce/loader";
import { fileURLToPath } from "node:url";
import { PLANNER_FLOW, definePlannerFlow } from "./workforce/flows/workers/planner.mts";
import { WORKER_FLOW, defineWorkerFlow, type WorkerControl } from "./workforce/flows/workers/worker.mts";

/** The authored tree — the one path this code names. Everything else is walked. */
export const LAB_TREE = fileURLToPath(new URL("./workforce", import.meta.url));

/** Who the lab runs as — one user, one principal. */
export const LAB_USER_ID = "u_multi_worker_collab";

/** The served database, relative to the server's working directory. */
export const LAB_DB_PATH = ".fsdev/data/multi-worker-collab.db";

/** The organization every lab session runs in: the lab configures no resolver. */
export const LAB_ORG_ID = DEFAULT_ORG_ID;

/** The flow the inventory's worker rows are written from: the lab's own, carrying the writer. */
export const INVENTORY_WRITER_FLOW = "inventory-writer";

/**
 * The model a best-fit coordinator's evaluator would run on. The queue
 * routes to everyone and never makes that call, but the flow names no default.
 */
const ROUTE_MODEL = "openai/gpt-5.4-mini";

/** Desk key -> the planner's delegate a row for that desk is filed for. The app's wiring — see the module header. */
export const ROUTES: Readonly<Record<string, string>> = {
  build: "eng.builder",
  review: "eng.reviewer",
};

/**
 * The map a filer uses under a control, if one is set.
 *
 * - `swapped-desks` — the two desks trade delegates.
 * - `one-worker` — both desks go to the first desk's delegate; the other gets nothing.
 *
 * Any other value leaves the map as written.
 */
export function routesFor(control: string): Record<string, string> {
  const [first, second] = Object.keys(ROUTES) as [string, string];
  if (control === "swapped-desks") return { [first]: ROUTES[second]!, [second]: ROUTES[first]! };
  if (control === "one-worker") return { [first]: ROUTES[first]!, [second]: ROUTES[first]! };
  return { ...ROUTES };
}

/** Everything the tree says, read once and refused whole if any of it did not load. */
export interface LabTree {
  roster: DeclaredRoster;
  /** The coordinator's id — the team's front door, on Workforce's coordinator flow. */
  coordinatorId: string;
  /** The planner's id, read off the tree. */
  plannerId: string;
  /** The planner's `delegates:`, as its file lists them. */
  delegates: string[];
  /** The worker ids, in tree order. */
  workerIds: string[];
  /** Worker id -> the flow it runs on, whose one copy every worker on that flow shares. */
  workerFlows: Record<string, string>;
  /**
   * Worker id -> the desk that worker's OWN `WORKER.md` answers for. **The oracle.**
   * Read by the checks, never by the filing.
   */
  declaredDesks: Record<string, string>;
}

/**
 * Read the tree and refuse it whole if anything in it did not load.
 *
 * @throws Naming every problem in one pass, or the first missing fact.
 */
export async function readLabTree(root: string = LAB_TREE): Promise<LabTree> {
  const roster = await readDeclaredRoster(root);
  if (roster.problems.length > 0) {
    const lines = roster.problems.map((problem) => `${problem.layer} ${problem.path}: ${problem.error.message}`);
    throw new Error(`the tree at ${root} did not load cleanly:\n  - ${lines.join("\n  - ")}`);
  }

  // Exactly the declared topology — one coordinator, one planner, two
  // workers, nothing else. A stray third worker would still hire and run, and
  // the proof would be about a different team than the one it names.
  const coordinators = roster.workers.filter((worker) => worker.declared.flow === COORDINATOR_FLOW);
  const planners = roster.workers.filter((worker) => worker.declared.flow === PLANNER_FLOW);
  const workers = roster.workers.filter((worker) => worker.declared.flow === WORKER_FLOW);
  if (coordinators.length !== 1 || planners.length !== 1 || workers.length !== 2 || roster.workers.length !== 4) {
    throw new Error(
      `the tree at ${root} hires ${coordinators.length} "${COORDINATOR_FLOW}", ${planners.length} "${PLANNER_FLOW}" ` +
        `and ${workers.length} "${WORKER_FLOW}" worker(s) among ${roster.workers.length}; this lab is exactly one ` +
        `coordinator, one planner and two workers (${roster.workers.map((worker) => worker.id).join(", ")})`,
    );
  }
  const planner = planners[0]!;
  const delegates = Array.isArray(planner.declared.delegates) ? (planner.declared.delegates as unknown[]).map(String) : [];
  const workerIds = workers.map((worker) => worker.id);
  if (delegates.length !== workerIds.length || !workerIds.every((id) => delegates.includes(id))) {
    throw new Error(`the planner "${planner.id}" delegates to [${delegates.join(", ")}], not to the two workers [${workerIds.join(", ")}]`);
  }
  const declaredDesks: Record<string, string> = {};
  for (const worker of workers) {
    const desk = worker.declared.answersFor;
    if (typeof desk !== "string" || desk.length === 0) {
      throw new Error(`worker "${worker.id}" declares no answersFor`);
    }
    declaredDesks[worker.id] = desk;
  }

  return {
    roster,
    coordinatorId: coordinators[0]!.id,
    plannerId: planner.id,
    delegates,
    workerIds,
    workerFlows: {
      [coordinators[0]!.id]: COORDINATOR_FLOW,
      [planner.id]: PLANNER_FLOW,
      ...Object.fromEntries(workerIds.map((id) => [id, WORKER_FLOW])),
    },
    declaredDesks,
  };
}

export interface HireLabOptions {
  /** The tree, already read. */
  tree: LabTree;
  /** Where each attempt leaves its line. */
  outbox: string;
  /** A worker-body perturbation, or none. */
  workerControl?: WorkerControl;
}

/** What a hire hands back: the flows a `FlowState` registers, and the installation they run. */
export interface HiredLab {
  flows: Record<string, FlowInstance>;
  installation: WorkerInstallation;
}

/**
 * Build the installation and the flows, and register one copy of each, plus
 * the inventory writer.
 *
 * `hireWorkforce` refuses the WHOLE roster when any worker would be refused
 * on its first turn, so a refusal cannot leave a short roster running.
 */
export function hireLab(options: HireLabOptions): HiredLab {
  const { tree } = options;
  let workerFlows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({
    standardWorkers: tree.roster.workers,
    workerFlows: () => workerFlows as never,
  });
  workerFlows = {
    [WORKER_FLOW]: {
      flow: defineWorkerFlow({
        installation,
        outbox: options.outbox,
        ...(options.workerControl === undefined ? {} : { control: options.workerControl }),
      }),
      roles: ["contributor"],
    },
    [PLANNER_FLOW]: { flow: definePlannerFlow({ installation }), roles: ["manager"] },
    // The planner and the workers take no delegated post, so a post to the
    // queue reaches nobody; its rows are the planner's to file.
    [COORDINATOR_FLOW]: defineCoordinatorFlow({ installation, routeModel: ROUTE_MODEL }),
  };
  const copies = hireWorkforce(installation);
  // The inventory's worker rows take caller-supplied rows, so the writer is internal only.
  const writer = defineFlow({
    kind: INVENTORY_WRITER_FLOW,
    internal: { actions: { ...inventoryWriterActions() } },
  } as never) as unknown as FlowInstance;
  return {
    flows: { ...Object.fromEntries(copies.map((copy) => [copy.id, copy])), [INVENTORY_WRITER_FLOW]: writer },
    installation,
  };
}

/** The part of a served `FlowState` the boot needs. */
export interface LabServer {
  getRuntime(): Promise<{ stores: unknown; runtimeConfig: unknown }>;
}

/**
 * The documented boot, in-process, after the server is built: open the
 * organization's inventory under the organization the lab's sessions run in,
 * so each worker's row names its door.
 *
 * @throws Naming every problem `openInventory` reported. A half-registered
 *   organization is not served, because a check graded on half of one proves
 *   nothing.
 */
export async function openLab(server: LabServer, hired: HiredLab): Promise<void> {
  const runtime = await server.getRuntime();
  const run = async (request: InventoryActionRequest): Promise<unknown> => {
    const flow = hired.flows[request.flowKind];
    if (flow === undefined) throw new Error(`no flow is served under "${request.flowKind}"`);
    const result = (await runAction({
      flow,
      actionName: request.action,
      input: request.input,
      userId: request.userId,
      orgId: request.orgId,
      sessionId: request.sessionId,
      source: request.source,
      stores: runtime.stores,
      runtimeConfig: runtime.runtimeConfig,
    } as never)) as { error?: unknown };
    if (result?.error !== undefined) {
      throw result.error instanceof Error ? result.error : new Error(String(result.error));
    }
    return result;
  };
  const binding = await openInventory(
    { workers: inventoryWorkers(hired.installation) },
    { run, workerWriter: { flowKind: INVENTORY_WRITER_FLOW }, userId: LAB_USER_ID, orgId: LAB_ORG_ID },
  );
  if (binding.problems.length > 0) {
    throw new Error(
      `the lab's inventory did not register, so the lab will not serve:\n  - ${binding.problems.join("\n  - ")}`,
    );
  }
}
