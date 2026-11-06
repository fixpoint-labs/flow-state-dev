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
 * **A worker can pick its harness** (FIX-2486). Beside the default slot, the
 * flow takes named harnesses (`harnesses`), and a worker naming one in its
 * `harness` setting (`harness: cursor`) has its tasks, steers and talk run
 * through managers built for that one. A worker naming none runs on the
 * default; a name the flow doesn't run is refused at hire, never run on
 * another harness.
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
import { taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import { assertDispatchEntrySupported } from "@flow-state-dev/orchestration/internal";
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
import { z } from "zod";
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

/** The setting a `coder` worker names its coding harness by: `harness: cursor` in its `WORKER.md`, or in a hire's `settings`. */
export const HARNESS_SETTING = "harness";

/** A coding harness a worker on this flow may run on, beside the default slot. */
export interface CoderHarness {
  /** How the managers are pointed at it, as {@link CoderWorkerFlowOptions.harness} is. */
  slot: (feeds: HarnessFeeds) => HarnessBlock;
  /** Wall-clock budget for one of its runs. Absent: the flow's `runTimeoutMs`. */
  runTimeoutMs?: number;
  /** As {@link CoderWorkerFlowOptions.stopsOnAbort}, for this harness. Absent: the flow's, else what the harness declares. */
  stopsOnAbort?: boolean;
}

/**
 * The harness names a `coder` worker may set: the default's name, when it has
 * one, then every named harness, each once. Empty when the flow was given
 * neither, and then a worker naming any harness is refused at hire.
 */
export function coderHarnessNames(options: Pick<CoderWorkerFlowOptions, "harnessName" | "harnesses">): string[] {
  return [...new Set([...(options.harnessName === undefined ? [] : [options.harnessName]), ...Object.keys(options.harnesses ?? {})])];
}

/**
 * The flow's settings: the lab's, and `harness` naming one of `names`. A name
 * outside them is refused at hire with the names it could have been, so a
 * worker is never written on a harness nothing here runs, and never runs on
 * another one instead.
 */
function coderSettingsSchema(names: readonly string[]) {
  if (names.length === 0) return workerSettingsSchema();
  const listed = names.join(", ");
  return workerSettingsSchema().extend({
    [HARNESS_SETTING]: z
      .string()
      .refine((name) => names.includes(name), (name) => ({
        message: `harness "${name}" is not one this Shift Manager runs; pick one of: ${listed}`,
      }))
      .optional(),
  });
}

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
   * The default slot's harness name, which a worker may also name in its
   * `harness:` setting to run on it. Absent: a worker can name it only if
   * {@link harnesses} holds it too.
   */
  harnessName?: string;
  /**
   * **The harnesses a worker picks.** Each a worker may name in its
   * `harness:` setting (`harness: cursor`), and its tasks, steers and talk run
   * through that one instead of the default slot. A worker naming none runs on
   * the default. Absent or empty, every worker runs on the default slot.
   */
  harnesses?: Readonly<Record<string, CoderHarness>>;
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
  /** Both managers ask the user before a run's tool calls (`approveTools`). Absent: off. */
  approveTools?: boolean;
  /** Wall-clock budget for one harness run. */
  runTimeoutMs: number;
  /**
   * Stop a running run for a user's steer, and continue its coding session
   * with the line in the same request (harness-manager's `stopsOnAbort`). Only
   * for a harness whose abort waits for its process to exit. Absent: what the
   * harness declares (Claude Code stops; the stub doesn't, and a steer waits
   * for the run's own end).
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
    ...(options.approveTools === true ? { approveTools: true } : {}),
  };

  /** How a task's run is keyed: its task id, in its payload's phase or the answer phase. */
  const runOf = (row: Task) => {
    const feature = harnessFeatureOf(row.input);
    if (feature !== undefined) return { issue: taskIssueSegment(row.id), phase: feature.phase ?? options.phase.phase };
    // A malformed key is no run here, never an answer run: the router sends it to implement, which refuses it.
    return namesHarnessFeature(row.input) ? undefined : { issue: taskIssueSegment(row.id), phase: options.answerPhase.phase };
  };

  // The board this session's run is on: the one of the session its task was
  // filed from, read from the session's own fields.
  const board = async (ctx: Parameters<typeof filingConversationBoard>[0]) => {
    const filed = await filingConversationBoard(ctx);
    return filed === undefined ? undefined : { tasks: filed.tasks, runOf };
  };

  /**
   * Everything that drives a harness, built for one: the two managers, the
   * router between them, the door a line typed in a run's session takes, and
   * the talk turn another worker's message to a finished task takes. A
   * manager's harness is fixed when it is built, so each harness a worker may
   * name gets its own. The default's names are the ones runs were always
   * recorded under; a named harness's carry its name.
   */
  const buildFor = (harness: CoderHarness, suffix: string) => {
    const runTimeoutMs = harness.runTimeoutMs ?? options.runTimeoutMs;
    const stopsOnAbort = harness.stopsOnAbort ?? options.stopsOnAbort;
    // Feature work: a task that names an issue and a phase under the feature key.
    const implement = harnessManager({
      ...(suffix === "" ? {} : { name: `harness-manager${suffix}` }),
      ledgers: conversationLedgers,
      ...checks,
      tenant: undefined,
      phase: options.phase,
      workspace: options.workspace,
      runTimeoutMs,
      ...(stopsOnAbort === undefined ? {} : { stopsOnAbort }),
      harness: harness.slot,
      // The collections a project's run source reads, on the blocks that ask it.
      ...("provision" in options.workspace ? { uses: [projectWorkspaceCapability] } : {}),
    } as never) as TaskWorker;

    // A user's ask: a task naming no feature work.
    const answer = harnessManager({
      name: `${ANSWER_MANAGER}${suffix}`,
      ledgers: conversationLedgers,
      ...checks,
      tenant: undefined,
      phase: options.answerPhase,
      workspace: options.answerWorkspace,
      runTimeoutMs,
      ...(stopsOnAbort === undefined ? {} : { stopsOnAbort }),
      harness: harness.slot,
      uses: [projectWorkspaceCapability],
    } as never) as TaskWorker;

    // The claim gate refuses an entry that authors session state beneath it;
    // `workerTaskEntry` keeps the turn's skill state on the session, which lets
    // a harness through that would. Refused here, at startup, naming the entry.
    for (const manager of [implement, answer]) {
      assertDispatchEntrySupported({ name: CODER_FLOW, target: WORKER_TASK_ENTRY, block: manager });
    }

    const byTask = router({
      name: `coder-by-task${suffix}`,
      inputSchema: taskWorkerInputSchema.passthrough(),
      routes: [implement, answer] as never,
      execute: (task: { input?: unknown }) => (namesHarnessFeature(task.input) ? implement : answer),
    } as never) as BlockDefinition<any, any>;

    const door = harnessSessionDoor({
      name: `coder${suffix}`,
      harness: harness.slot,
      board,
      // A steer to a task running nothing (waiting on its filed work) starts the turn it is owed.
      onSteered: (ctx, row) => startOwedSteerTurn(ctx, row),
    });
    const talk = harnessTalkTurn({ name: `${CODER_FLOW}-message${suffix}`, harness: harness.slot, board });
    return { byTask, door, talk };
  };

  type Built = ReturnType<typeof buildFor>;
  const defaultBuilt = buildFor({ slot: options.harness }, "");
  const named = new Map<string, Built>(
    Object.entries(options.harnesses ?? {})
      .filter(([name]) => name !== options.harnessName)
      .map(([name, harness]) => [name, buildFor(harness, `-${name}`)]),
  );
  const harnessNames = coderHarnessNames(options);

  /**
   * What the session's worker names in its `harness:` setting, read from the
   * worker this turn resolves (a declared one, or the user's own on the
   * roster). A worker naming none, or the default's own name, runs on the
   * default; the config schema refused every other name at hire, so a name
   * built for nothing here is a worker written before its harness went away,
   * and is refused rather than run on another.
   */
  const builtFor = async (ctx: unknown): Promise<Built> => {
    const worker = await workerOf(installation, CODER_FLOW)(ctx as never);
    const name = worker.config.harness;
    if (name === undefined || name === options.harnessName) return defaultBuilt;
    const found = named.get(name);
    if (found === undefined) {
      throw new Error(
        `worker "${worker.id}" names harness "${name}", which this Shift Manager doesn't run; it runs ${harnessNames.join(", ")}`,
      );
    }
    return found;
  };
  const all = [defaultBuilt, ...named.values()];
  /**
   * A router over one piece of every harness's build, picked by the session's
   * worker. With no named harness there is nothing to pick, and the piece is
   * used as it is: the block tree stays what it was before workers could pick.
   */
  const byHarness = (name: string, inputSchema: unknown, pick: (built: Built) => unknown) =>
    named.size === 0
      ? (pick(defaultBuilt) as BlockDefinition<any, any>)
      : (router({
          name,
          inputSchema,
          routes: all.map(pick),
          // The worker is read off the user's roster, so the router declares the installation's resources.
          resources: installation.resources,
          execute: async (_input: unknown, ctx: unknown) => pick(await builtFor(ctx)),
        } as never) as BlockDefinition<any, any>);

  const byTask = byHarness("coder-by-harness", taskWorkerInputSchema.passthrough(), (built) => built.byTask);
  const message = {
    ...defaultBuilt.door,
    block: byHarness("coder-door-by-harness", defaultBuilt.door.inputSchema, (built) => built.door.block),
  };
  const talk = byHarness("coder-talk-by-harness", z.object({ message: z.string() }), (built) => built.talk);

  return defineFlow({
    kind: CODER_FLOW,
    // Registered once, under its flow name, which is what the coordinator's
    // dispatcher names in `flowKind`; the worker is named by the row's session.
    cardinality: "collection",
    configSchema: coderSettingsSchema(harnessNames),
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
            talk
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
