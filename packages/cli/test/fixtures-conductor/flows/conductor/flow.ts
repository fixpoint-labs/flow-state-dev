/**
 * A conductor-shaped fixture: the four operator actions, session-scoped board.
 * Exists so `fsdev conductor` can be tested without the lab's git/Claude host.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";

const questionSchema = z.object({
  question: z.string(),
  text: z.string(),
  attempt: z.number(),
  askedAt: z.number().nullable(),
});

const rowSchema = z.object({
  taskId: z.string(),
  issue: z.string().nullable(),
  phase: z.string().nullable(),
  status: z.string(),
  attempts: z.number(),
  feedback: z.string().nullable(),
  run: z
    .object({
      attempt: z.number().nullable(),
      taskId: z.string().nullable(),
      workspacePath: z.string().nullable(),
      branch: z.string().nullable(),
      outcome: z.enum(["running", "succeeded", "failed"]).nullable(),
      reason: z.string().nullable(),
      sessionId: z.string().nullable(),
      finalMessage: z.string().nullable(),
      usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }).nullable(),
      costUsd: z.number().nullable(),
      childSessionId: z.string().nullable(),
      requestId: z.string().nullable(),
      updatedAt: z.number().nullable(),
    })
    .nullable(),
  questions: z.array(questionSchema),
});

const boardState = z.object({
  rows: z.array(rowSchema).default([]),
});

type Board = z.infer<typeof boardState>;
type Row = z.infer<typeof rowSchema>;

function emptyRun(): NonNullable<Row["run"]> {
  return {
    attempt: 1,
    taskId: null,
    workspacePath: null,
    branch: null,
    outcome: "running",
    reason: null,
    sessionId: null,
    finalMessage: null,
    usage: null,
    costUsd: null,
    childSessionId: null,
    requestId: null,
    updatedAt: Date.now(),
  };
}

const seed = handler({
  name: "fixture-seed",
  inputSchema: z.object({ issue: z.string(), phase: z.string().default("implement") }),
  outputSchema: z.object({ taskId: z.string() }),
  sessionStateSchema: boardState,
  execute: async (input, ctx) => {
    const taskId = `${input.issue}--${input.phase}`;
    const rows = [...((ctx.session.state as Board).rows ?? [])];
    if (!rows.some((row) => row.taskId === taskId)) {
      rows.push({
        taskId,
        issue: input.issue,
        phase: input.phase,
        status: "pending",
        attempts: 0,
        feedback: null,
        run: null,
        questions: [],
      });
    }
    await ctx.session.patchState({ rows });
    ctx.emit.status(`seeded ${taskId}`, { transient: false });
    return { taskId };
  },
});

const wake = handler({
  name: "fixture-wake",
  inputSchema: z.unknown(),
  outputSchema: z.object({ drained: z.number() }),
  sessionStateSchema: boardState,
  execute: async (_input, ctx) => {
    const rows = ((ctx.session.state as Board).rows ?? []).map((row) => {
      if (row.status !== "pending") return row;
      if (row.issue === "LIVE-1" || row.issue === "LIVE-2") {
        return {
          ...row,
          status: "in_progress",
          attempts: row.attempts + 1,
          run: {
            ...emptyRun(),
            outcome: "running" as const,
            requestId: row.issue === "LIVE-1" ? "req-live-1" : "req-live-2",
            branch: `conductor/${row.issue}--implement`,
            workspacePath: `/tmp/conductor-src/.fsdev/workspaces/${row.issue}--implement`,
          },
          questions: [],
        };
      }
      if (row.issue === "FAIL-1") {
        return {
          ...row,
          status: "pending",
          attempts: row.attempts + 1,
          feedback: "Not logged in · Please run /login",
          run: {
            ...emptyRun(),
            outcome: "failed" as const,
            reason: "Not logged in · Please run /login",
          },
          questions: [],
        };
      }
      return {
        ...row,
        status: "in_progress",
        attempts: row.attempts + 1,
        run: emptyRun(),
        questions:
          row.issue === "ASK-1"
            ? [
                {
                  question: `${row.issue}/${row.phase}/1/q`,
                  text: "Which path?",
                  attempt: 1,
                  askedAt: Date.now(),
                },
              ]
            : row.questions,
      };
    });
    const parked = rows.map((row) =>
      row.questions.length > 0 ? { ...row, status: "awaiting_review", run: { ...emptyRun(), outcome: "succeeded" as const } } : row,
    );
    await ctx.session.patchState({ rows: parked });
    ctx.emit.status("claiming pending rows");
    ctx.emit.status("running claimed rows");
    const asked = parked.find((row) => row.questions.length > 0);
    if (asked !== undefined) {
      ctx.emit.message(`parked ${asked.issue} on ${asked.questions[0]?.text ?? "a question"}`);
    }
    ctx.emit.status(`drained ${parked.length}`, { transient: false });
    return { drained: parked.length };
  },
});

const status = handler({
  name: "fixture-status",
  inputSchema: z.object({ issue: z.string().optional() }),
  outputSchema: z.object({ rows: z.array(rowSchema) }),
  sessionStateSchema: boardState,
  execute: (input, ctx) => {
    const rows = ((ctx.session.state as Board).rows ?? []).filter(
      (row) => input.issue === undefined || row.issue === input.issue,
    );
    return { rows };
  },
});

const answer = handler({
  name: "fixture-answer",
  inputSchema: z.object({ question: z.string(), answer: z.string() }),
  outputSchema: z.object({
    result: z.enum(["answered", "recovered", "declined"]),
    reason: z.string().nullable(),
    question: z.string(),
    taskStatus: z.string().nullable(),
    questionStatus: z.string().nullable(),
    drained: z.boolean(),
  }),
  sessionStateSchema: boardState,
  execute: async (input, ctx) => {
    const rows = ((ctx.session.state as Board).rows ?? []).map((row) => {
      if (!row.questions.some((q) => q.question === input.question)) return row;
      return {
        ...row,
        status: "completed",
        questions: [],
        feedback: input.answer,
        run: { ...emptyRun(), outcome: "succeeded" as const },
      };
    });
    const hit = ((ctx.session.state as Board).rows ?? []).some((row) =>
      row.questions.some((q) => q.question === input.question),
    );
    await ctx.session.patchState({ rows });
    if (!hit) {
      return {
        result: "declined" as const,
        reason: "unknown-question",
        question: input.question,
        taskStatus: null,
        questionStatus: null,
        drained: false,
      };
    }
    ctx.emit.status(`answered ${input.question}`, { transient: false });
    return {
      result: "answered" as const,
      reason: null,
      question: input.question,
      taskStatus: "completed",
      questionStatus: "answered",
      drained: true,
    };
  },
});

const conductor = defineFlow({
  kind: "conductor",
  requireUser: true,
  session: { stateSchema: boardState },
  actions: {
    seed: { block: seed },
    wake: { block: wake },
    status: { block: status },
    answer: { block: answer },
  },
});

export default conductor({ id: "fixture-epic" });
