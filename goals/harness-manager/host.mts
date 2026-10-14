/**
 * Minimal host flow for the harness-manager goal checks.
 *
 * The retired conductor lab used to supply this. The goals only need seed,
 * status, message, and answer over one board and one handed-off manager.
 */
import { defineFlow, dispatcher, handler, sequencer } from "@flow-state-dev/core";
import { claudeCodeAgent } from "@flow-state-dev/claude-code/sdk";
import { z } from "zod";
import { defineTaskCollection } from "@flow-state-dev/orchestration/tasks";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import {
  assertBaseRefExists,
  assertCheckoutRootUsable,
  assertDistinctRepository,
  assertPositiveInt,
  harnessDrainBudgetMs,
  harnessManager,
  harnessTaskInputSchema,
  answerQuestion,
  INBOX,
  inboxCollection,
  listQuestions,
  parseQuestionTopic,
  readQuestion,
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
  harnessTaskId,
  joinIdentity,
} from "@flow-state-dev/harness-manager/checkout";
import { isAbsolute } from "node:path";

/** The one assignee this board routes to. */
const ASSIGNEE = "harness" as const;

/** How HTTP / `createFlowState` address this host. */
export const HARNESS_GOAL_FLOW_KIND = "harness-goal" as const;

export interface HarnessGoalFlowOptions {
  /** Names the board and the collection so two goals do not share rows. */
  epic: string;
  workspace: WorkspaceConfig;
  maxAttempts?: number;
  runTimeoutMs?: number;
  phase: PhaseSpec;
  agent?: Omit<
    Parameters<typeof claudeCodeAgent>[0],
    "detached" | "recordWork" | "cwd" | "resume" | "onSession"
  >;
}

/**
 * A positive whole number from the environment, or `fallback` when unset.
 */
export function positiveIntFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return assertPositiveInt(name, Number(raw));
}

/**
 * The repository checkouts are cut from. Absent is a configuration error.
 *
 * Reads `GOAL_HARNESS_REPO`, then the retired `GOAL_CONDUCTOR_REPO` name.
 */
export function requireSourceRepo(
  variable = "GOAL_HARNESS_REPO",
  dispatcher: string | readonly string[] = process.cwd(),
): string {
  const repo = process.env[variable] || process.env.GOAL_HARNESS_REPO || process.env.GOAL_CONDUCTOR_REPO;
  if (repo === undefined || repo === "") {
    throw new Error(
      `${variable} is not set. It names the repository the coding agent works on, ` +
        "and there is no safe default: falling back to this process's directory " +
        "would point the agent at the dispatcher's own repository.",
    );
  }
  assertDistinctRepository(variable, repo, dispatcher);
  return repo;
}

/** Build the host flow one goal check drives. */
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
    harness: ({ cwd, resume, onSession }) =>
      claudeCodeAgent({
        ...(agent ?? {}),
        cwd,
        resume,
        onSession,
        detached: true,
        recordWork: true,
      }),
  });

  const board = taskBoard({
    name: boardId,
    boardId,
    collection: tasks,
    concurrency: 1,
    workers: {
      [ASSIGNEE]: dispatcher({
        name: `${boardId}-hand-off`,
        action: ASSIGNEE,
        session: "per-task",
      }),
    },
    onReview: "exit",
  });

  const seedTask = handler({
    name: "harness-goal-seed-task",
    inputSchema: harnessTaskInputSchema,
    outputSchema: z.object({ taskId: z.string() }),
    uses: [board.capability],
    execute: async (input, ctx) => {
      const taskId = harnessTaskId(input.issue, input.phase);
      const existing = await ctx.cap[boardId].getTask(taskId);
      if (existing !== undefined) {
        await ctx.sequencer?.patchState({ taskId: existing.id });
        return { taskId: existing.id };
      }
      const task = await ctx.cap[boardId].addTask({
        id: taskId,
        goal: `Drive ${input.issue} through its ${input.phase} phase.`,
        assignee: ASSIGNEE,
        input: { issue: input.issue, phase: input.phase },
        maxAttempts,
        metadata: { topic: `${input.issue}/${input.phase}` },
      });
      await ctx.sequencer?.patchState({ taskId: task.id });
      return { taskId: task.id };
    },
  });

  const returnTaskId = handler({
    name: "harness-goal-return-task-id",
    inputSchema: z.unknown(),
    outputSchema: z.object({ taskId: z.string() }),
    execute: (_input, ctx) => {
      const taskId = (ctx.sequencer?.state as { taskId?: unknown } | undefined)?.taskId;
      if (typeof taskId !== "string" || taskId === "") {
        throw new Error("seed completed without recording a task id.");
      }
      return { taskId };
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
          questions: z.array(
            z.object({
              question: z.string(),
              text: z.string(),
              attempt: z.number(),
              askedAt: z.number().nullable(),
            }),
          ),
        }),
      ),
    }),
    uses: [board.capability],
    resources: { [RUNS]: runRecordCollection, [INBOX]: inboxCollection },
    execute: async (input, ctx) => {
      const tasksOnBoard = await ctx.cap[boardId].listTasks();
      const rows = [];
      for (const task of tasksOnBoard) {
        const payload = harnessTaskInputSchema.safeParse(task.input);
        const issue = payload.success ? payload.data.issue : null;
        const phaseName = payload.success ? payload.data.phase : null;
        if (input.issue !== undefined && issue !== input.issue) continue;
        const record =
          issue !== null && phaseName !== null
            ? await readRunRow(ctx, runTopic(collectionId, issue, phaseName))
            : undefined;
        const questions = [];
        if (issue !== null && phaseName !== null) {
          for (const row of await listQuestions(ctx as never, issue, phaseName)) {
            if (row.state.status !== "open") continue;
            questions.push({
              question: row.topic,
              text: row.state.question,
              attempt: row.attempt,
              askedAt: row.state.askedAt,
            });
          }
        }
        rows.push({
          taskId: task.id,
          issue,
          phase: phaseName,
          status: task.status,
          attempts: task.attempts,
          feedback: task.feedback ?? null,
          run: record ?? null,
          questions,
        });
      }
      return { rows };
    },
  });

  const answerInputSchema = z.object({
    question: z.string(),
    answer: z.string(),
  });
  const answerOutputSchema = z.object({
    result: z.enum(["answered", "declined"]),
    reason: z.string().nullable(),
    question: z.string(),
    drained: z.boolean(),
  });

  const answerQuestionStep = handler({
    name: "harness-goal-answer",
    inputSchema: answerInputSchema,
    outputSchema: answerOutputSchema,
    uses: [board.capability],
    resources: { [INBOX]: inboxCollection },
    execute: async (input, ctx) => {
      const coordinates = parseQuestionTopic(input.question);
      if (coordinates === undefined) {
        return { result: "declined" as const, reason: "malformed-question", question: input.question, drained: false };
      }
      const row = await readQuestion(ctx as never, input.question);
      if (row === undefined || row.status !== "open") {
        return { result: "declined" as const, reason: "question-not-open", question: input.question, drained: false };
      }
      const taskId = harnessTaskId(coordinates.issue, coordinates.phase);
      const task = await ctx.cap[boardId].getTask(taskId);
      if (task?.status !== "parked") {
        return { result: "declined" as const, reason: "task-not-parked", question: input.question, drained: false };
      }
      const write = await answerQuestion(ctx as never, input.question, input.answer);
      if (write.outcome === "refused") {
        return { result: "declined" as const, reason: "answer-lost-race", question: input.question, drained: false };
      }
      await ctx.cap[boardId].unpark(taskId);
      return { result: "answered" as const, reason: null, question: input.question, drained: true };
    },
  });

  const door = manager.messageDoor({ drain: "resume" });

  const defineHost = defineFlow({
    kind: HARNESS_GOAL_FLOW_KIND,
    cardinality: "collection",
    task: { actions: { [ASSIGNEE]: { block: manager } } },
    internal: {
      actions: {
        resume: { block: board.drain },
      },
    },
    actions: {
      seed: {
        block: sequencer({
          name: "harness-goal-seed",
          inputSchema: harnessTaskInputSchema,
          outputSchema: z.object({ taskId: z.string() }),
          stateSchema: z.object({ taskId: z.string().nullable().default(null) }),
        })
          .tap(seedTask)
          .step(board.drain)
          .step(returnTaskId),
      },
      status: { block: readStatus },
      answer: {
        block: sequencer({
          name: "harness-goal-answer-question",
          inputSchema: answerInputSchema,
          outputSchema: answerOutputSchema,
        })
          .step(answerQuestionStep)
          .tapIf((outcome: z.infer<typeof answerOutputSchema>) => outcome.drained, board.drain),
      },
      message: door,
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

  return { flow, collectionId, drainBudgetMs };
}
