/**
 * `hireWorkforce`: the flows an installation registers, one copy each.
 *
 * Every worker runs on one shared copy of the flow it names: the built-in
 * `agent` and every flow the installation was given. A worker is data (a
 * row its owner holds, or a standard worker from the files), so hiring one
 * registers nothing, and nothing here mints a copy per worker or pins one to
 * an owner. Beside the worker flows sits the roster flow, through which an
 * app reads and writes a user's roster, and which keeps and fires the user's
 * schedules (FIX-2085).
 */
import type { FlowInstance } from "@flow-state-dev/core/types";
import { AGENT_FLOW } from "../agent-worker-flow";
import { checkWorkerFlows } from "../hire";
import type { InventoryWorker } from "../inventory/open-inventory";
import { createWorkerHireBlocks } from "./hire-blocks";
import { setTaskChainLimit } from "./chain-limit";
import { setMessageLimits, type MessageLimits } from "../messages/message-limits";
import { messageReceivedProblem } from "../messages/message-received-entry";
import { sendWithoutPassProblem } from "../messages/delivery";
import { defineScheduledWork, type ScheduledWorkOptions } from "../schedules/scheduled-work";
import type { WorkerInstallation } from "./installation";
import { defineWorkerRosterFlow } from "./roster-flow";
import { standardWorkerFlow, workerDisplayName } from "./standard-workers";

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
   * The most tasks one top task may have under it, at any depth, finished
   * ones included: a filing past it is refused as `total_task_cap_exceeded`.
   * Omitted, 100. A chain is also never more than five boards deep, whatever
   * this says.
   */
  taskChainLimit?: number;
  /**
   * The limits on worker messages (`sendMessage`): `budget`, the most
   * messages a chain of workers passes with no user's turn between them
   * (6 when omitted), and `perTurn`, the most one turn sends (3 when omitted).
   */
  messages?: MessageLimits;
  /**
   * Recurring work: the user's schedules, each filing a task on a worker's
   * board when it is due. Always kept and fired through the roster flow;
   * `index` is optional, a polling or BullMQ schedule index to mirror every
   * saved schedule into. Omit it and the host's own cron POSTs per schedule.
   */
  schedules?: ScheduledWorkOptions;
}

/**
 * The copies to register for `installation`: one per worker flow, at the
 * flow's name, and the roster flow with its `hire`, `fork`, `edit` and
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
  if (options.taskChainLimit !== undefined) setTaskChainLimit(installation, options.taskChainLimit);
  if (options.messages !== undefined) setMessageLimits(installation, options.messages);
  checkWorkerFlows(installation.workerFlows());
  const copies: FlowInstance[] = [];
  const unbound: string[] = [];
  for (const [flowName, { flow }] of Object.entries(installation.workerFlows()).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const copy = (flow as unknown as (options: { id: string }) => FlowInstance)({ id: flowName });
    if (!runsWorkersOf(copy, installation)) unbound.push(flowName);
    copies.push(copy);
  }
  if (unbound.length > 0) {
    throw new Error(
      `hireWorkforce: worker flow${unbound.length === 1 ? "" : "s"} ${unbound.map((flowName) => `"${flowName}"`).join(", ")} ` +
        `${unbound.length === 1 ? "doesn't" : "don't"} declare this installation's session, so ${unbound.length === 1 ? "its" : "their"} ` +
        `sessions would run no checked worker. Declare \`session: installation.session()\` on each, and load the worker ` +
        `with \`installation.resolveWorker\` on every turn (the flow's \`request.onStarted\` runs on a resumed one too).`
    );
  }
  // Every worker on an installation can be messaged, so every worker flow
  // hears one (FIX-2238), and one that offers the send carries the pass that
  // sends it again (FIX-2271): checked as the door is, before anything registers.
  const deaf = Object.entries(installation.workerFlows())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .flatMap(([flowName, { flow }]) => [messageReceivedProblem(flowName, flow), sendWithoutPassProblem(flowName, flow)])
    .filter((problem): problem is string => problem !== undefined);
  if (deaf.length > 0) {
    throw new Error(`hireWorkforce refused ${deaf.length} worker flow(s); nothing was registered:\n` + deaf.map((problem) => `  - ${problem}`).join("\n"));
  }
  const problems = installation.standardWorkerProblems();
  if (problems.length > 0) {
    throw new Error(
      `hireWorkforce: ${problems.length} standard worker problem(s); nothing was registered:\n` +
        problems.map((problem) => `  - ${problem}`).join("\n")
    );
  }
  const { hire, fork, edit, fire } = createWorkerHireBlocks(installation);
  const scheduled = defineScheduledWork(installation, options.schedules);
  const roster = defineWorkerRosterFlow(
    installation,
    {
      hire: { inputSchema: hire.inputSchema, block: hire },
      fork: { inputSchema: fork.inputSchema, block: fork },
      edit: { inputSchema: edit.inputSchema, block: edit },
      fire: { inputSchema: fire.inputSchema, block: fire },
      ...scheduled.actions
    },
    scheduled
  );
  copies.push(roster() as unknown as FlowInstance);
  return copies;
}

/**
 * The installation's standard workers as `openInventory` takes workers: each
 * worker's id, the flow it runs on, and that flow's actions, which its door is
 * read from. The org's inventory lists these, the workers every user has; a
 * user's own workers are theirs, on their roster.
 */
export function inventoryWorkers(installation: WorkerInstallation): InventoryWorker[] {
  const flows = installation.workerFlows();
  return installation.standardWorkers().map((worker) => {
    const flow = standardWorkerFlow(worker, AGENT_FLOW)!;
    const actions = (flows[flow]?.flow as { actions?: Readonly<Record<string, unknown>> } | undefined)?.actions ?? {};
    return { id: worker.id, kind: flow, actions, name: workerDisplayName(worker), teamName: worker.teamName ?? null };
  });
}
