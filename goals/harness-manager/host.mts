/**
 * Host flow for the harness-manager goal checks. The conductor lab used to supply it.
 *
 * Only what `answered-run-continues-its-session` calls: `seed`, `status`, and the
 * board's `updateTask` action, which answers the question a run's task is held on.
 * Not a conductor replacement: no tenant gate, no `wake`, no session door, and
 * `seed` does not interrogate a row it finds at its id. A third goal that needs
 * any of those should say so here rather than copy this host as if it had them.
 */
import { defineFlow, dispatcher, handler, sequencer } from "@flow-state-dev/core";
import { claudeCodeAgent } from "@flow-state-dev/claude-code/sdk";
import { z } from "zod";
import {
  defineTaskCollection,
  getOrCreateTaskCollection,
  openRowQuestions,
  resolveResourceCollection,
} from "@flow-state-dev/orchestration/tasks";
import { taskBoard, taskToolActions, taskToolSuffix } from "@flow-state-dev/orchestration/task-board";
import { taskSettledEntry } from "@flow-state-dev/orchestration";
import {
  assertBaseRefExists,
  assertCheckoutRootUsable,
  assertDistinctRepository,
  assertPositiveInt,
  harnessDrainBudgetMs,
  harnessManager,
  harnessTaskInputSchema,
  readRunRow,
  resolveOwnership,
  runRecordCollection,
  runRecordStateSchema,
  RUNS,
  runTopic,
  type PhaseSpec,
  type WorkspaceConfig,
} from "@flow-state-dev/harness-manager";
import {
  assertSafeSegment,
  canonicalSegment,
  harnessTaskId,
  joinIdentity,
} from "@flow-state-dev/harness-manager/checkout";
import { isAbsolute } from "node:path";

const ASSIGNEE = "harness" as const;

/** The flow kind; `createFlowState` registers the host under it. */
export const HARNESS_GOAL_FLOW_KIND = "harness-goal" as const;

export interface HarnessGoalFlowOptions {
  /** Names the board and the collection so two goals do not share rows. */
  epic: string;
  workspace: WorkspaceConfig;
  maxAttempts?: number;
  runTimeoutMs?: number;
  phase: PhaseSpec;
  /** `claudeCodeAgent`'s options, minus the feeds the manager's slot supplies and the two this host fixes. */
  agent?: Omit<
    Parameters<typeof claudeCodeAgent>[0],
    "detached" | "recordWork" | "cwd" | "resume" | "onSession" | "onUsage"
  >;
}

/** A positive whole number from the environment, or `fallback` when unset. */
export function positiveIntFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return assertPositiveInt(name, Number(raw));
}

/** The repository checkouts are cut from: `GOAL_HARNESS_REPO`, then the retired `GOAL_CONDUCTOR_REPO`. */
export function requireSourceRepo(): string {
  const repo = process.env.GOAL_HARNESS_REPO || process.env.GOAL_CONDUCTOR_REPO;
  if (repo === undefined || repo === "") {
    throw new Error(
      "GOAL_HARNESS_REPO is not set. It names the repository the coding agent works on, " +
        "and there is no safe default: falling back to this process's directory " +
        "would point the agent at the dispatcher's own repository.",
    );
  }
  assertDistinctRepository("GOAL_HARNESS_REPO", repo, process.cwd());
  return repo;
}

/** A row whose id is the one its own `{ issue, phase }` derives; any other has no run of its own to report. */
function rowOwnsItsIdentity(task: { id: string; input?: unknown }): boolean {
  const found = harnessTaskInputSchema.safeParse(task.input);
  if (!found.success) return false;
  try {
    return harnessTaskId(found.data.issue, found.data.phase) === task.id;
  } catch {
    return false;
  }
}

/** Build the host one goal check drives: the flow, the `updateTask` action's name, and the drain budget. */
export function harnessGoalFlow(options: HarnessGoalFlowOptions) {
  const {
    epic,
    workspace: callerWorkspace,
    maxAttempts = 3,
    runTimeoutMs = 1_800_000,
    phase: callerPhase,
    agent,
  } = options;

  const workspace: WorkspaceConfig = Object.freeze({ ...callerWorkspace });
  const phase: PhaseSpec = Object.freeze({ ...callerPhase });

  assertPositiveInt("runTimeoutMs", runTimeoutMs);
  assertPositiveInt("maxAttempts", maxAttempts);
  if (workspace.provisionTimeoutMs !== undefined) {
    assertPositiveInt("workspace.provisionTimeoutMs", workspace.provisionTimeoutMs);
  }
  for (const field of ["root", "sourceRepo"] as const) {
    if (!isAbsolute(workspace[field])) {
      throw new Error(
        `workspace.${field} is relative (${workspace[field]}). Pass an absolute path.`,
      );
    }
  }
  assertDistinctRepository("workspace.sourceRepo", workspace.sourceRepo, process.cwd());
  assertBaseRefExists(workspace.sourceRepo, workspace.baseRef, "workspace.baseRef");
  assertCheckoutRootUsable(workspace.root, "workspace.root");
  assertSafeSegment("phase", phase.phase);

  const boardId = joinIdentity("harness-goal", assertSafeSegment("epic", epic));
  const collectionId = joinIdentity("harness-goal-tasks", assertSafeSegment("epic", epic));

  const tasks = defineTaskCollection({
    id: collectionId,
    scope: "user",
    stateSchema: harnessTaskInputSchema,
  });

  const manager = harnessManager({
    boardCollectionId: collectionId,
    boardCollection: tasks,
    tenant: undefined,
    phase,
    workspace,
    runTimeoutMs,
    // The feeds are spread, so a feed the manager adds (onUsage was the last)
    // reaches the harness without an edit here.
    harness: (feeds) =>
      claudeCodeAgent({
        ...(agent ?? {}),
        ...feeds,
        detached: true,
        recordWork: true,
      }),
  });

  const board = taskBoard({
    name: boardId,
    boardId,
    mode: "delegation",
    collection: tasks,
    concurrency: 1,
    workers: {
      [ASSIGNEE]: dispatcher({
        name: `${boardId}-hand-off`,
        action: ASSIGNEE,
        // A task whose run already has a session goes on in it, so the turn an
        // answer owes runs where the asking turn did. A first run gets its own child.
        session: {
          by: async (task, ctx) => {
            const collection = resolveResourceCollection(ctx, collectionId);
            const row =
              collection === undefined
                ? undefined
                : (await getOrCreateTaskCollection({ ctx, backing: "resource", collectionId, collection })).get(task.taskId);
            const existing = row?.run?.sessionId;
            return existing !== undefined ? { id: existing } : { key: `task|${boardId}|${task.taskId}` };
          },
        },
      }),
    },
  });

  const seedTask = handler({
    name: "harness-goal-seed-task",
    inputSchema: harnessTaskInputSchema,
    outputSchema: z.object({ taskId: z.string() }),
    uses: [board.capability],
    execute: async (input, ctx) => {
      const taskId = harnessTaskId(input.issue, input.phase);
      const existing = await ctx.cap[boardId].getTask(taskId);
      if (existing !== undefined) return { taskId: existing.id };
      const task = await ctx.cap[boardId].createTask({
        id: taskId,
        goal: `Drive ${input.issue} through its ${input.phase} phase.`,
        assignee: ASSIGNEE,
        input: { issue: input.issue, phase: input.phase },
        maxAttempts,
        metadata: { topic: `${input.issue}/${input.phase}` },
      });
      return { taskId: task.id };
    },
  });

  const readStatus = handler({
    name: "harness-goal-status",
    inputSchema: z.object({ issue: z.string().optional() }),
    outputSchema: z.object({
      rows: z.array(
        z.object({
          taskId: z.string(),
          issue: z.string().nullable(),
          phase: z.string().nullable(),
          status: z.string(),
          attempts: z.number(),
          feedback: z.string().nullable(),
          run: runRecordStateSchema.nullable(),
          /** The open questions the task is held on; `question` is what `updateTask` takes. */
          questions: z.array(
            z.object({
              question: z.string(),
              text: z.string(),
              askedAt: z.number(),
            }),
          ),
        }),
      ),
    }),
    uses: [board.capability],
    resources: { [RUNS]: runRecordCollection },
    execute: async (input, ctx) => {
      const tasksOnBoard = await ctx.cap[boardId].listTasks();
      const rows = [];
      for (const task of tasksOnBoard) {
        const payload = harnessTaskInputSchema.safeParse(task.input);
        const issue = payload.success ? payload.data.issue : null;
        const phaseName = payload.success ? payload.data.phase : null;
        // Canonical on both sides: seeding `FIX-1` and `fix-1` resolve one row.
        if (
          input.issue !== undefined &&
          (issue === null || canonicalSegment(issue) !== canonicalSegment(input.issue))
        ) {
          continue;
        }
        const record =
          issue !== null && phaseName !== null && rowOwnsItsIdentity(task)
            ? await readRunRow(ctx, runTopic(collectionId, issue, phaseName))
            : undefined;
        rows.push({
          taskId: task.id,
          issue,
          phase: phaseName,
          status: task.status,
          attempts: task.attempts,
          feedback: task.feedback ?? null,
          run: record ?? null,
          questions: openRowQuestions(task).map((hold) => ({
            question: hold.id,
            text: hold.ask.prompt,
            askedAt: hold.openedAt,
          })),
        });
      }
      return { rows };
    },
  });

  // The board's `updateTask` action, followed by a drain when it succeeds: an
  // answer owes the held task one more turn, and the drain that handed it out
  // has already exited around the held row.
  const updateTaskAction = `updateTask_${taskToolSuffix(collectionId)}`;
  const updateTaskEntry = taskToolActions(board)[updateTaskAction]!;
  const updateTaskBlock = updateTaskEntry.block as unknown as { inputSchema: z.ZodTypeAny };

  const defineHost = defineFlow({
    kind: HARNESS_GOAL_FLOW_KIND,
    cardinality: "collection",
    task: { actions: { [ASSIGNEE]: { block: manager } } },
    internal: {
      actions: {
        // A board that hands rows out sends each ending here; `status` reads the
        // settled row from the board, so the notice carries nothing it needs.
        onTaskSettled: taskSettledEntry({
          block: handler({
            name: "harness-goal-task-settled",
            inputSchema: z.unknown(),
            outputSchema: z.object({}),
            execute: () => ({}),
          }),
        }),
      },
    },
    actions: {
      seed: {
        block: sequencer({
          name: "harness-goal-seed",
          inputSchema: harnessTaskInputSchema,
          outputSchema: z.object({ taskId: z.string() }),
        })
          // The drain's result is not the task id. tap keeps the id seed returned.
          .step(seedTask)
          .tap(board.drain),
      },
      status: { block: readStatus },
      [updateTaskAction]: {
        ...updateTaskEntry,
        block: sequencer({ name: "harness-goal-update-task", inputSchema: updateTaskBlock.inputSchema })
          .step(updateTaskEntry.block as never)
          .tapIf((outcome: { ok?: unknown }) => outcome?.ok === true, board.drain),
      },
    },
  });

  const flow = defineHost({ id: boardId });
  const drainBudgetMs = harnessDrainBudgetMs({
    runTimeoutMs,
    provisionTimeoutMs: workspace.provisionTimeoutMs,
    ownershipWaitMs: resolveOwnership({
      runTimeoutMs,
      provisionTimeoutMs: workspace.provisionTimeoutMs,
    }).ownership.waitMs,
  });

  return { flow, collectionId, updateTaskAction, drainBudgetMs };
}
