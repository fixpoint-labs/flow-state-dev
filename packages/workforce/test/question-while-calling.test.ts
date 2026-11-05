/**
 * A task's midway question heard while its filer's call waits (FIX-2279).
 *
 * A worker files a task and, in the same request, calls another worker with
 * `sendMessage({ wait: true })`. The call parks that request on the wait gate
 * and gives the session back, so the task's midway question runs there on
 * `onMessageReceived` while the call still waits (FIX-2241).
 *
 * Why it matters: the filer can only steer its task from what it was told,
 * and the one place it was told the task's fact is the user's line that filed
 * the task, in the request the call parked. A turn that hears the question
 * without that line can only route the question or guess, and the task
 * completes on a made-up answer.
 *
 * Otto files and calls; the recipient is stopped for its user, so the call
 * stays parked for the whole test. Everything Otto's model is handed is read
 * off its step model.
 */
import { afterEach, describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { GeneratorModel, GeneratorModelCallOptions } from "@flow-state-dev/core/types";
import { z } from "zod";
import { boardWorkers, bootBoardHost, ORG, type BoardHost } from "./conversation-board-harness";
import { workerConfigSchema } from "../src/worker-config";
import { conversationLedgerResources } from "../src/conversation-board/ledger";
import { REPLY_CONCURRENCY } from "../src/conversation-board/task-settled";
import { MESSAGE_RECEIVED_ENTRY } from "../src/messages/keys";
import { workerMessagesResources } from "../src/messages/message-log";
import { messageReceivedEntry, messageReceivedSchema } from "../src/messages/message-received-entry";
import { deriveWorkerSessionId } from "../src/workers/derive-session-id";
import type { WorkerInstallation } from "../src/workers/installation";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The fact only Alice's filing line holds. */
const VENUE = "Harbor Hall";
/** The task's midway question. */
const QUESTION = "Which venue is it?";

type Step = Awaited<ReturnType<GeneratorModel["generateStep"]>>;

/** The text of every user message a model call is handed. */
function userLines(options: GeneratorModelCallOptions): string[] {
  return ((options.messages ?? []) as Array<Record<string, unknown>>)
    .filter((m) => m.role === "user")
    .map((m) => JSON.stringify(m.content));
}

/**
 * Otto's model: on Alice's line it files the task and calls the stopper in one
 * step; any other call (the question's turn, a resumed step) just says it heard.
 */
function ottoModel() {
  const seen: GeneratorModelCallOptions[] = [];
  const model: GeneratorModel = {
    modelId: "otto-steps",
    async generate() {
      throw new Error("Otto is driven step by step");
    },
    async generateStep(options): Promise<Step> {
      seen.push(options);
      const lines = userLines(options);
      const last = lines[lines.length - 1] ?? "";
      const answered = (options.messages ?? []).some((m) => (m as { role?: string }).role === "tool");
      if (last.includes(VENUE) && !answered) {
        return {
          toolCalls: [
            { toolCallId: "file-1", toolName: "createTask", args: { goal: `Book the caterer [ask:${QUESTION}]`, assignee: "eng.tasker" } },
            { toolCallId: "call-1", toolName: "sendMessage", args: { to: "stopper", text: "What is the budget?", wait: true, deadline: 60_000 } }
          ],
          finishReason: "tool-calls"
        } as Step;
      }
      return { text: "Heard.", finishReason: "stop" } as Step;
    }
  };
  return { model, seen };
}

/** A worker whose turn on a `[stop]` line waits for its user, so a call to it stays parked. */
function stopperFlow(installation: WorkerInstallation) {
  const door = handler({
    name: "stopper-run",
    inputSchema: z.object({ message: z.string() }),
    execute: async (input, ctx) => {
      if (!input.message.includes("[stop]")) return `heard: ${input.message}`;
      const answer = await (ctx as unknown as { suspendForUser(options: unknown): Promise<unknown> }).suspendForUser({ kind: "input", prompt: "Go ahead?" });
      return `went ahead: ${JSON.stringify(answer)}`;
    }
  });
  const answer = handler({ name: "stopper-answer", inputSchema: messageReceivedSchema, execute: async () => "The budget is 4000." });
  return defineFlow({
    kind: "stopper",
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { ...installation.resources, ...workerMessagesResources, ...conversationLedgerResources },
    actions: { respond: { inputSchema: z.object({ message: z.string() }), block: door, userMessage: (i: { message: string }) => i.message, concurrency: REPLY_CONCURRENCY } },
    internal: { actions: { [MESSAGE_RECEIVED_ENTRY]: messageReceivedEntry({ installation, flowKind: "stopper", turn: answer }) } }
  } as never);
}

/** Poll `check` until it holds, for at most `ms`. Whether it held. */
async function until(check: () => Promise<boolean> | boolean, ms = 15_000): Promise<boolean> {
  for (const deadline = Date.now() + ms; Date.now() < deadline; ) {
    if (await check()) return true;
    await sleep(50);
  }
  return check();
}

let open: BoardHost | undefined;
afterEach(async () => {
  await open?.dispose();
  open = undefined;
});

describe("a task's midway question heard while its filer's call waits", { timeout: 40_000 }, () => {
  it("is heard with the line that filed the task, though that line's request is still parked on the call", async () => {
    const { model, seen } = ottoModel();
    const h = bootBoardHost({
      durable: true,
      agentModel: model,
      standard: [
        ...boardWorkers({ otto: { delegates: ["eng.tasker"] } }),
        { id: "stopper", declared: { flow: "stopper", description: "Stops for its user." }, body: "", skills: [] }
      ],
      flows: (installation) => ({ stopper: { flow: stopperFlow(installation), roles: [] } })
    });
    open = h;
    await h.state.getRouter();
    const runtime = await h.state.getRuntime();

    // The stopper's own turn waits on its user, so Otto's call to it parks and stays parked.
    const stopperSession = await deriveWorkerSessionId({ userId: "alice", orgId: ORG, flow: "stopper", criteria: { worker: "stopper" } });
    await h.create("alice", "stopper", { sessionId: stopperSession, state: { workerId: "stopper" } });
    const stopped = await h.post("alice", stopperSession, "respond", { message: "Deploy it [stop]" }, "stopper");
    expect(await until(async () => (await runtime.stores.request.get(stopped))?.status === "suspended")).toBe(true);

    const otto = (await h.create("alice", "agent", { state: { workerId: "otto" } })).body.session!.id as string;
    const filed = await h.post("alice", otto, "respond", { message: `The gala is at ${VENUE}. File the catering task, then ask the stopper for the budget.` }, "agent");

    // The question's turn: the model call handed the task's question.
    const heard = () => seen.find((call) => userLines(call).some((line) => line.includes(QUESTION)));
    expect(await until(() => heard() !== undefined)).toBe(true);

    // Setup, not the grade: the filing request is still parked on its call while the question is heard.
    expect((await runtime.stores.request.get(filed))?.status).toBe("suspended");

    // The grade: the turn that hears the question is handed the line that filed the task.
    const handed = JSON.stringify(heard()!.messages);
    expect(handed).toContain(VENUE);
    // And it is told the call still waits, not that it failed: a turn that
    // read the call as failed would send it again.
    expect(handed).toContain("still waiting on sendMessage");
    expect(handed).not.toContain('Tool \\"sendMessage\\" failed');
  });
});

/**
 * The other side of the line: a request stopped for its user stays out of a
 * turn that runs meanwhile. The user's answer resumes it at the same step,
 * reading the session as it left it, so nothing it has said yet is final, and
 * only a call's park (a wait on another request) is read as far as it got.
 */
describe("a request stopped for its user, heard by a turn that runs meanwhile", { timeout: 40_000 }, () => {
  it("stays out of that turn's history", async () => {
    const SECRET = "Lighthouse Pier";
    const LATER = "What else is on today?";
    const seen: GeneratorModelCallOptions[] = [];
    const model: GeneratorModel = {
      modelId: "otto-stops",
      async generate() {
        throw new Error("Otto is driven step by step");
      },
      async generateStep(options): Promise<Step> {
        seen.push(options);
        const last = userLines(options).at(-1) ?? "";
        const answered = (options.messages ?? []).some((m) => (m as { role?: string }).role === "tool");
        if (last.includes(SECRET) && !answered) {
          return {
            toolCalls: [{ toolCallId: "stop-1", toolName: "suspendForUser", args: { kind: "approval", prompt: "Book it?" } }],
            finishReason: "tool-calls"
          } as Step;
        }
        return { text: "Heard.", finishReason: "stop" } as Step;
      }
    };
    const h = bootBoardHost({ durable: true, agentModel: model, standard: boardWorkers({ otto: { delegates: ["eng.tasker"] } }) });
    open = h;
    await h.state.getRouter();
    const runtime = await h.state.getRuntime();

    const otto = (await h.create("alice", "agent", { state: { workerId: "otto" } })).body.session!.id as string;
    const stopped = await h.post("alice", otto, "respond", { message: `Book the dinner at ${SECRET}, once I say yes.` }, "agent");
    expect(await until(async () => (await runtime.stores.request.get(stopped))?.status === "suspended")).toBe(true);

    await h.post("alice", otto, "respond", { message: LATER }, "agent");
    const later = () => seen.find((call) => (userLines(call).at(-1) ?? "").includes(LATER));
    expect(await until(() => later() !== undefined)).toBe(true);

    // Setup, not the grade: the stopped request still waits on Alice.
    expect((await runtime.stores.request.get(stopped))?.status).toBe("suspended");
    // The grade: the turn that ran meanwhile reads none of it.
    expect(JSON.stringify(later()!.messages)).not.toContain(SECRET);
  });
});
