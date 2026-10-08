/**
 * `hireWorkforce`: the flows an installation registers, one copy each.
 *
 * Every worker runs on one shared copy of the flow it names: the built-in
 * `agent` and every flow the installation was given. A worker is data (a
 * row its owner holds, or a standard worker from the files), so hiring one
 * registers nothing, and nothing here mints a copy per worker or pins one to
 * an owner. Beside the worker flows sits the roster flow, through which an
 * app reads and writes a user's roster.
 */
import { firstInProcess } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { AGENT_KIND } from "../agent-worker-flow";
import { checkWorkerFlows, unattendedBoardWarnings } from "../hire";
import type { InventorySeat } from "../inventory/open-inventory";
import { createWorkerHireBlocks } from "./hire-blocks";
import type { WorkerInstallation } from "./installation";
import { defineWorkerRosterFlow } from "./roster-flow";
import { standardWorkerFlow } from "./standard-workers";

/**
 * Whether `flow` runs this installation's workers: it declares the
 * installation's session, whose create check names the session's worker.
 */
export function runsWorkersOf(flow: { readonly session?: unknown }, installation: WorkerInstallation): boolean {
  return (flow.session as { createCheck?: unknown } | undefined)?.createCheck === installation.createCheck;
}

/** What `hireWorkforce` takes beside the installation. */
export interface HireWorkforceOptions {
  /**
   * The ledger ids of the boards the app's mailboxes declare
   * (`mailboxBoardIds(mailboxes)`). A board no registered copy declares is
   * named once per process in a warning: rows filed there sit pending until
   * something drains them.
   */
  mailboxBoards?: readonly string[];
}

/**
 * The copies to register for `installation`: one per worker flow, at the
 * flow's kind, and the roster flow with its `hire`, `fork`, `edit` and
 * `fire` actions. Register every one.
 *
 * @throws When a worker flow misses the worker contract (a door, the
 *   configuration a worker is handed, shared resources through
 *   `sharedResource()`). Every problem with every flow is named, whatever
 *   the workers hold.
 * @throws When a worker flow doesn't declare the installation's session
 *   (`session: installation.session()`): its sessions would run no checked
 *   worker. Every such flow is named.
 * @throws When a standard worker would be refused on its first turn (a tool,
 *   a skill or a setting its flow won't take). Every such worker is named,
 *   and nothing is registered: a short roster that still runs is the failure.
 */
export function hireWorkforce(installation: WorkerInstallation, options: HireWorkforceOptions = {}): FlowInstance[] {
  checkWorkerFlows(installation.workerFlows());
  const copies: FlowInstance[] = [];
  const unbound: string[] = [];
  for (const [kind, { flow }] of Object.entries(installation.workerFlows()).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const copy = (flow as unknown as (options: { id: string }) => FlowInstance)({ id: kind });
    if (!runsWorkersOf(copy, installation)) unbound.push(kind);
    copies.push(copy);
  }
  if (unbound.length > 0) {
    throw new Error(
      `hireWorkforce: worker flow${unbound.length === 1 ? "" : "s"} ${unbound.map((kind) => `"${kind}"`).join(", ")} ` +
        `${unbound.length === 1 ? "doesn't" : "don't"} declare this installation's session, so ${unbound.length === 1 ? "its" : "their"} ` +
        `sessions would run no checked worker. Declare \`session: installation.session()\` on each, and load the worker ` +
        `with \`installation.resolveWorker\` on every turn (the flow's \`request.onStarted\` runs on a resumed one too).`
    );
  }
  const problems = installation.standardWorkerProblems();
  if (problems.length > 0) {
    throw new Error(
      `hireWorkforce: ${problems.length} standard worker problem(s); nothing was registered:\n` +
        problems.map((problem) => `  - ${problem}`).join("\n")
    );
  }
  const { hire, fork, edit, fire } = createWorkerHireBlocks(installation);
  const roster = defineWorkerRosterFlow(installation, {
    hire: { inputSchema: hire.inputSchema, block: hire },
    fork: { inputSchema: fork.inputSchema, block: fork },
    edit: { inputSchema: edit.inputSchema, block: edit },
    fire: { inputSchema: fire.inputSchema, block: fire }
  });
  copies.push(roster() as unknown as FlowInstance);
  for (const boardId of options.mailboxBoards ?? []) {
    for (const warning of unattendedBoardWarnings([boardId], copies)) {
      if (firstInProcess(`workforce/unattended-board/${boardId}`)) console.warn(warning);
    }
  }
  return copies;
}

/**
 * The installation's standard workers as `openInventory` takes seats: each
 * worker's id, the flow it runs on, and that flow's actions, which its door is
 * read from. The org's inventory lists these, the workers every member has; a
 * user's own workers are theirs, on their roster.
 */
export function inventorySeats(installation: WorkerInstallation): InventorySeat[] {
  const flows = installation.workerFlows();
  return installation.standardWorkers().map((worker) => {
    const kind = standardWorkerFlow(worker, AGENT_KIND)!;
    const actions = (flows[kind]?.flow as { actions?: Readonly<Record<string, unknown>> } | undefined)?.actions ?? {};
    return { id: worker.id, kind, actions };
  });
}
