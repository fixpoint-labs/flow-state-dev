/**
 * A conductor-shaped fixture: the operator actions, session-scoped board.
 * Exists so `fsdev conductor` can be tested without the lab's git/Claude host.
 * `steer` is deterministic keyword routing — no model — so talk can be tested.
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
      prUrl: z.string().nullable().optional(),
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

async function fileIssue(
  ctx: { session: { state: Board; patchState: (patch: Partial<Board>) => Promise<unknown> }; emit: { status: (text: string, extra?: { transient?: boolean }) => void } },
  issue: string,
  phase: string,
): Promise<string> {
  const taskId = `${issue}--${phase}`;
  const rows = [...((ctx.session.state as Board).rows ?? [])];
  if (!rows.some((row) => row.taskId === taskId)) {
    rows.push({
      taskId,
      issue,
      phase,
      status: "pending",
      attempts: 0,
      feedback: null,
      run: null,
      questions: [],
    });
  }
  await ctx.session.patchState({ rows });
  ctx.emit.status(`seeded ${taskId}`, { transient: false });
  return taskId;
}

const seed = handler({
  name: "fixture-seed",
  inputSchema: z.object({ issue: z.string(), phase: z.string().default("implement") }),
  outputSchema: z.object({ taskId: z.string() }),
  sessionStateSchema: boardState,
  execute: async (input, ctx) => {
    const taskId = await fileIssue(ctx, input.issue, input.phase);
    return { taskId };
  },
});

async function drainPending(ctx: {
  session: { state: Board; patchState: (patch: Partial<Board>) => Promise<unknown> };
  emit: {
    status: (text: string, extra?: { transient?: boolean }) => void;
    message: (text: string) => void;
  };
}): Promise<number> {
    const rows = ((ctx.session.state as Board).rows ?? []).map((row) => {
      if (row.issue === "DONE-1" && row.status === "in_progress") {
        return {
          ...row,
          status: "completed",
          run: {
            ...emptyRun(),
            outcome: "succeeded" as const,
            requestId: "req-done-1",
          },
          questions: [],
        };
      }
      if (row.status !== "pending") return row;
      if (row.issue === "DONE-1" || row.issue === "LIVE-1" || row.issue === "LIVE-2") {
        return {
          ...row,
          status: "in_progress",
          attempts: row.attempts + 1,
          run: {
            ...emptyRun(),
            outcome: "running" as const,
            requestId:
              row.issue === "LIVE-1"
                ? "req-live-1"
                : row.issue === "LIVE-2"
                  ? "req-live-2"
                  : "req-done-1",
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
            requestId: "req-fail-1",
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
    return parked.length;
}

function waitUntilAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const fail = () => reject(new DOMException("Aborted", "AbortError"));
    if (signal.aborted) {
      fail();
      return;
    }
    signal.addEventListener("abort", fail, { once: true });
  });
}

const wake = handler({
  name: "fixture-wake",
  inputSchema: z.unknown(),
  outputSchema: z.object({ drained: z.number() }),
  sessionStateSchema: boardState,
  execute: async (_input, ctx) => {
    const hanging = ((ctx.session.state as Board).rows ?? []).some((row) => row.issue === "HANG-1");
    if (hanging) {
      ctx.emit.status("hanging until abort", { transient: false });
      await waitUntilAborted(ctx.signal);
    }
    const drained = await drainPending(ctx);
    return { drained };
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

async function replyToQuestion(
  ctx: {
    session: { state: Board; patchState: (patch: Partial<Board>) => Promise<unknown> };
    emit: { status: (text: string, extra?: { transient?: boolean }) => void };
  },
  question: string,
  text: string,
): Promise<{ result: "answered" | "declined"; reason: string | null }> {
  const rows = ((ctx.session.state as Board).rows ?? []).map((row) => {
    if (!row.questions.some((q) => q.question === question)) return row;
    return {
      ...row,
      status: "completed",
      questions: [],
      feedback: text,
      run: { ...emptyRun(), outcome: "succeeded" as const },
    };
  });
  const hit = ((ctx.session.state as Board).rows ?? []).some((row) =>
    row.questions.some((q) => q.question === question),
  );
  await ctx.session.patchState({ rows });
  if (!hit) return { result: "declined", reason: "unknown-question" };
  ctx.emit.status(`answered ${question}`, { transient: false });
  return { result: "answered", reason: null };
}

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
    const decided = await replyToQuestion(ctx, input.question, input.answer);
    if (decided.result === "declined") {
      return {
        result: "declined" as const,
        reason: decided.reason,
        question: input.question,
        taskStatus: null,
        questionStatus: null,
        drained: false,
      };
    }
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

const steer = handler({
  name: "fixture-steer",
  inputSchema: z.object({ message: z.string().min(1) }),
  outputSchema: z.string(),
  sessionStateSchema: boardState,
  execute: async (input, ctx) => {
    // A talk turn that only returns output — no streamed message — so the
    // board's fallback line can be tested across two turns.
    if (input.message.startsWith("quiet ")) {
      return input.message.slice("quiet ".length);
    }

    const seedHit = /\b(?:seed|start|file|implement)\s+([A-Za-z][\w.-]*)/i.exec(input.message);
    const answerHit = /\banswer\s+(\S+)\s+(.+)/is.exec(input.message);
    const retry = /\b(?:wake|retry|again)\b/i.test(input.message);

    if (seedHit?.[1] !== undefined) {
      await fileIssue(ctx, seedHit[1], "implement");
      await drainPending(ctx);
      const said = `started ${seedHit[1]}`;
      ctx.emit.message(said);
      return said;
    }
    if (answerHit?.[1] !== undefined && answerHit[2] !== undefined) {
      const result = await replyToQuestion(ctx, answerHit[1], answerHit[2].trim());
      const said =
        result.result === "declined"
          ? `declined ${result.reason ?? "refused"}`
          : `answered ${answerHit[1]}`;
      ctx.emit.message(said);
      return said;
    }
    if (retry) {
      await drainPending(ctx);
      ctx.emit.message("woke the board");
      return "woke the board";
    }

    const rows = (ctx.session.state as Board).rows ?? [];
    const said =
      rows.length === 0
        ? "No rows yet. Name an issue and I will start it."
        : `Board has ${rows.length} row(s). I can start an issue, wake a retry, or answer a question.`;
    ctx.emit.message(said);
    return said;
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
    steer: { block: steer, userMessage: (input: { message: string }) => input.message },
  },
});

export default conductor({ id: "fixture-epic" });
