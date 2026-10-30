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
 * an `issue` and a `phase` under `HARNESS_FEATURE_KEY` is feature work: the
 * implement manager runs it, and it needs a commit. A task naming no feature
 * work is a user's ask: the answer manager runs it, and it needs an answer
 * (D2), whatever else its `input` holds, a plain `issue` field included. A
 * task whose key names only one of the two goes to the implement manager,
 * which refuses it inside the run, after the claim, so the task ends
 * `errored` with one notice and never runs as an answer task. Both managers read each run's board from its claim, so one
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
 * **One door** covers both managers: a user's line typed in a run's own
 * session, whose task is found on the board of the session it was filed
 * from. While the task is open the line steers it, and the run takes it at
 * its next step; once the task has finished, the line is talk, answered by
 * one run resuming the task's coding session (FIX-2086). A steer a run's last
 * step missed is owed one more turn (`STEER_TURN_ENTRY`), which runs the task
 * again on its attempt.
 *
 * **A worker's message** lands in one of its tasks' sessions only, sent to the
 * task (FIX-2160). Once the task has finished, the message is talk too: the
 * same talk turn resumes the task's coding session with it, and the reply is
 * an item there. A message to an open task is refused before it is sent, so
 * it never reaches the work.
 *
 * Every coder worker runs on this worker flow's one copy. A session names its worker
 * (`installation.session()`), and the phases read that worker's own settings
 * through the installation, never `ctx.flow.config`.
 */

import { defineFlow, router, sequencer } from "@flow-state-dev/core";
import type { DeclaredResources } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import {
  harnessManager,
  harnessSessionDoor,
  harnessFeatureOf,
  harnessTalkTurn,
  namesHarnessFeature,
  taskIssueSegment,
  type HarnessFeeds,
  type HarnessJudge,
  type PhaseSpec,
  type WorkspaceConfig,
} from "@flow-state-dev/harness-manager";
import type { HarnessBlock } from "@flow-state-dev/core/types";
import { assertDispatchEntrySupported, taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import type { Task, TaskWorker } from "@flow-state-dev/orchestration/tasks";
import {
  conversationLedgers,
  filingConversationBoard,
  MESSAGE_RECEIVED_ENTRY,
  messageReceivedEntry,
  messageReceivedSchema,
  projectWorkspaceCapability,
  startOwedSteerTurn,
  STEER_TURN_ENTRY,
  steerTurnEntry,
  WORKER_TASK_ENTRY,
  workerMessagesResources,
  workerTaskEntry,
  type MessageReceived,
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
   * One expression, handed the feeds the harness manager declares. The gate
   * puts a scripted stub here; the honesty check puts a real coding agent
   * here. Nothing else differs between the two. Called once per manager.
   */
  harness: (feeds: HarnessFeeds) => HarnessBlock;
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
  /** The answer phase: the same for a task that names no feature work. */
  answerPhase: PhaseSpec;
  /** The judge both managers run on a task. Absent, a task settles on its phase's check alone. */
  judge?: HarnessJudge;
  /** Both managers hold a run with commits for the user's review (`reviewChanges`). Absent: off. */
  reviewChanges?: boolean;
  /** Wall-clock budget for one harness run. */
  runTimeoutMs: number;
  /**
   * Stop a running run for a user's steer, and continue its coding session
   * with the line in the same request (harness-manager's `stopsOnAbort`). Only
   * for a harness whose abort waits for its process to exit. Absent: off, and
   * a steer waits for the run's own end.
   */
  stopsOnAbort?: boolean;
  /** The file-declared documents, as `resourcesFromDocs` built them. */
  resources: DeclaredResources;
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
  const checks = {
    ...(options.judge === undefined ? {} : { judge: options.judge }),
    ...(options.reviewChanges === true ? { reviewChanges: true } : {}),
  };

  // Feature work: a task that names an issue and a phase under the feature key.
  const implement = harnessManager({
    ledgers: conversationLedgers,
    ...checks,
    tenant: undefined,
    phase: options.phase,
    workspace: options.workspace,
    runTimeoutMs: options.runTimeoutMs,
    ...(options.stopsOnAbort === true ? { stopsOnAbort: true } : {}),
    harness: options.harness,
    // The collections a project's run source reads, on the blocks that ask it.
    ...("provision" in options.workspace ? { uses: [projectWorkspaceCapability] } : {}),
  } as never) as TaskWorker;

  // A user's ask: a task naming no feature work.
  const answer = harnessManager({
    name: ANSWER_MANAGER,
    ledgers: conversationLedgers,
    ...checks,
    tenant: undefined,
    phase: options.answerPhase,
    workspace: options.answerWorkspace,
    runTimeoutMs: options.runTimeoutMs,
    ...(options.stopsOnAbort === true ? { stopsOnAbort: true } : {}),
    harness: options.harness,
    uses: [projectWorkspaceCapability],
  } as never) as TaskWorker;

  // The claim gate refuses an entry that authors session state beneath it;
  // `workerTaskEntry` keeps the turn's skill state on the session, which lets
  // a harness through that would. Refused here, at startup, naming the entry.
  for (const manager of [implement, answer]) {
    assertDispatchEntrySupported({ name: CODER_FLOW, target: WORKER_TASK_ENTRY, block: manager });
  }

  const byTask = router({
    name: "coder-by-task",
    inputSchema: taskWorkerInputSchema.passthrough(),
    routes: [implement, answer] as never,
    execute: (task: { input?: unknown }) => (namesHarnessFeature(task.input) ? implement : answer),
  } as never) as BlockDefinition<any, any>;

  /** How a task's run is keyed: its task id, in its payload's phase or the answer phase. */
  const runOf = (row: Task) => {
    const feature = harnessFeatureOf(row.input);
    if (feature !== undefined) return { issue: taskIssueSegment(row.id), phase: feature.phase };
    // A malformed key is no run here, never an answer run: the router sends it to implement, which refuses it.
    return namesHarnessFeature(row.input) ? undefined : { issue: taskIssueSegment(row.id), phase: options.answerPhase.phase };
  };

  // The board this session's run is on: the one of the session its task was
  // filed from, read from the session's own fields.
  const board = async (ctx: Parameters<typeof filingConversationBoard>[0]) => {
    const filed = await filingConversationBoard(ctx);
    return filed === undefined ? undefined : { tasks: filed.tasks, runOf };
  };
  const message = harnessSessionDoor({
    name: "coder",
    harness: options.harness,
    board,
    // A steer to a task running nothing (waiting on its filed work) starts the turn it is owed.
    onSteered: (ctx, row) => startOwedSteerTurn(ctx, row),
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
    resources: { ...options.resources, ...installation.resources, ...workerMessagesResources },
    actions: {
      [INSPECT_ENTRY]: {
        block: readOwnFacts,
        description: "Read what this worker can see of its own configuration. Writes nothing.",
      },
      // A user's line in one of this worker's runs' sessions: a steer while
      // its task is open, talk once it has finished.
      respond: message,
    },
    internal: {
      actions: {
        // The turn a steer the run's last step missed is owed (FIX-2086 D2):
        // the task once more, on its attempt, with every steer in its prompt.
        [STEER_TURN_ENTRY]: steerTurnEntry({ name: `${CODER_FLOW}-steer-turn`, block: byTask }),
        // A message lands in one of its tasks' sessions only: it has no
        // conversation to answer from, so one sent to it by name is refused
        // before anything is written (FIX-2238). One sent to a finished task
        // is answered by the talk turn, from the task's coding session
        // (FIX-2160); the coding agent has no sendMessage, so its reply stays
        // an item in that session.
        [MESSAGE_RECEIVED_ENTRY]: messageReceivedEntry({
          installation,
          flowKind: CODER_FLOW,
          hears: "task-sessions",
          turn: sequencer({ name: `${CODER_FLOW}-message-turn`, inputSchema: messageReceivedSchema }).step(
            (received: MessageReceived) => ({ message: `Message from ${received.from}, another worker: ${received.text}` }),
            harnessTalkTurn({ name: `${CODER_FLOW}-message`, harness: options.harness, board })
          ),
        }),
      },
    },
    // The one door: any session's tasks, handed over under its board's id.
    task: {
      actions: {
        [WORKER_TASK_ENTRY]: workerTaskEntry({ name: `${CODER_FLOW}-${WORKER_TASK_ENTRY}`, block: byTask }),
      },
    },
  } as never);
}
