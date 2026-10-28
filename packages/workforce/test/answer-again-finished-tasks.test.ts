/**
 * A user's running turn hears the tasks that finished while it answered
 * (FIX-2159): the worker answers, the answer-again step takes what finished
 * (`takeFinishedTasks`), the line lands in that same request under the
 * delegate's name, and the worker answers again with it. The queued
 * `onTaskSettled` then finds nothing owed, so the result is heard once.
 *
 * The flow here is an app's own worker flow carrying the filing kit, whose
 * turn runs no model: it files the test's tasks for `eng.tasker` and holds the
 * answer open until they end, so each ending lands while the turn runs. One
 * leg runs the built-in `agent` flow with `answerAgain: true` on a scripted
 * model, for the option itself.
 *
 * Every leg reads what it asserts back from the session's stored items and the
 * store's rows, never from the take's return.
 */
import { describe, expect, it, vi } from "vitest";

/** Toggles for the two seams a leg breaks: the Error Reporter's intake, and the take's acknowledgement. */
const seams = vi.hoisted(() => ({ refuseReportInUserTurn: false, failAckInUserTurn: false, reports: [] as string[] }));

vi.mock("../src/conversation-board/report-owed", async (original) => {
  const actual = await original<typeof import("../src/conversation-board/report-owed")>();
  const { isUserTurn } = await import("../src/standing-rules/user-turn");
  return {
    ...actual,
    sendTaskReport: async (...args: Parameters<typeof actual.sendTaskReport>) => {
      const [ctx, row] = args;
      if (seams.refuseReportInUserTurn && isUserTurn(ctx)) {
        seams.reports.push(`not-taken:${row.id}`);
        return "not-taken" as const;
      }
      seams.reports.push(`sent:${row.id}`);
      return actual.sendTaskReport(...args);
    }
  };
});

vi.mock("../src/conversation-board/ledger", async (original) => {
  const actual = await original<typeof import("../src/conversation-board/ledger")>();
  const { isUserTurn } = await import("../src/standing-rules/user-turn");
  return {
    ...actual,
    // A process that dies between the dedupe write and the acknowledgement, in
    // a user's turn: the clear of a notice's marker never lands.
    ownConversationLedger: async (ctx: Parameters<typeof actual.ownConversationLedger>[0]) => {
      const ref = await actual.ownConversationLedger(ctx);
      if (ref === undefined || !seams.failAckInUserTurn || !isUserTurn(ctx)) return ref;
      return new Proxy(ref, {
        get(target, key, receiver) {
          if (key !== "patchMetadata") return Reflect.get(target, key, receiver);
          return async (id: string, patch: Record<string, unknown>) => {
            if (Object.entries(patch).some(([k, v]) => k.startsWith("noticeOwed:") && v === null)) {
              throw new Error("the process died before the acknowledgement");
            }
            return target.patchMetadata(id, patch as never);
          };
        }
      });
    }
  };
});

import { handler, sequencer, defineFlow } from "@flow-state-dev/core";
import type { BlockContext, BlockDefinition } from "@flow-state-dev/core/types";
import { isTerminalStatus, readCommittedTask } from "@flow-state-dev/orchestration/tasks";
import { mockGenerator } from "@flow-state-dev/testing";
import { z } from "zod";
import { defineSessionBoard, finishedTasksAnswerAgain, MAX_ANSWERS_AGAIN, workerConfigSchema, type WorkerManifest } from "../src";
import { ownConversationLedger } from "../src/conversation-board/ledger";
import { takesNotice } from "../src/conversation-board/take-finished";
import { REPLY_CONCURRENCY } from "../src/conversation-board/task-settled";
import { markUserTurnStep } from "../src/standing-rules/user-turn";
import type { WorkerInstallation } from "../src/workers/installation";
import { boardWorkers, bootBoardHost, messageOf, type BoardHost } from "./conversation-board-harness";

const doorInput = z.object({ message: z.string() });
const FINISHED = "These tasks you handed out finished while you answered";
const PLAN = "The steps you filed for yourself have ended";
const STEP = "You are working a step you filed for yourself";

type Turn = { requestId: string; kind: "turn" | "again" | "notice" | "step"; message: string };

type Controls = {
  /** What the user's turn files for `eng.tasker`, or (with `self`) for the worker itself, as a step. */
  file: Array<{ id: string; goal: string; self?: boolean }>;
  /** Held after the filing, before the turn answers: the endings land meanwhile. */
  waitInTurn?: () => Promise<void>;
  /** Held in the nth answer again (from 1), before it answers. */
  inAnswerAgain?: (n: number) => Promise<void>;
  turns: Turn[];
};

/** An app's own worker flow on the filing kit: a door, a turn that files and answers, and the answer-again source under test. */
function deskFlow(installation: WorkerInstallation, controls: Controls, source: BlockDefinition<any, any> | undefined, marksUserTurn: boolean) {
  const board = defineSessionBoard({ installation, flowKind: "desk" });
  const turn = handler({
    name: "desk-turn",
    inputSchema: doorInput,
    outputSchema: z.unknown(),
    resources: { ...installation.resources, ...board.resources },
    execute: async (input, rawCtx) => {
      const ctx = rawCtx as unknown as BlockContext;
      const requestId = ctx.request.identity.id;
      const message = input.message;
      if (message.startsWith(STEP)) {
        controls.turns.push({ requestId, kind: "step", message });
        return "step done";
      }
      if (message.startsWith(FINISHED) || message.startsWith(PLAN) || message.startsWith("again:")) {
        controls.turns.push({ requestId, kind: "again", message });
        const n = controls.turns.filter((t) => t.kind === "again" && t.requestId === requestId).length;
        await controls.inAnswerAgain?.(n);
        return `answered again (${n})`;
      }
      if (message.startsWith('Task "')) {
        controls.turns.push({ requestId, kind: "notice", message });
        return "heard after the turn";
      }
      controls.turns.push({ requestId, kind: "turn", message });
      const ref = await board.board.turnResolver(ctx as never);
      const worker = String((ctx.session.state as Record<string, unknown>).workerId);
      for (const task of controls.file) await ref!.addTask({ id: task.id, goal: task.goal, assignee: task.self === true ? worker : "eng.tasker" });
      await controls.waitInTurn?.();
      return "filed";
    }
  });
  const planned = board.planned(turn, source);
  const door = marksUserTurn ? sequencer({ name: "desk-user-turn", inputSchema: doorInput }).tap(markUserTurnStep).step(planned) : planned;
  const resolveWorker = handler({
    name: "desk-resolve-worker",
    inputSchema: z.unknown(),
    outputSchema: z.object({ worker: z.string() }),
    resources: { ...installation.resources },
    execute: async (_input, ctx) => ({ worker: (await installation.resolveWorker(ctx, "desk")).id })
  });
  return defineFlow({
    kind: "desk",
    configSchema: workerConfigSchema(),
    session: { ...installation.session(board.sessionStateShape), serverOwned: [...board.serverOwned] },
    resources: { ...installation.resources, ...board.resources },
    request: { onStarted: resolveWorker },
    actions: {
      respond: {
        inputSchema: doorInput.strict(),
        block: door,
        userMessage: (input: { message: string }) => input.message,
        // The user's door holds the reply line, as the agent flow's does, so a queued notice waits for the reply.
        concurrency: REPLY_CONCURRENCY
      },
      ...board.actions
    },
    internal: { actions: board.entries(planned) }
  } as never);
}

const worker = (id: string, declared: Record<string, unknown>, body = ""): WorkerManifest => ({ id, declared, body, skills: [] });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function host(options: { source?: BlockDefinition<any, any>; marksUserTurn?: boolean; questions?: Map<string, Promise<void>> } = {}) {
  const controls: Controls = { file: [], turns: [] };
  const h = bootBoardHost({
    standard: [...boardWorkers(), worker("clerk", { flow: "desk", delegates: ["eng.tasker"] })],
    flows: (installation) => ({
      desk: { flow: deskFlow(installation, controls, options.source, options.marksUserTurn ?? true), roles: ["manager"] }
    }),
    ...(options.questions === undefined ? {} : { questions: options.questions })
  });
  /** Until each named row reads ended in the store. */
  const ended = async (...ids: string[]) => {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const rows = await h.rows("alice");
      if (ids.every((id) => rows.some((row) => row.id === id && isTerminalStatus(row.status)))) return;
      if (Date.now() > deadline) throw new Error(`rows ${ids.join(", ")} never ended`);
      await sleep(10);
    }
  };
  /** The user's turn, through the host's dispatch: its request id, once every request settled. */
  const sendMessage = async (sessionId: string) => {
    const requestId = await h.post("alice", sessionId, "respond", { message: "Find the facts" }, "desk");
    await h.settled(20_000);
    return requestId;
  };
  return Object.assign(h, { controls, ended, sendMessage });
}

async function deskSession(h: BoardHost): Promise<string> {
  const created = await h.create("alice", "desk", { state: { workerId: "clerk" } });
  if (created.status >= 300) throw new Error(`creating clerk's session failed: ${JSON.stringify(created.body)}`);
  return created.body.session!.id;
}

/** Every line the session holds under a delegate's name, with the request it landed in. */
async function delegateLines(h: BoardHost, sessionId: string) {
  return (await h.requestsOf(sessionId)).flatMap((request) =>
    (((request as unknown as { items?: any[] }).items ?? []) as any[])
      .filter((item) => item.type === "message" && typeof item.agentName === "string")
      .map((item) => ({ requestId: request.id, actionName: (request as { actionName?: string }).actionName, agentName: item.agentName as string, text: textOf(item) }))
  );
}

function textOf(item: any): string {
  if (typeof item.text === "string") return item.text;
  return ((item.content ?? []) as Array<{ text?: string }>).map((part) => part.text ?? "").join("");
}

describe("a user's turn hears a task that finished while it answered (FIX-2159)", () => {
  it("says the result in that request, once, under the delegate's name, and the worker answers again with it", async () => {
    const nonce = `n${Math.random().toString(36).slice(2, 8)}`;
    const h = host({ source: finishedTasksAnswerAgain() });
    try {
      const session = await deskSession(h);
      h.controls.file = [{ id: "t-1", goal: `Look up ${nonce}` }];
      h.controls.waitInTurn = () => h.ended("t-1");
      const respond = await h.sendMessage(session);

      const lines = (await delegateLines(h, session)).filter((line) => line.text.includes("(t-1)"));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ requestId: respond, agentName: "eng.tasker" });
      expect(lines[0]!.text).toContain(nonce);
      // The same request answered again, told the line.
      const again = h.controls.turns.filter((turn) => turn.kind === "again");
      expect(again).toHaveLength(1);
      expect(again[0]).toMatchObject({ requestId: respond });
      expect(again[0]!.message).toContain(lines[0]!.text);
      // Nothing heard it after the turn.
      expect(h.controls.turns.filter((turn) => turn.kind === "notice")).toEqual([]);
      const row = (await h.rows("alice")).find((r) => r.id === "t-1")!;
      expect(row.metadata?.["noticeOwed:1:completed"] ?? null).toBeNull();
      // Taken in the turn's name: the take record names the user's request.
      expect((row.metadata?.["noticeTaken:1:completed"] as { by?: string } | undefined)?.by).toBe(respond);
    } finally {
      await h.dispose();
    }
  });

  it("before this, with no source: the result is said in a later request, and a turn of its own hears it", async () => {
    const h = host();
    try {
      const session = await deskSession(h);
      h.controls.file = [{ id: "t-1", goal: "Look up the fact" }];
      h.controls.waitInTurn = () => h.ended("t-1");
      const respond = await h.sendMessage(session);
      const lines = (await delegateLines(h, session)).filter((line) => line.text.includes("(t-1)"));
      expect(lines).toHaveLength(1);
      expect(lines[0]!.requestId).not.toBe(respond);
      expect(h.controls.turns.filter((turn) => turn.kind === "again")).toEqual([]);
      expect(h.controls.turns.filter((turn) => turn.kind === "notice")).toHaveLength(1);
    } finally {
      await h.dispose();
    }
  });

  it("a source that only reads the finished row, without the take, leaves it owed: the worker hears it twice", async () => {
    // What a lab could do on public entries before the take: read, not take.
    const readOnly = handler({
      name: "read-only-source",
      inputSchema: z.unknown(),
      outputSchema: z.object({ message: z.string().optional() }),
      execute: async (_input, rawCtx) => {
        const ctx = rawCtx as unknown as BlockContext;
        const ref = await ownConversationLedger(ctx);
        const row = ref === undefined ? undefined : await readCommittedTask(ref, "t-1");
        const said = (ctx.request.state as Record<string, unknown> | undefined)?.readOnlySaid === true;
        if (said || row === undefined || row.status !== "completed") return {};
        await ctx.request.patchState({ readOnlySaid: true } as never);
        return { message: `again: t-1 finished: ${String(row.output)}` };
      }
    });
    const h = host({ source: readOnly });
    try {
      const session = await deskSession(h);
      h.controls.file = [{ id: "t-1", goal: "Look up the fact" }];
      h.controls.waitInTurn = () => h.ended("t-1");
      const respond = await h.sendMessage(session);
      const heard = h.controls.turns.filter((turn) => turn.kind !== "turn" && turn.message.includes("t-1"));
      // In the reply, then again after it: the queued notice still owed it.
      expect(heard.slice(0, 2).map((turn) => [turn.kind, turn.requestId === respond])).toEqual([
        ["again", true],
        ["notice", false]
      ]);
    } finally {
      await h.dispose();
    }
  });

  it("a second ending during the answer again loops once more, each said once in the same request", async () => {
    let release!: () => void;
    const holds = new Map([["second", new Promise<void>((resolve) => (release = resolve))]]);
    const h = host({ source: finishedTasksAnswerAgain(), holds });
    try {
      const session = await deskSession(h);
      h.controls.file = [
        { id: "t-1", goal: "First fact" },
        { id: "t-2", goal: "[hold:second] Second fact" }
      ];
      h.controls.waitInTurn = () => h.ended("t-1");
      h.controls.inAnswerAgain = async (n) => {
        if (n !== 1) return;
        release();
        await h.ended("t-2");
      };
      const respond = await h.sendMessage(session);
      const lines = await delegateLines(h, session);
      for (const id of ["t-1", "t-2"]) {
        const said = lines.filter((line) => line.text.includes(`(${id})`));
        expect(said, id).toHaveLength(1);
        expect(said[0]!.requestId, id).toBe(respond);
      }
      const again = h.controls.turns.filter((turn) => turn.kind === "again");
      expect(again.map((turn) => turn.requestId)).toEqual([respond, respond]);
      expect(again[0]!.message).toContain("(t-1)");
      expect(again[0]!.message).not.toContain("(t-2)");
      expect(again[1]!.message).toContain("(t-2)");
      expect(h.controls.turns.filter((turn) => turn.kind === "notice")).toEqual([]);
    } finally {
      release();
      await h.dispose();
    }
  });
});

describe("only a turn a user's own message started takes a result (D2)", () => {
  it("a turn no user's message started takes nothing: the result is heard after it, as before", async () => {
    const h = host({ source: finishedTasksAnswerAgain(), marksUserTurn: false });
    try {
      const session = await deskSession(h);
      h.controls.file = [{ id: "t-1", goal: "Look up the fact" }];
      h.controls.waitInTurn = () => h.ended("t-1");
      const respond = await h.sendMessage(session);
      const lines = (await delegateLines(h, session)).filter((line) => line.text.includes("(t-1)"));
      expect(lines).toHaveLength(1);
      expect(lines[0]!.requestId).not.toBe(respond);
      expect(h.controls.turns.filter((turn) => turn.kind === "again")).toEqual([]);
      expect(h.controls.turns.filter((turn) => turn.kind === "notice")).toHaveLength(1);
    } finally {
      await h.dispose();
    }
  });
});

describe("the take keeps the queued handling's guarantees (D1)", () => {
  it("a final failure the Error Reporter didn't take stops the take before its acknowledgement: heard once, after the turn", async () => {
    seams.refuseReportInUserTurn = true;
    seams.reports.length = 0;
    const h = host({ source: finishedTasksAnswerAgain() });
    try {
      const session = await deskSession(h);
      h.controls.file = [{ id: "t-1", goal: "[fail] Look up the fact" }];
      h.controls.waitInTurn = () => h.ended("t-1");
      const respond = await h.sendMessage(session);
      const lines = (await delegateLines(h, session)).filter((line) => line.text.includes("(t-1)"));
      expect(lines).toHaveLength(1);
      expect(lines[0]!.text).toContain("failed for good");
      expect(lines[0]!.requestId).not.toBe(respond);
      expect(h.controls.turns.filter((turn) => turn.kind === "again")).toEqual([]);
      // Refused in the turn, then reported once by the copy that took it over after it.
      expect(seams.reports.filter((report) => report.endsWith(":t-1"))).toEqual(["not-taken:t-1", "sent:t-1"]);
    } finally {
      seams.refuseReportInUserTurn = false;
      await h.dispose();
    }
  });

  it("a death between the dedupe write and the acknowledgement drops the line: never heard twice (at most once)", async () => {
    seams.failAckInUserTurn = true;
    const h = host({ source: finishedTasksAnswerAgain() });
    try {
      const session = await deskSession(h);
      h.controls.file = [{ id: "t-1", goal: "Look up the fact" }];
      h.controls.waitInTurn = () => h.ended("t-1");
      await h.sendMessage(session);
      const lines = (await delegateLines(h, session)).filter((line) => line.text.includes("(t-1)"));
      expect(lines).toEqual([]);
      expect(h.controls.turns.filter((turn) => turn.kind !== "turn")).toEqual([]);
      // The copy that took it over after the turn found the key seen, and cleared it.
      const row = (await h.rows("alice")).find((r) => r.id === "t-1")!;
      expect(row.metadata?.["noticeOwed:1:completed"] ?? null).toBeNull();
    } finally {
      seams.failAckInUserTurn = false;
      await h.dispose();
    }
  });
});

describe("one answer-again step, under one cap", () => {
  it(`answers again at most ${MAX_ANSWERS_AGAIN} times in a request, the plan's answer counted, then the request ends`, async () => {
    const handed: unknown[] = [];
    const always = handler({
      name: "always-asks",
      inputSchema: z.unknown(),
      outputSchema: z.object({ message: z.string() }),
      execute: (answer) => {
        handed.push(answer);
        return { message: "again: one more thing" };
      }
    });
    const h = host({ source: always });
    try {
      const session = await deskSession(h);
      // A step the worker files for itself: the plan's source has its answer too.
      h.controls.file = [{ id: "s-1", goal: "Outline it", self: true }];
      const respond = await h.sendMessage(session);
      const again = h.controls.turns.filter((turn) => turn.kind === "again");
      expect(again).toHaveLength(MAX_ANSWERS_AGAIN);
      expect(again.every((turn) => turn.requestId === respond)).toBe(true);
      // The first answer covers both sources: the plan's steps and the app's message.
      expect(again[0]!.message).toContain(PLAN);
      expect(again[0]!.message).toContain("again: one more thing");
      expect(again.slice(1).map((turn) => turn.message)).toEqual(["again: one more thing", "again: one more thing"]);
      // The source is handed the worker's last answer each time, and runs no more once the cap is reached.
      expect(handed).toEqual(["filed", "answered again (1)", "answered again (2)"]);
      const request = (await h.requestsOf(session)).find((r) => r.id === respond)!;
      expect(request.status).toBe("completed");
    } finally {
      await h.dispose();
    }
  });
});

describe("the agent flow's `answerAgain: true`", () => {
  it("files on a real turn, hears the result in the same request, and answers again with it", async () => {
    const nonce = `n${Math.random().toString(36).slice(2, 8)}`;
    let called = false;
    let h!: BoardHost;
    const text = (input: unknown) => JSON.stringify(input).replaceAll("\\", "");
    h = bootBoardHost({
      standard: [...boardWorkers(), worker("ana", { delegates: ["eng.tasker"] }, "You hand work to eng.tasker.")],
      answerAgain: true,
      agentAnswer: mockGenerator({
        script: [
          { when: (input: unknown) => text(input).includes(FINISHED), then: { text: `Here is what came back: ${nonce}` } },
          { when: () => called, then: { text: "Filed it." } },
          {
            when: () => {
              called = true;
              return true;
            },
            then: { toolCalls: [{ toolCallId: "call-file", toolName: "createTask", args: { goal: `Look up ${nonce}`, assignee: "eng.tasker" } }] }
          }
        ]
      }),
      // The reply holds open until the task it filed has ended, so the ending lands mid-turn.
      afterModelCall: async (block) => {
        if (block?.startsWith("agent-answer") !== true) return;
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
          const rows = await h.rows("alice");
          if (rows.every((row) => isTerminalStatus(row.status))) return;
          await sleep(10);
        }
      }
    });
    try {
      const created = await h.create("alice", "agent", { state: { workerId: "ana" } });
      const session = created.body.session!.id;
      const respond = await h.post("alice", session, "respond", { message: "Find the fact" }, "agent");
      await h.settled(20_000);
      const request = (await h.requestsOf(session)).find((r) => r.id === respond)!;
      expect(request.status, messageOf((request as { error?: unknown }).error)).toBe("completed");
      const items = ((request as unknown as { items?: any[] }).items ?? []).filter((item) => item.type === "message");
      const lineAt = items.findIndex((item) => item.agentName === "eng.tasker" && textOf(item).includes(nonce));
      expect(lineAt).toBeGreaterThanOrEqual(0);
      // After the line, in the same request: the worker's answer again, using it.
      expect(items.slice(lineAt + 1).some((item) => textOf(item).includes(`Here is what came back: ${nonce}`))).toBe(true);
      // Once in the session.
      const all = (await delegateLines(h, session)).filter((line) => line.text.includes(nonce) && line.agentName === "eng.tasker");
      expect(all).toHaveLength(1);
    } finally {
      await h.dispose();
    }
  });
});

// The take hands over only what the queued handling would deliver to the turn. A retry runs the
// board again, a waited-on row resumes the request that waits, and a routed result goes to the
// flow's own handling: taken here, each would be said as a line and acknowledged, and its own
// path would never run.
describe("what the take leaves to its own path", () => {
  const notice = { boardId: "b", taskId: "t-1", attempt: 1 } as const;

  it("takes a completion, a final failure, a park that asks, and a cancel", () => {
    for (const ending of ["completed", "errored", "parked", "cancelled"] as const) {
      expect(takesNotice({ ...notice, ending }, undefined), ending).toBe(true);
    }
  });

  it("leaves a retry, a waited-on row's ending, and a routed result", () => {
    expect(takesNotice({ ...notice, ending: "errored" }, "conversation")).toBe(false);
    expect(takesNotice({ ...notice, ending: "retried" }, undefined)).toBe(false);
    // A waited-on row: the request parked on its ending resumes with it.
    const asked = true as const;
    expect(takesNotice({ ...notice, ending: "completed", asked }, undefined)).toBe(false);
  });
});
