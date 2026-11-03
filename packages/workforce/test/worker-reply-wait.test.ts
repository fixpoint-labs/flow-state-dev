/**
 * Waiting for a reply (FIX-2239, one contract with the reply request since
 * FIX-2318): `sendMessage({ to, text, wait: true })` is a message that asks
 * for a reply, whose sender waits for the answer in the same request, until
 * the answer or the deadline, on the engine's one wait gate. The answer is the
 * reply request's one answer (the recipient's turn's final text, or its own
 * `sendMessage({ inReplyTo })`), held for the wait: the tool's result, and no
 * message.
 *
 * Why it matters: a worker that needs an answer before it can answer its user
 * had only a task and `getTask` to get one. A wait must not turn into a send
 * where it can't wait, must never wait past its deadline, must still get the
 * answer after its deadline (as a message, without sending again), and must
 * queue behind a recipient stopped for the user instead of running beside the
 * stop.
 *
 * The caller is the agent worker (Otto), driven step by step so its tool call
 * can park and resume. Everything is read from the store and each session's
 * items, not from the tool's return alone.
 */
import { afterEach, describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { GeneratorModel, GeneratorModelCallOptions } from "@flow-state-dev/core/types";
import { disposeFlowApiRouter, inMemoryStores, type StoreAdapter, type StoreRegistry } from "@flow-state-dev/engine";
import { mockGenerator } from "@flow-state-dev/testing";
import { z } from "zod";
import { boardWorkers, bootBoardHost, ORG, type BoardHost, type BoardHostOptions } from "./conversation-board-harness";
import { workerConfigSchema } from "../src/worker-config";
import { conversationLedgerResources } from "../src/conversation-board/ledger";
import { REPLY_CONCURRENCY } from "../src/conversation-board/task-settled";
import { MESSAGE_RECEIVED_ENTRY } from "../src/messages/keys";
import { WORKER_MESSAGES_PATTERN, workerMessagesResources } from "../src/messages/message-log";
import { messageReceivedEntry, messageReceivedSchema } from "../src/messages/message-received-entry";
import { RECEIVED_MARK } from "../src/messages/received-mark";
import { deriveWorkerSessionId } from "../src/workers/derive-session-id";
import { createWorkerInstallation, type WorkerInstallation } from "../src/workers/installation";
import { sendAndWaitForReply } from "../src/messages/wait-for-reply";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** What each tool call returned since the last user line, in the messages a model call is handed. */
function resultsSinceUser(messages: unknown): string[] {
  const list = (messages ?? []) as Array<Record<string, unknown>>;
  let start = 0;
  list.forEach((m, i) => {
    if (m.role === "user") start = i;
  });
  const out: string[] = [];
  for (const m of list.slice(start)) {
    if (m.role !== "tool" || !Array.isArray(m.content)) continue;
    for (const part of m.content as Array<Record<string, unknown>>) {
      if (part.type === "tool-result") out.push(JSON.stringify(part.output));
    }
  }
  return out;
}

/** The last user line a model call is handed, as text. */
function lastUserLine(messages: unknown): string {
  const list = (messages ?? []) as Array<Record<string, unknown>>;
  const user = [...list].reverse().find((m) => m.role === "user");
  return JSON.stringify(user?.content ?? "");
}

type Step = Awaited<ReturnType<GeneratorModel["generateStep"]>>;

/**
 * Otto's model, step by step: on a user line holding a key of `plans`, its
 * first step makes that plan's tool calls; once they answered, it says what
 * they returned. Every call is kept in `seen`.
 */
function ottoModel(plans: Record<string, () => Array<{ args: Record<string, unknown> }>>) {
  const seen: GeneratorModelCallOptions[] = [];
  const model: GeneratorModel = {
    modelId: "otto-steps",
    async generate() {
      throw new Error("Otto is driven step by step");
    },
    async generateStep(options): Promise<Step> {
      seen.push(options);
      const results = resultsSinceUser(options.messages);
      const line = lastUserLine(options.messages);
      const plan = Object.entries(plans).find(([key]) => line.includes(key))?.[1];
      if (results.length === 0 && plan !== undefined) {
        return {
          toolCalls: plan().map((call, i) => ({ toolCallId: `c${seen.length}-${i}`, toolName: "sendMessage", args: call.args })),
          finishReason: "tool-calls"
        } as Step;
      }
      return { text: `Otto says: ${results.join(" | ")}`, finishReason: "stop" } as Step;
    }
  };
  return { model, seen };
}

/** The lead's judgment: a reply request's turn answers with the codename; anything else is quiet. */
function leadAnswers(reply = "The codename is Bluebird.") {
  return mockGenerator({
    script: [
      { when: (input) => JSON.stringify(input).includes("they asked for a reply"), then: { text: reply } },
      { when: () => true, then: { text: "" } }
    ]
  });
}

/** A worker whose turn on a `[stop]` line waits for the user, and whose turn for a message answers it. */
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
  const answer = handler({
    name: "stopper-answer",
    inputSchema: messageReceivedSchema,
    execute: async (message) => `The codename is Bluebird (you asked: ${message.text})`
  });
  return defineFlow({
    kind: "stopper",
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { ...installation.resources, ...workerMessagesResources, ...conversationLedgerResources },
    actions: { respond: { inputSchema: z.object({ message: z.string() }), block: door, userMessage: (i: { message: string }) => i.message, concurrency: REPLY_CONCURRENCY } },
    internal: { actions: { [MESSAGE_RECEIVED_ENTRY]: messageReceivedEntry({ installation, flowKind: "stopper", turn: answer }) } }
  } as never);
}

/**
 * A worker whose `onMessageReceived` runs no turn: a message lands as its items
 * and nothing answers it. `unmarked` builds it as a copy of this package from
 * before the entry said so, which the sender can't read up front.
 */
function quietFlow(installation: WorkerInstallation, unmarked = false) {
  const entry = messageReceivedEntry({ installation, flowKind: "quiet" }) as Record<symbol, unknown>;
  if (unmarked) {
    const { runsTurn: _runsTurn, ...mark } = entry[RECEIVED_MARK] as Record<string, unknown>;
    entry[RECEIVED_MARK] = mark;
  }
  const door = handler({ name: "quiet-run", inputSchema: z.object({ message: z.string() }), execute: async (input) => `heard: ${input.message}` });
  return defineFlow({
    kind: "quiet",
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { ...installation.resources, ...workerMessagesResources, ...conversationLedgerResources },
    actions: { respond: { inputSchema: z.object({ message: z.string() }), block: door, userMessage: (i: { message: string }) => i.message, concurrency: REPLY_CONCURRENCY } },
    internal: { actions: { [MESSAGE_RECEIVED_ENTRY]: entry } }
  } as never);
}

let open: BoardHost | undefined;
afterEach(async () => {
  await open?.dispose();
  open = undefined;
});

async function boot(otto: GeneratorModel, options: BoardHostOptions = {}) {
  const h = bootBoardHost({
    durable: true,
    agentModel: otto,
    judgment: leadAnswers(),
    standard: [...boardWorkers(), { id: "stopper", declared: { flow: "stopper", description: "Stops for its user." }, body: "", skills: [] }],
    flows: (installation) => ({ stopper: { flow: stopperFlow(installation), roles: [] } }),
    ...options
  });
  open = h;
  await h.state.getRouter();
  const created = await h.create("alice", "agent", { state: { workerId: "otto" } });
  return { h, otto: created.body.session!.id as string };
}

async function logRows(h: BoardHost) {
  const runtime = await h.state.getRuntime();
  const entries = await runtime.stores.resourceState.getByPrefix("user", `alice:~org:${ORG}`, WORKER_MESSAGES_PATTERN.replace("*", ""));
  return Object.values(entries).map((value) => value.state as Record<string, any>);
}

async function toolOutputs(h: BoardHost, sessionId: string): Promise<Array<Record<string, any>>> {
  return (await h.requestsOf(sessionId))
    .flatMap((request) => (request as unknown as { items?: any[] }).items ?? [])
    // A parked call writes a tool output with nothing in it; its replay writes the answer.
    .filter((item) => item.type === "tool_output" && typeof item.output === "object" && item.output !== null)
    .map((item) => item.output as Record<string, any>);
}

/** Poll `check` until it holds, for at most `ms`. Whether it held. */
async function until(check: () => Promise<boolean> | boolean, ms = 15_000): Promise<boolean> {
  for (const deadline = Date.now() + ms; Date.now() < deadline; ) {
    if (await check()) return true;
    await sleep(50);
  }
  return check();
}

/** Otto's `respond` requests, oldest first. */
async function ottoTurns(h: BoardHost, otto: string) {
  return (await h.requestsOf(otto)).filter((request) => (request as { actionName?: string }).actionName === "respond") as Array<Record<string, any>>;
}

/** The stopper's own conversation, with one `[stop]` turn parked on its user. Its parked request's id. */
async function stoppedConversation(h: BoardHost) {
  const sessionId = await deriveWorkerSessionId({ userId: "alice", orgId: ORG, flow: "stopper", criteria: { worker: "stopper" } });
  await h.create("alice", "stopper", { sessionId, state: { workerId: "stopper" } });
  const stopped = await h.post("alice", sessionId, "respond", { message: "Deploy it [stop]" }, "stopper");
  expect(await until(async () => (await (await h.state.getRuntime()).stores.request.get(stopped))?.status === "suspended")).toBe(true);
  return { sessionId, stopped };
}

/** Answer the stop `requestId` is parked on, as the user would. */
async function answerStop(h: BoardHost, requestId: string) {
  const runtime = await h.state.getRuntime();
  const pending = await (runtime.runtimeConfig.requestHost as any).parkedStop.provider.listSuspended({ status: "pending" });
  const gate = pending.find((g: { requestId: string }) => g.requestId === requestId);
  const request = new Request(`http://localhost/api/flows/stopper/requests/${requestId}/resume`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-user": "alice" },
    body: JSON.stringify({ suspensionId: gate.suspensionId, action: "submit", data: "yes" })
  });
  const res = await ((await h.state.getRouter()) as any).POST(request, { params: { path: ["stopper", "requests", requestId, "resume"] } });
  if (res.status >= 300) throw new Error(`resume refused ${res.status}: ${await res.text()}`);
}

/** Every request `onMessageReceived` ran in `sessionId` that landed a message (it has a reply). */
async function landedIn(h: BoardHost, sessionId: string) {
  return (await h.requestsOf(sessionId)).filter(
    (r: any) => r.actionName === MESSAGE_RECEIVED_ENTRY && r.status === "completed" && typeof r.result?.output?.reply === "string"
  ) as any[];
}

/** The ids of the messages `sessionId` heard, as their received items say. */
async function heardIn(h: BoardHost, sessionId: string): Promise<string[]> {
  return (await h.requestsOf(sessionId))
    .flatMap((request) => (request as unknown as { items?: any[] }).items ?? [])
    .filter((item) => item.type === "component" && item.component === "workforce:received")
    .map((item) => item.data?.id as string);
}

/** The asks in the log (the messages that answer nothing), and the answers to `id`. */
async function asksAndAnswers(h: BoardHost, id?: string) {
  const rows = await logRows(h);
  return { asks: rows.filter((row) => row.inReplyTo === undefined), answers: rows.filter((row) => id !== undefined && row.inReplyTo === id) };
}

describe("a send that waits for its reply", { timeout: 40_000 }, () => {
  it("gets the recipient's answer as its tool's result, in the same request, and no message lands in its conversation", async () => {
    const { model } = ottoModel({ "Ask the lead": () => [{ args: { to: "lead", text: "What is the codename?", wait: true } }] });
    const { h, otto } = await boot(model);
    await h.post("alice", otto, "respond", { message: "Ask the lead for the codename" }, "agent");
    expect(await until(async () => (await ottoTurns(h, otto))[0]?.status === "completed")).toBe(true);
    await h.settled();

    const [output] = await toolOutputs(h, otto);
    expect(output).toEqual({ status: "answered", sent: expect.stringMatching(/^msg_/), reply: "The codename is Bluebird." });
    // One request: the answer to Alice holds the reply.
    const turns = await ottoTurns(h, otto);
    expect(turns).toHaveLength(1);
    expect(JSON.stringify(turns[0]!.result?.output)).toContain("Bluebird");
    // The message is a reply request with a deadline, answered in time by the one answer row, held for the wait.
    const { asks, answers } = await asksAndAnswers(h, output!.sent);
    expect(asks).toHaveLength(1);
    expect(asks[0]).toMatchObject({ id: output!.sent, replyRequested: true, status: "delivered", answeredBy: answers[0]?.id });
    expect(asks[0]!.waitEndedAt).toBeUndefined();
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({ from: "lead", to: "otto", text: "The codename is Bluebird.", status: "delivered" });
    expect(answers[0]!.at).toBeLessThanOrEqual(asks[0]!.deadlineAt);
    expect(await heardIn(h, otto)).toEqual([]);
    expect((await h.messages(otto)).some((m) => m.text.includes("From lead"))).toBe(false);
  });

  it("is refused before anything is written where the host can't hold a wait, and a send still lands there", async () => {
    let first = true;
    const { model } = ottoModel({
      "Ask the lead": () => {
        const args = first ? { to: "lead", text: "What is the codename?", wait: true } : { to: "lead", text: "What is the codename?" };
        first = false;
        return [{ args }];
      }
    });
    // Not durable: no wait can be held.
    const { h, otto } = await boot(model, { durable: false });
    await h.post("alice", otto, "respond", { message: "Ask the lead for the codename" }, "agent");
    await h.settled();
    const [refused] = await toolOutputs(h, otto);
    expect(refused).toMatchObject({ ok: false, error: expect.stringMatching(/^wait_unavailable/) });
    expect(await logRows(h)).toEqual([]);
    // Never turned into a send: a send is the model's own next call.
    await h.post("alice", otto, "respond", { message: "Ask the lead again" }, "agent");
    await h.settled();
    expect((await toolOutputs(h, otto))[1]).toMatchObject({ sent: expect.stringMatching(/^msg_/) });
    expect(await logRows(h)).toHaveLength(1);
  });

  it("takes one wait per model step: a second wait in the same step is refused before its row", async () => {
    const { model } = ottoModel({
      "Ask twice": () => [
        { args: { to: "lead", text: "What is the codename?", wait: true } },
        { args: { to: "pm", text: "What is the plan?", wait: true } }
      ]
    });
    const { h, otto } = await boot(model);
    await h.post("alice", otto, "respond", { message: "Ask twice" }, "agent");
    expect(await until(async () => (await ottoTurns(h, otto))[0]?.status === "completed")).toBe(true);
    await h.settled();
    const outputs = await toolOutputs(h, otto);
    expect(outputs.filter((o) => o.status === "answered")).toHaveLength(1);
    expect(outputs.filter((o) => typeof o.error === "string" && o.error.startsWith("wait_already_pending"))).toHaveLength(1);
    expect((await asksAndAnswers(h)).asks).toHaveLength(1);
  });

  it("refuses a deadline outside the host's bounds, writing nothing", async () => {
    const { model } = ottoModel({
      "Too long": () => [{ args: { to: "lead", text: "What is the codename?", wait: true, deadline: 999_999_999 } }]
    });
    const { h, otto } = await boot(model);
    await h.post("alice", otto, "respond", { message: "Too long" }, "agent");
    await h.settled();
    const outputs = await toolOutputs(h, otto);
    expect(outputs[0]).toMatchObject({ ok: false, error: expect.stringMatching(/^wait_deadline_out_of_range/) });
    expect(await logRows(h)).toEqual([]);
  });
});

describe("a wait on a worker that runs nothing on a message", { timeout: 40_000 }, () => {
  const quiet = (unmarked = false): BoardHostOptions => ({
    standard: [...boardWorkers(), { id: "quiet", declared: { flow: "quiet", description: "Takes messages, answers none." }, body: "", skills: [] }],
    flows: (installation) => ({ quiet: { flow: quietFlow(installation, unmarked), roles: [] } })
  });

  // Silence passed off as an answer reads as "it said nothing": the wait must say no reply will ever come.
  it("is refused no_reply before anything is written, and a plain send to it still lands", async () => {
    let first = true;
    const { model } = ottoModel({
      "Ask the quiet one": () => {
        const args = first ? { to: "quiet", text: "What is the codename?", wait: true } : { to: "quiet", text: "FYI: the codename is Bluebird." };
        first = false;
        return [{ args }];
      }
    });
    const { h, otto } = await boot(model, quiet());
    await h.post("alice", otto, "respond", { message: "Ask the quiet one" }, "agent");
    await h.settled();
    const [refused] = await toolOutputs(h, otto);
    expect(refused).toMatchObject({ ok: false, error: expect.stringMatching(/^no_reply: "quiet" takes messages but runs nothing on them/) });
    expect(await logRows(h)).toEqual([]);

    await h.post("alice", otto, "respond", { message: "Ask the quiet one again" }, "agent");
    await h.settled();
    expect((await toolOutputs(h, otto))[1]).toMatchObject({ sent: expect.stringMatching(/^msg_/) });
    expect(await until(async () => (await logRows(h))[0]?.status === "delivered")).toBe(true);
  });

  it("is answered 'no answer' once it lands, where the sender couldn't tell up front", async () => {
    const { model } = ottoModel({ "Ask the quiet one": () => [{ args: { to: "quiet", text: "What is the codename?", wait: true } }] });
    const { h, otto } = await boot(model, quiet(true));
    await h.post("alice", otto, "respond", { message: "Ask the quiet one" }, "agent");
    expect(await until(async () => (await ottoTurns(h, otto))[0]?.status === "completed")).toBe(true);
    await h.settled();
    const [output] = await toolOutputs(h, otto);
    // The reply request's own guarantee: one answer, the framework's "no answer", never silence.
    expect(output).toEqual({
      status: "answered",
      sent: expect.stringMatching(/^msg_/),
      reply: "No answer came back: this worker doesn't answer messages.",
      noAnswer: true
    });
    const { asks, answers } = await asksAndAnswers(h, output!.sent);
    expect(asks[0]).toMatchObject({ id: output!.sent, replyRequested: true, status: "delivered" });
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({ from: "quiet", noAnswer: true });
    expect(await heardIn(h, otto)).toEqual([]);
  });
});

describe("a wait into a session stopped for the user", { timeout: 60_000 }, () => {
  it("queues behind the stop, answers running at its deadline saying so, and the answer comes later as a message, sent once", async () => {
    const { model } = ottoModel({
      "Ask the stopper": () => [
        { args: { to: "stopper", text: "What is the codename?", wait: true, deadline: 1_000 } },
        { args: { to: "stopper", text: "FYI: the deploy waits on you." } }
      ]
    });
    const { h, otto } = await boot(model);
    const { sessionId, stopped } = await stoppedConversation(h);

    const asked = Date.now();
    await h.post("alice", otto, "respond", { message: "Ask the stopper for the codename" }, "agent");
    expect(await until(async () => (await ottoTurns(h, otto))[0]?.status === "completed")).toBe(true);
    const outputs = await toolOutputs(h, otto);
    const waited = outputs.find((o) => o.status !== undefined)!;
    // The deadline came first: the sender goes on, told the recipient waits on the user.
    expect(waited).toEqual({ status: "running", sent: expect.stringMatching(/^msg_/), recipient: "waiting_on_person" });
    expect(Date.now() - asked).toBeGreaterThanOrEqual(1_000);
    // Nothing landed while the stop is open: neither the waited message nor the plain one.
    expect(await landedIn(h, sessionId)).toEqual([]);
    const rows = await logRows(h);
    expect(rows.every((row) => row.queuedBehind === "user" && row.status === "unconfirmed")).toBe(true);
    // The wait ended on the message's row, so its answer won't be held for it.
    expect(rows.find((row) => row.id === waited.sent)!.waitEndedAt).toEqual(expect.any(Number));
    // The stopped request still waits on its user: the queued messages never touched it.
    expect((await (await h.state.getRuntime()).stores.request.get(stopped))?.status).toBe("suspended");

    // The user answers; the stopped request ends, and only then do the messages land.
    await answerStop(h, stopped);
    expect(await until(async () => (await landedIn(h, sessionId)).length === 2)).toBe(true);
    // Landed after the stopped request ended, not when it merely resumed: the session was busy until then.
    const stoppedEnd = (await (await h.state.getRuntime()).stores.request.get(stopped)) as any;
    expect(stoppedEnd.status).toBe("completed");
    const delivered = (await asksAndAnswers(h)).asks;
    expect(delivered.every((row) => row.status === "delivered" && row.queuedBehind === undefined)).toBe(true);
    for (const row of delivered) expect(row.deliveredAt).toBeGreaterThanOrEqual(stoppedEnd.completedAtMs);

    // The answer reaches Otto as a message, like any reply, and nothing was sent again: one ask, one answer.
    expect(await until(async () => (await asksAndAnswers(h, waited.sent)).answers.length === 1)).toBe(true);
    const { answers } = await asksAndAnswers(h, waited.sent);
    expect(answers[0]).toMatchObject({ from: "stopper", toSession: otto, text: "The codename is Bluebird (you asked: What is the codename?)" });
    expect(await until(async () => (await heardIn(h, otto)).includes(answers[0]!.id))).toBe(true);
    expect((await asksAndAnswers(h)).asks).toHaveLength(2);
  });
});

describe("a wait into a busy recipient", { timeout: 60_000 }, () => {
  it("queues behind the turn it is running, answers running at its deadline and stops nothing; the answer comes later as a message", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let holding = true;
    const { model } = ottoModel({
      "Ask the lead": () => [{ args: { to: "lead", text: "What is the codename?", wait: true, deadline: 1_000 } }]
    });
    const { h, otto } = await boot(model, {
      // The lead's own turn on Alice's line holds until the test lets it go.
      afterModelCall: async (block) => {
        if (block === "coordinator-judgment" && holding) {
          holding = false;
          await held;
        }
      }
    });
    const lead = await deriveWorkerSessionId({ userId: "alice", orgId: ORG, flow: "coordinator", criteria: { worker: "lead" } });
    await h.create("alice", "coordinator", { sessionId: lead, state: { workerId: "lead" } });
    const busy = await h.post("alice", lead, "respond", { message: "Plan the week" });
    expect(await until(() => !holding)).toBe(true);

    await h.post("alice", otto, "respond", { message: "Ask the lead for the codename" }, "agent");
    expect(await until(async () => (await ottoTurns(h, otto))[0]?.status === "completed")).toBe(true);
    const waited = (await toolOutputs(h, otto)).find((o) => o.status !== undefined)!;
    // Busy, not waiting on the user: running, and nothing more said.
    expect(waited).toEqual({ status: "running", sent: expect.stringMatching(/^msg_/) });
    expect(await landedIn(h, lead)).toEqual([]);
    // The deadline stopped nothing: the lead's turn runs on, then the waited message's turn after it.
    release();
    expect(await until(async () => (await landedIn(h, lead)).length === 1)).toBe(true);
    expect((await (await h.state.getRuntime()).stores.request.get(busy))?.status).toBe("completed");

    // Answered after the wait ended: the same answer, as a message that wakes Otto.
    expect(await until(async () => (await asksAndAnswers(h, waited.sent)).answers.length === 1)).toBe(true);
    const { asks, answers } = await asksAndAnswers(h, waited.sent);
    expect(asks).toHaveLength(1);
    expect(answers[0]).toMatchObject({ from: "lead", toSession: otto, text: "The codename is Bluebird." });
    expect(answers[0]!.at).toBeGreaterThan(asks[0]!.waitEndedAt);
    expect(await until(async () => (await heardIn(h, otto)).includes(answers[0]!.id))).toBe(true);
  });
});

describe("a wait's depth", () => {
  it("is refused wait_too_deep at the sixth wait, before anything is sent", async () => {
    const memo = new Map<string, unknown>();
    const written: unknown[] = [];
    const ctx = {
      _blockIdentity: { blockName: "sendMessage", blockInstanceId: "req_1:root/agent-answer/tool[sendMessage][0%3Ac1]:0" },
      requestHost: {
        resumeWait: async () => ({ ok: true }),
        hasWaitSweeper: true,
        waits: { deadlines: { defaultMs: 300_000, minMs: 1_000, maxMs: 86_400_000 }, depth: async () => 6 }
      },
      runOnce: async <T>(key: string, fn: () => Promise<T>) => {
        if (!memo.has(key)) memo.set(key, await fn());
        return memo.get(key) as T;
      },
      suspend: async () => {
        throw new Error("parked");
      },
      session: { identity: { id: "s_otto" }, state: { workerId: "otto" }, atomicState: async (m: unknown) => written.push(m) },
      request: { identity: { id: "req_1" }, state: {}, atomicState: async (m: unknown) => written.push(m) }
    };
    const installation = createWorkerInstallation({ standardWorkers: boardWorkers(), workerFlows: () => ({}) as never });
    const outcome = await sendAndWaitForReply(ctx as never, installation, "agent", { to: "lead", text: "Hi?", wait: true } as never, "sendMessage");
    expect(outcome).toMatchObject({ ok: false, error: expect.stringMatching(/^wait_too_deep: waits nest at most 5 deep, and this one would make 6/) });
    expect(written).toEqual([]);
    // A wait refused for its depth doesn't hold the step: another wait in it may still go.
    expect([...memo.keys()].filter((key) => key.startsWith("fsd.wait.step:"))).toEqual([]);
    // Five deep is allowed: the refusal is the sixth's.
    ctx.requestHost.waits.depth = async () => 5;
    memo.clear();
    const allowed = await sendAndWaitForReply(ctx as never, installation, "agent", { to: "lead", text: "Hi?" } as never, "sendMessage").catch((error: unknown) => ({
      threw: String(error)
    }));
    expect(JSON.stringify(allowed)).not.toContain("wait_too_deep");
  });
});

/**
 * `stores` as one host sees them, until `dies(method, args)` holds for a call:
 * that call lands, and from then on every call on every store never settles,
 * as a process killed right after that write would leave it. Another host on
 * `stores` itself sees exactly what landed.
 */
function killableStores(stores: StoreAdapter, dies: (method: string, args: unknown[]) => boolean) {
  let dead = false;
  const never = new Promise<never>(() => {});
  const wrap = <T extends object>(store: T): T =>
    new Proxy(store, {
      get(target, prop) {
        const value = Reflect.get(target, prop, target);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          if (dead) return never;
          const result = value.apply(target, args);
          if (!dies(String(prop), args)) return result;
          dead = true;
          return Promise.resolve(result).then(() => never);
        };
      }
    });
  let registry: Promise<StoreRegistry> | undefined;
  const resolve = () =>
    (registry ??= stores.resolve().then(
      (inner) =>
        Object.fromEntries(
          Object.entries(inner).map(([name, store]) => [name, store === undefined ? store : wrap(store as object)])
        ) as StoreRegistry
    ));
  return { stores: { ...stores, resolve } as StoreAdapter, dead: () => dead };
}

/** The waiting request's write as it pays the send's budget, before its row. */
const paysBudget = (method: string, args: unknown[]) =>
  (method.startsWith("set") || method.startsWith("patch")) && JSON.stringify(args).includes('"workforceMessagesPaid":["msg_');

/** The waited ask's row landing (the one row with a deadline), before its dispatch. */
const writesWaitedRow = (method: string, args: unknown[]) => {
  if (!method.startsWith("set")) return false;
  const written = JSON.stringify(args);
  return written.includes("workforce/messages/") && written.includes('"deadlineAt":');
};

/**
 * Otto waits on the lead on a host whose process dies at `dies`; a second host
 * on the same stores takes over. The request that asked, and the next host.
 */
async function waitThenDie(dies: (method: string, args: unknown[]) => boolean, options: BoardHostOptions = {}) {
  const { model } = ottoModel({ "Ask the lead": () => [{ args: { to: "lead", text: "What is the codename?", wait: true } }] });
  const shared = inMemoryStores();
  const killed = killableStores(shared, dies);
  const staleSweep = { intervalMs: 100, thresholdMs: 500 };
  const common = { durable: true, agentModel: model, standard: boardWorkers(), staleSweep, ...options } satisfies BoardHostOptions;
  const first = bootBoardHost({ ...common, judgment: leadAnswers(), stores: killed.stores as never });
  await first.state.getRouter();
  const otto = (await first.create("alice", "agent", { state: { workerId: "otto" } })).body.session!.id as string;
  const asked = await first.post("alice", otto, "respond", { message: "Ask the lead for the codename" }, "agent");
  expect(await until(() => killed.dead())).toBe(true);
  // The dead host is never disposed: its every store call hangs, as a dead process's would.

  const next = bootBoardHost({ ...common, judgment: leadAnswers(), stores: shared as never });
  // The dead host's request still owes its request-end hooks, and that debt is
  // kept per process, which both hosts share here: the next host's shutdown
  // would wait its whole drain budget for a run that never ends.
  open = {
    ...next,
    dispose: async () => {
      await disposeFlowApiRouter(await next.state.getRouter(), { drainMs: 100 });
      await next.dispose();
    }
  };
  await next.state.getRouter();
  expect(await until(async () => (await (await shared.resolve()).request.get(asked))?.status === "completed", 30_000)).toBe(true);
  await next.settled(20_000);
  return { next, otto, asked };
}

describe("a wait whose process dies before it parks", { timeout: 60_000 }, () => {
  // The dead host's request still owes its request-end hooks, and that debt is
  // kept per process, which both hosts share here: the next host's shutdown
  // would wait its whole drain budget for a run that never ends. Runs before
  // the file's hook disposes `open`.
  afterEach(async () => {
    if (open !== undefined) await disposeFlowApiRouter(await open.state.getRouter(), { drainMs: 100 });
  });

  // The bug (FIX-2269): the caller's request was left `interrupted` behind no
  // gate, so nothing continued it and the wait never answered its user, though
  // the recipient could still have answered it.
  it("is continued by the next host after its row: the same wait is answered in the same request, and its row is written once", async () => {
    const { next, otto, asked } = await waitThenDie(writesWaitedRow);

    // The request that asked is the one that answered: continued, not run again.
    const turns = await ottoTurns(next, otto);
    expect(turns.map((t) => t.id)).toEqual([asked]);
    const outputs = await toolOutputs(next, otto);
    expect(outputs).toEqual([{ status: "answered", sent: expect.stringMatching(/^msg_/), reply: "The codename is Bluebird." }]);
    expect(JSON.stringify(turns[0]!.result?.output)).toContain("Bluebird");
    // One ask, the row the first host wrote, delivered once and answered once.
    const { asks, answers } = await asksAndAnswers(next, outputs[0]!.sent);
    expect(asks).toHaveLength(1);
    expect(asks[0]).toMatchObject({ id: outputs[0]!.sent, replyRequested: true, status: "delivered", answeredBy: answers[0]?.id });
    expect(answers).toHaveLength(1);
    expect(await landedIn(next, asks[0]!.toSession)).toHaveLength(1);
  });

  it("pays its budget once when it died after paying and before its row: one message a turn still sends it", async () => {
    const { next, otto } = await waitThenDie(paysBudget, { hire: { messages: { perTurn: 1 } } });

    const outputs = await toolOutputs(next, otto);
    expect(outputs).toEqual([{ status: "answered", sent: expect.stringMatching(/^msg_/), reply: "The codename is Bluebird." }]);
    expect((await asksAndAnswers(next)).asks).toHaveLength(1);
  });
});
