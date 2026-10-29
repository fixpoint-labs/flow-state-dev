/**
 * A message that asks for a reply (FIX-2310): `sendMessage({ to, text,
 * replyRequested: true })` sends and goes on, and the recipient's answer comes
 * back as a message in the asking session, which wakes it. The answer is the
 * recipient's own `sendMessage({ inReplyTo })` when its model sends one, and
 * otherwise the framework's, through that same send, at the turn's end: the
 * turn's final text, or a "no answer" when there was nothing to say, the turn
 * threw, or its server died mid-turn.
 *
 * Why it matters: a worker that asks without waiting (to keep talking to its
 * user, or to ask several workers at once) heard nothing back. The answer was
 * the recipient's final text, which only a waiting call reads, so it was lost.
 * Such a message must get exactly one answer, attributed to the recipient, and never
 * silence; and a call must stay a call, not also be answered as a message.
 *
 * The sender is the agent worker (Otto), driven step by step. Everything is
 * read from the message log and each session's requests.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const fault = { dieBeforeDelivered: false, holdOwnAnswers: false };
let releaseHeld: () => void = () => {};

// A recipient whose process dies between owing a reply and the delivery (the
// next markDelivered throws, once); and an answer of the model's own whose
// dispatch hangs, as a process dying mid-dispatch would leave it.
vi.mock("../src/messages/delivery", async (original) => {
  const actual = await original<typeof import("../src/messages/delivery")>();
  return {
    ...actual,
    markDelivered: (...args: Parameters<typeof actual.markDelivered>) => {
      if (fault.dieBeforeDelivered) {
        fault.dieBeforeDelivered = false;
        return Promise.reject(new Error("the process died before the delivery"));
      }
      return actual.markDelivered(...args);
    },
    dispatchMessage: (...args: Parameters<typeof actual.dispatchMessage>) => {
      if (fault.holdOwnAnswers && args[2] === "scripted-answer") {
        return new Promise<never>((_, reject) => (releaseHeld = () => reject(new Error("the process died mid-dispatch"))));
      }
      return actual.dispatchMessage(...args);
    }
  };
});
import { defineFlow, handler } from "@flow-state-dev/core";
import type { GeneratorModel, GeneratorModelCallOptions } from "@flow-state-dev/core/types";
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
import { sendMessage } from "../src/messages/send-message";
import { NOTICE_DUE_MS } from "@flow-state-dev/orchestration/tasks";
import { deriveWorkerSessionId } from "../src/workers/derive-session-id";
import type { WorkerInstallation } from "../src/workers/installation";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const textOf = (input: unknown) => JSON.stringify(input).replaceAll("\\", "");

type Step = Awaited<ReturnType<GeneratorModel["generateStep"]>>;

/** Whether a tool already answered since the last user line of `messages`. */
function answeredSinceUser(messages: unknown): boolean {
  const list = (messages ?? []) as Array<Record<string, unknown>>;
  let start = 0;
  list.forEach((m, i) => {
    if (m.role === "user") start = i;
  });
  return list.slice(start).some((m) => m.role === "tool");
}

/**
 * Otto's model, step by step: on a user line holding a key of `plans`, its
 * first step sends that plan's messages; then, and on anything else, it says
 * a short line.
 */
function ottoModel(plans: Record<string, Array<Record<string, unknown>>>) {
  const seen: GeneratorModelCallOptions[] = [];
  const model: GeneratorModel = {
    modelId: "otto-steps",
    async generate() {
      throw new Error("Otto is driven step by step");
    },
    async generateStep(options): Promise<Step> {
      seen.push(options);
      const list = (options.messages ?? []) as Array<Record<string, unknown>>;
      const line = textOf([...list].reverse().find((m) => m.role === "user")?.content ?? "");
      const plan = Object.entries(plans).find(([key]) => line.includes(key))?.[1];
      if (!answeredSinceUser(options.messages) && plan !== undefined) {
        return {
          toolCalls: plan.map((args, i) => ({ toolCallId: `c${seen.length}-${i}`, toolName: "sendMessage", args })),
          finishReason: "tool-calls"
        } as Step;
      }
      return { text: "Noted.", finishReason: "stop" } as Step;
    }
  };
  return { model, seen };
}

/** The coordinators' judgment: a reply request about the codename or the plan is answered; anything else is quiet. */
function coordinatorsAnswer() {
  return mockGenerator({
    script: [
      { when: (input) => textOf(input).includes("they asked for a reply") && textOf(input).includes("What is the codename?"), then: { text: "The codename is Bluebird." } },
      { when: (input) => textOf(input).includes("they asked for a reply") && textOf(input).includes("What is the plan?"), then: { text: "We ship Friday." } },
      { when: () => true, then: { text: "" } }
    ]
  });
}

/**
 * A worker whose message turn is code: on a message holding `[own]` it answers
 * with its own `sendMessage({ inReplyTo })` and then ends with more text; on
 * one holding `[throw]` it throws.
 */
function scriptedFlow(installation: WorkerInstallation) {
  const turn = handler({
    name: "scripted-answer",
    inputSchema: messageReceivedSchema,
    resources: { ...workerMessagesResources },
    execute: async (message, ctx) => {
      if (message.text.includes("[throw]")) throw new Error("the turn broke");
      if (message.text.includes("[own]")) {
        const sent = await sendMessage(ctx as never, installation, "scripted", { to: message.from, text: "Bluebird, said myself.", inReplyTo: message.id }, "scripted-answer");
        if (!sent.ok) throw new Error(sent.error);
      }
      return "And some closing words.";
    }
  });
  const door = handler({ name: "scripted-run", inputSchema: z.object({ message: z.string() }), execute: async (input) => `heard: ${input.message}` });
  return defineFlow({
    kind: "scripted",
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { ...installation.resources, ...workerMessagesResources, ...conversationLedgerResources },
    actions: { respond: { inputSchema: z.object({ message: z.string() }), block: door, userMessage: (i: { message: string }) => i.message, concurrency: REPLY_CONCURRENCY } },
    internal: { actions: { [MESSAGE_RECEIVED_ENTRY]: messageReceivedEntry({ installation, flowKind: "scripted", turn }) } }
  } as never);
}

/** A worker whose `onMessageReceived` runs no turn. `unmarked` hides that from the sender, as an older copy of this package would. */
function quietFlow(installation: WorkerInstallation, flow: string, unmarked = false) {
  const entry = messageReceivedEntry({ installation, flowKind: flow }) as Record<symbol, unknown>;
  if (unmarked) {
    const { runsTurn: _runsTurn, ...mark } = entry[RECEIVED_MARK] as Record<string, unknown>;
    entry[RECEIVED_MARK] = mark;
  }
  const door = handler({ name: "quiet-run", inputSchema: z.object({ message: z.string() }), execute: async (input) => `heard: ${input.message}` });
  return defineFlow({
    kind: flow,
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { ...installation.resources, ...workerMessagesResources, ...conversationLedgerResources },
    actions: { respond: { inputSchema: z.object({ message: z.string() }), block: door, userMessage: (i: { message: string }) => i.message, concurrency: REPLY_CONCURRENCY } },
    internal: { actions: { [MESSAGE_RECEIVED_ENTRY]: entry } }
  } as never);
}

let open: BoardHost | undefined;
afterEach(async () => {
  fault.dieBeforeDelivered = false;
  fault.holdOwnAnswers = false;
  releaseHeld();
  await open?.dispose();
  open = undefined;
});

async function boot(otto: GeneratorModel, options: BoardHostOptions = {}) {
  const h = bootBoardHost({
    durable: true,
    agentModel: otto,
    judgment: coordinatorsAnswer(),
    standard: [
      ...boardWorkers(),
      { id: "scripted", declared: { flow: "scripted", description: "Answers in code." }, body: "", skills: [] },
      { id: "quiet", declared: { flow: "quiet", description: "Takes messages, answers none." }, body: "", skills: [] },
      { id: "oldquiet", declared: { flow: "oldquiet", description: "Takes messages, answers none, and doesn't say so." }, body: "", skills: [] }
    ],
    flows: (installation) => ({
      scripted: { flow: scriptedFlow(installation), roles: [] },
      quiet: { flow: quietFlow(installation, "quiet"), roles: [] },
      oldquiet: { flow: quietFlow(installation, "oldquiet", true), roles: [] }
    }),
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
  return Object.values(entries)
    .map((value) => value.state as Record<string, any>)
    .sort((a, b) => a.at - b.at);
}

/** The answers in the log to `messageId`. */
async function answersTo(h: BoardHost, messageId: string) {
  return (await logRows(h)).filter((row) => row.inReplyTo === messageId);
}

async function toolOutputs(h: BoardHost, sessionId: string): Promise<Array<Record<string, any>>> {
  return (await h.requestsOf(sessionId))
    .flatMap((request) => (request as unknown as { items?: any[] }).items ?? [])
    .filter((item) => item.type === "tool_output" && typeof item.output === "object" && item.output !== null)
    .map((item) => item.output as Record<string, any>);
}

/** Every `onMessageReceived` request in `sessionId` that landed a message, oldest first. */
async function landedIn(h: BoardHost, sessionId: string) {
  return (await h.requestsOf(sessionId)).filter((r: any) => r.actionName === MESSAGE_RECEIVED_ENTRY && r.status === "completed" && r.result?.output?.turnless !== true) as any[];
}

/** The ids of the messages `sessionId` heard, as their received items say. */
async function heardIn(h: BoardHost, sessionId: string): Promise<string[]> {
  return (await h.requestsOf(sessionId))
    .flatMap((request) => (request as unknown as { items?: any[] }).items ?? [])
    .filter((item) => item.type === "component" && item.component === "workforce:received")
    .map((item) => item.data?.id as string);
}

/**
 * Whether `answer` was sent by the turn's end, not by the pass that backs it
 * up: the pass looks no sooner than its due time after the message landed.
 */
function sentByTurnEnd(ask: Record<string, any>, answer: Record<string, any>): boolean {
  return answer.at - ask.at < NOTICE_DUE_MS;
}

/** Poll `check` until it holds, for at most `ms`. Whether it held. */
async function until(check: () => Promise<boolean> | boolean, ms = 15_000): Promise<boolean> {
  for (const deadline = Date.now() + ms; Date.now() < deadline; ) {
    if (await check()) return true;
    await sleep(50);
  }
  return check();
}

/** Otto's ask ids, from what its sends answered. */
async function sentIds(h: BoardHost, otto: string): Promise<string[]> {
  return (await toolOutputs(h, otto)).map((o) => o.sent).filter((id): id is string => typeof id === "string");
}

describe("a message that asks for a reply", { timeout: 40_000 }, () => {
  it("is answered with the recipient's final text, as a message from it that lands in the asking session", async () => {
    const { model } = ottoModel({ "Ask the lead": [{ to: "lead", text: "What is the codename?", replyRequested: true }] });
    const { h, otto } = await boot(model);
    await h.post("alice", otto, "respond", { message: "Ask the lead for the codename" }, "agent");
    await h.settled();

    // The send didn't wait: the tool said sent, and Otto's turn ended on its own line.
    const [ask] = await sentIds(h, otto);
    expect(ask).toMatch(/^msg_/);
    expect(await until(async () => (await answersTo(h, ask!)).length === 1)).toBe(true);
    await h.settled();

    const [answer] = await answersTo(h, ask!);
    expect(answer).toMatchObject({ from: "lead", to: "otto", text: "The codename is Bluebird.", toSession: otto, status: "delivered" });
    expect(answer!.noAnswer).toBeUndefined();
    // Never itself reply-requested: Otto's turn on it sends nothing back.
    expect(answer!.replyRequested).toBeUndefined();
    const asked = (await logRows(h)).find((row) => row.id === ask)!;
    expect(asked).toMatchObject({ replyRequested: true, answeredBy: answer!.id });
    // It woke Otto: a turn ran on it, in Otto's session.
    expect(await heardIn(h, otto)).toEqual([answer!.id]);
    expect(await logRows(h)).toHaveLength(2);
  });

  it("to two workers gets two answers, each its own message and its own turn in the asking session", async () => {
    const { model } = ottoModel({
      "Ask both": [
        { to: "lead", text: "What is the codename?", replyRequested: true },
        { to: "pm", text: "What is the plan?", replyRequested: true }
      ]
    });
    const { h, otto } = await boot(model);
    await h.post("alice", otto, "respond", { message: "Ask both of them" }, "agent");
    await h.settled();
    const asks = await sentIds(h, otto);
    expect(asks).toHaveLength(2);
    expect(await until(async () => (await heardIn(h, otto)).length === 2)).toBe(true);
    await h.settled();

    const answers = (await logRows(h)).filter((row) => row.inReplyTo !== undefined);
    expect(answers.map((row) => [row.from, row.text]).sort()).toEqual([
      ["lead", "The codename is Bluebird."],
      ["pm", "We ship Friday."]
    ]);
    expect(answers.every((row) => row.toSession === otto)).toBe(true);
    expect((await landedIn(h, otto)).length).toBe(2);
  });

  it("whose turn says nothing is answered 'no answer', never left silent", async () => {
    const { model } = ottoModel({ "Ask the lead": [{ to: "lead", text: "Anything to add?", replyRequested: true }] });
    const { h, otto } = await boot(model);
    await h.post("alice", otto, "respond", { message: "Ask the lead if there is more" }, "agent");
    await h.settled();
    const [ask] = await sentIds(h, otto);
    expect(await until(async () => (await answersTo(h, ask!)).length === 1)).toBe(true);
    const [answer] = await answersTo(h, ask!);
    expect(answer).toMatchObject({ from: "lead", noAnswer: true, text: `I have no answer to your message ${ask}.` });
    expect(sentByTurnEnd((await logRows(h)).find((row) => row.id === ask)!, answer!)).toBe(true);
  });

  it("answered by the recipient's own sendMessage gets that answer only: the turn's final text isn't sent too", async () => {
    const { model } = ottoModel({ "Ask the scripted one": [{ to: "scripted", text: "What is the codename? [own]", replyRequested: true }] });
    const { h, otto } = await boot(model);
    await h.post("alice", otto, "respond", { message: "Ask the scripted one" }, "agent");
    await h.settled();
    const [ask] = await sentIds(h, otto);
    expect(await until(async () => (await heardIn(h, otto)).length >= 1)).toBe(true);
    await h.settled();
    await sleep(500);

    const answers = await answersTo(h, ask!);
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({ from: "scripted", text: "Bluebird, said myself." });
    expect((await logRows(h)).find((row) => row.id === ask)!.answeredBy).toBe(answers[0]!.id);
    expect(await heardIn(h, otto)).toEqual([answers[0]!.id]);
  });

  it("whose turn throws is answered 'no answer', and the turn still fails", async () => {
    const { model } = ottoModel({ "Ask the scripted one": [{ to: "scripted", text: "What is the codename? [throw]", replyRequested: true }] });
    const { h, otto } = await boot(model);
    await h.post("alice", otto, "respond", { message: "Ask the scripted one" }, "agent");
    await h.settled();
    const [ask] = await sentIds(h, otto);
    expect(await until(async () => (await answersTo(h, ask!)).length === 1)).toBe(true);
    await h.settled();
    const [answer] = await answersTo(h, ask!);
    expect(answer).toMatchObject({ from: "scripted", noAnswer: true });
    expect(sentByTurnEnd((await logRows(h)).find((row) => row.id === ask)!, answer!)).toBe(true);

    // The rescue answered and let the error go on: the landing request failed.
    const scripted = (await logRows(h)).find((row) => row.id === ask)!.toSession as string;
    const turns = (await h.requestsOf(scripted)).filter((r: any) => r.actionName === MESSAGE_RECEIVED_ENTRY) as any[];
    expect(turns.map((r) => r.status)).toContain("failed");
  });

  it("whose server died mid-turn is answered 'no answer' by the recipient session's pass, and once only", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let holding = false;
    const { model } = ottoModel({ "Ask the lead": [{ to: "lead", text: "What is the codename?", replyRequested: true }] });
    const { h, otto } = await boot(model, {
      // The lead's turn on the message holds until the test lets it go.
      afterModelCall: async (block) => {
        if (block === "coordinator-judgment" && !holding) {
          holding = true;
          await held;
        }
      }
    });
    await h.post("alice", otto, "respond", { message: "Ask the lead for the codename" }, "agent");
    expect(await until(() => holding)).toBe(true);
    const [ask] = await sentIds(h, otto);
    const lead = await deriveWorkerSessionId({ userId: "alice", orgId: ORG, flow: "coordinator", criteria: { worker: "lead" } });

    // The process running the lead's turn is gone: its record reads ended
    // (as the sweep marks a request whose heartbeat stopped).
    const store = (await h.state.getRuntime()).stores.request;
    const turn = ((await h.requestsOf(lead)) as any[]).find((r) => r.actionName === MESSAGE_RECEIVED_ENTRY && r.status === "in_progress");
    expect(turn).toBeDefined();
    const get = store.get.bind(store);
    store.get = (async (id: string, ...rest: unknown[]) => {
      const record = await (get as any)(id, ...rest);
      return id === turn.id && record !== undefined ? { ...record, status: "failed" } : record;
    }) as typeof store.get;

    expect(await until(async () => (await answersTo(h, ask!)).length === 1, 20_000)).toBe(true);
    expect((await answersTo(h, ask!))[0]).toMatchObject({ from: "lead", noAnswer: true, toSession: otto });
    store.get = get;

    // The turn comes back after all: it answers nothing more.
    release();
    await h.settled();
    await sleep(2_500);
    expect(await answersTo(h, ask!)).toHaveLength(1);
    expect((await h.session(lead)).state?.workerRepliesOwed ?? []).toEqual([]);
  }, 40_000);
});

describe("a reply-requested message across a process death", { timeout: 40_000 }, () => {
  // Owed before it reads delivered: a death after the delivery still gets an answer.
  it("whose recipient died before the delivery is owed from before it, and the resend's turn answers it once", async () => {
    fault.dieBeforeDelivered = true;
    const { model } = ottoModel({ "Ask the lead": [{ to: "lead", text: "What is the codename?", replyRequested: true }] });
    const { h, otto } = await boot(model);
    await h.post("alice", otto, "respond", { message: "Ask the lead for the codename" }, "agent");
    const lead = await deriveWorkerSessionId({ userId: "alice", orgId: ORG, flow: "coordinator", criteria: { worker: "lead" } });
    // The dead landing owed it before the delivery it never wrote.
    expect(await until(async () => ((await h.session(lead).catch(() => undefined))?.state?.workerRepliesOwed ?? []).length === 1)).toBe(true);
    expect(await until(async () => (await sentIds(h, otto)).length === 1)).toBe(true);
    const [sent] = await sentIds(h, otto);

    // The sender's pass sends it again; the request that lands it answers it, once, with the real text.
    expect(await until(async () => (await answersTo(h, sent!)).length === 1, 20_000)).toBe(true);
    await h.settled();
    await sleep(2_500);
    const answers = await answersTo(h, sent!);
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({ from: "lead", text: "The codename is Bluebird." });
    expect((await h.session(lead)).state?.workerRepliesOwed ?? []).toEqual([]);
  });

  // Claimed before it goes out: a death mid-dispatch leaves no room for a second answer.
  it("answered by the recipient's own send is marked answered before that send's dispatch", async () => {
    fault.holdOwnAnswers = true;
    const { model } = ottoModel({ "Ask the scripted one": [{ to: "scripted", text: "What is the codename? [own]", replyRequested: true }] });
    const { h, otto } = await boot(model);
    await h.post("alice", otto, "respond", { message: "Ask the scripted one" }, "agent");
    expect(await until(async () => (await sentIds(h, otto)).length === 1)).toBe(true);
    const [sent] = await sentIds(h, otto);
    expect(await until(async () => (await answersTo(h, sent!)).length === 1)).toBe(true);
    const [answer] = await answersTo(h, sent!);
    // Its dispatch hasn't returned, and the message already names it.
    expect(answer).toMatchObject({ from: "scripted", status: "unconfirmed" });
    expect((await logRows(h)).find((row) => row.id === sent)!.answeredBy).toBe(answer!.id);
  });
});

describe("a reply request to a worker that runs nothing on a message", { timeout: 40_000 }, () => {
  it("is refused no_reply before anything is written", async () => {
    const { model } = ottoModel({ "Ask the quiet one": [{ to: "quiet", text: "What is the codename?", replyRequested: true }] });
    const { h, otto } = await boot(model);
    await h.post("alice", otto, "respond", { message: "Ask the quiet one" }, "agent");
    await h.settled();
    expect((await toolOutputs(h, otto))[0]).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^no_reply: "quiet" takes messages but runs nothing on them.*Send without replyRequested/)
    });
    expect(await logRows(h)).toEqual([]);
  });

  it("that couldn't tell up front is answered 'no answer' once it lands", async () => {
    const { model } = ottoModel({ "Ask the old quiet one": [{ to: "oldquiet", text: "What is the codename?", replyRequested: true }] });
    const { h, otto } = await boot(model);
    await h.post("alice", otto, "respond", { message: "Ask the old quiet one" }, "agent");
    await h.settled();
    const [ask] = await sentIds(h, otto);
    expect(await until(async () => (await answersTo(h, ask!)).length === 1)).toBe(true);
    expect((await answersTo(h, ask!))[0]).toMatchObject({ from: "oldquiet", noAnswer: true, toSession: otto });
  });
});

describe("a call", { timeout: 40_000 }, () => {
  it("is never also reply-requested: its reply is the tool's result, and no message answers it", async () => {
    const { model } = ottoModel({ "Call the lead": [{ to: "lead", text: "What is the codename?", wait: true, replyRequested: true }] });
    const { h, otto } = await boot(model, {
      judgment: mockGenerator({
        script: [
          { when: (input) => textOf(input).includes("they are waiting for your answer"), then: { text: "The codename is Bluebird." } },
          { when: () => true, then: { text: "" } }
        ]
      })
    });
    await h.post("alice", otto, "respond", { message: "Call the lead" }, "agent");
    await h.settled();
    await sleep(2_500);
    const [output] = await toolOutputs(h, otto);
    expect(output).toMatchObject({ status: "answered", reply: "The codename is Bluebird." });
    const rows = await logRows(h);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ call: true });
    expect(rows[0]!.replyRequested).toBeUndefined();
    expect(await heardIn(h, otto)).toEqual([]);
  });
});
