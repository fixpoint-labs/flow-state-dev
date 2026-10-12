/**
 * The `coder` worker flow — one file under `workforce/flows/workers/`,
 * basename = the flow name every working `WORKER.md` names in its `flow:` line.
 *
 * This is the worker a filed task wakes. It declares one task entry, `work`,
 * and takes tasks through it from any session's board: the EM's workstream
 * session, or a coordinator's conversation. Each task becomes a supervised
 * coding run with its own checkout, and the verdict is read before the task
 * settles.
 *
 * **The task decides the run, never the board it came from.** A task naming
 * an `issue` and a `phase` is feature work: the implement manager runs it, and
 * it needs a commit. A task naming neither is a user's ask: the answer
 * manager runs it, and it needs an answer (D2). A task naming only one of the
 * two goes to the implement manager, which refuses it inside the run, after
 * the claim, so the task ends `errored` with one notice and never runs as an
 * answer task. Both managers read each run's board from its claim, so one
 * coder works any number of sessions' boards at once, each run in a checkout
 * of its own.
 *
 * **Where a task works.** A host's source is `projectWorkspace()`: the run
 * works in the project of the workstream its task was filed from, the
 * conversation's project, or the one the task names, and with none of these
 * it is refused (D3). A fixed repository runs every feature task there.
 *
 * **Jev reads the work** (D4). Both managers carry the judge, which reads a
 * task's goal against the run's answer and commits before it closes.
 *
 * **The harness is a slot**, passed in. That is what lets the model-free
 * contract gate and the model-backed honesty check drive the same tree, the
 * same hire and the same wiring while differing by one expression. It must be
 * detached: the claim gate refuses an entry that authors session state
 * beneath it, and this flow refuses to build otherwise, naming the entry.
 *
 * **One message door** covers both managers: a user's message into a
 * running coding run, on the run's own session, found on the board of the
 * session its task was filed from.
 *
 * Every coder worker runs on this worker flow's one copy. A session names its worker
 * (`installation.session()`), and the phases read that worker's own settings
 * through the installation, never `ctx.flow.config`.
 */

import { defineFlow, router } from "@flow-state-dev/core";
import type { DeclaredResources } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import {
  harnessManager,
  harnessMessageDoor,
  type HarnessJudge,
  type MessageDoorBoard,
  type PhaseSpec,
  type WorkspaceConfig,
} from "@flow-state-dev/harness-manager";
import type { HarnessBlock, HarnessCallbackContext } from "@flow-state-dev/core/types";
import { assertHandOffBlockSupported, taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import type { Task, TaskWorker } from "@flow-state-dev/orchestration/tasks";
import {
  conversationLedgers,
  filingConversationBoard,
  projectWorkspaceCapability,
  WORKER_TASK_ENTRY,
  workerTaskEntry,
  type WorkerInstallation,
} from "@flow-state-dev/workforce";
import type { WorkspaceHost } from "@flow-state-dev/workspace";
import {
  defineReadOwnFacts,
  INSPECT_ENTRY,
  workerOf,
  workerSettingsSchema,
} from "../../../worker-config.mts";

/** The flow name the working `WORKER.md` names. **Pinned** — the basename must match. */
export const CODER_FLOW = "coder";

/** The answer manager's name: its blocks are named apart from the implement manager's. */
const ANSWER_MANAGER = "harness-manager-answer";

export interface CoderWorkerFlowOptions {
  /** The installation whose workers run on this worker flow. */
  installation: WorkerInstallation;
  /**
   * **The slot.** How this worker flow is pointed at a coding harness.
   *
   * One expression, handed the three feeds the harness contract declares. The
   * gate puts a scripted stub here; the honesty check puts a real coding agent
   * here. Nothing else differs between the two. Called once per manager.
   */
  harness: (feeds: {
    cwd: (ctx: HarnessCallbackContext) => string | Promise<string>;
    resume: (ctx: HarnessCallbackContext) => string | null | Promise<string | null>;
    onSession: (sessionId: string, ctx: HarnessCallbackContext) => void | Promise<void>;
  }) => HarnessBlock;
  /**
   * Where a feature task works: a fixed repository (`{ root, sourceRepo,
   * baseRef }`), or a workspace host whose source is `projectWorkspace()`, so
   * a run works in its project's repository or on its project's files.
   */
  workspace: WorkspaceConfig | WorkspaceHost;
  /**
   * Where an answer task works: a workspace host whose source is
   * `projectWorkspace()`, so a task works in its project and is refused with
   * none.
   */
  answerWorkspace: WorkspaceHost;
  /** The implement phase: how a feature task's prompt is built, and what counts as done. */
  phase: PhaseSpec;
  /** The answer phase: the same for a task that names no issue and no phase. */
  answerPhase: PhaseSpec;
  /** The judge both managers run on a task. Absent, a task settles on its phase's check alone. */
  judge?: HarnessJudge;
  /** Wall-clock budget for one harness run. */
  runTimeoutMs: number;
  /** The file-declared documents, as `resourcesFromDocs` built them. */
  resources: DeclaredResources;
}

/** True when a task names feature work's `issue` or `phase`. */
function namesFeatureWork(input: unknown): boolean {
  return typeof input === "object" && input !== null && ("issue" in input || "phase" in input);
}

/**
 * Build the working worker flow.
 *
 * @param options The installation, the harness slot, the workspaces, the phases, the judge and the documents.
 * @returns The flow factory `hireWorkforce` registers one copy of, which every coder worker runs on.
 * @throws If the harness isn't detached: the claim gate would refuse the entry.
 */
export function defineCoderWorkerFlow(options: CoderWorkerFlowOptions) {
  const { installation } = options;
  const readOwnFacts = defineReadOwnFacts(workerOf(installation, CODER_FLOW));
  const judge = options.judge === undefined ? {} : { judge: options.judge };

  // Feature work: a task that names an issue and a phase.
  const implement = harnessManager({
    ledgers: conversationLedgers,
    ...judge,
    tenant: undefined,
    phase: options.phase,
    workspace: options.workspace,
    runTimeoutMs: options.runTimeoutMs,
    harness: options.harness,
    // The collections a project's run source reads, on the blocks that ask it.
    ...("provision" in options.workspace ? { uses: [projectWorkspaceCapability] } : {}),
  } as never) as TaskWorker;

  // A user's ask: a task naming neither.
  const answer = harnessManager({
    name: ANSWER_MANAGER,
    ledgers: conversationLedgers,
    ...judge,
    tenant: undefined,
    phase: options.answerPhase,
    workspace: options.answerWorkspace,
    runTimeoutMs: options.runTimeoutMs,
    harness: options.harness,
    uses: [projectWorkspaceCapability],
  } as never) as TaskWorker;

  // The claim gate refuses an entry that authors session state beneath it;
  // `workerTaskEntry` keeps the turn's skill state on the session, which lets
  // a harness through that would. Refused here, at startup, naming the entry.
  for (const manager of [implement, answer]) {
    assertHandOffBlockSupported({ name: CODER_FLOW, target: WORKER_TASK_ENTRY, block: manager });
  }

  const byTask = router({
    name: "coder-by-task",
    inputSchema: taskWorkerInputSchema.passthrough(),
    routes: [implement, answer] as never,
    execute: (task: { input?: unknown }) => (namesFeatureWork(task.input) ? implement : answer),
  } as never) as BlockDefinition<any, any>;

  /** How a task's run is keyed: its task id, in its payload's phase or the answer phase. */
  const runOf = (row: Task) => {
    const input = row.input as { issue?: unknown; phase?: unknown } | undefined;
    if (typeof input?.issue === "string" && typeof input.phase === "string") {
      return { issue: row.id, phase: input.phase };
    }
    return namesFeatureWork(input) ? undefined : { issue: row.id, phase: options.answerPhase.phase };
  };

  // The board this session's run is on: the one of the session its task was
  // filed from, read from the session's own fields.
  const message = harnessMessageDoor({
    name: "coder",
    boards: async (ctx) => {
      const filed = await filingConversationBoard(ctx);
      const boards: MessageDoorBoard[] =
        filed === undefined
          ? []
          : [{ tasks: filed.tasks, orgScoped: false, drain: { drain: filed.runEntry, flowKind: filed.filingFlow }, runOf }];
      return boards;
    },
  });

  return defineFlow({
    kind: CODER_FLOW,
    // Registered once, under its flow name, which is what the coordinator's
    // dispatcher names in `flowKind`; the worker is named by the row's session.
    cardinality: "collection",
    configSchema: workerSettingsSchema(),
    session: installation.session(),
    // Installed at flow level. Org-scoped, and organization identity is
    // unconditional, so the org registry is always built for a request that
    // reaches the reading blocks.
    resources: { ...options.resources, ...installation.resources },
    actions: {
      [INSPECT_ENTRY]: {
        block: readOwnFacts,
        description: "Read what this worker can see of its own configuration. Writes nothing.",
      },
      // A user's message into one of this worker's running coding runs,
      // which stops and continues the same coding session with it.
      message,
    },
    // The one door: any session's tasks, handed over under its board's id.
    task: {
      actions: {
        [WORKER_TASK_ENTRY]: workerTaskEntry({ name: `${CODER_FLOW}-${WORKER_TASK_ENTRY}`, block: byTask }),
      },
    },
  } as never);
}
