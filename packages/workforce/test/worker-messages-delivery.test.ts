/**
 * A worker message lands once (FIX-2240): the send owes its session's pass,
 * the recipient's `onMessageReceived` takes the message on its row, and only
 * the sending session's board pass sends it again, until the row is
 * delivered, refused, or owed past the host's debt age.
 *
 * Why it matters: a message the host accepted, or one whose dispatch threw,
 * is not a message the recipient heard. Today's two tries leave it lost; a
 * late copy must still land once; and a sender whose message can't land must
 * be told, in the session its next turn reads.
 *
 * On a durable host whose router runs the sweeper, so the pass's wake fires.
 * The send's own dispatch (`from: "sendMessage"`) can be made to throw, in
 * this file alone; a resend (`MESSAGE_RESEND_FROM`) never is.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const fault = { dropFastPathOnce: false, throwFastPath: false, loseFastPath: false, refuseFastPath: false, throwAfterTake: false, refuseResends: false };

// A recipient that dies between its take and its items: the first message
// turn's start (a hop past the user's own) throws, once.
vi.mock("../src/messages/hop", async (original) => {
  const actual = await original<typeof import("../src/messages/hop")>();
  return {
    ...actual,
    startTurnAtHop: (...args: Parameters<typeof actual.startTurnAtHop>) => {
      if (fault.throwAfterTake && args[1] > 0) {
        fault.throwAfterTake = false;
        return Promise.reject(new Error("the process died after the take"));
      }
      return actual.startTurnAtHop(...args);
    }
  };
});

vi.mock("@flow-state-dev/core/types", async (original) => {
  const actual = await original<typeof import("@flow-state-dev/core/types")>();
  return {
    ...actual,
    dispatchThroughSeam: (ctx: never, spec: { action: string; from?: string }) => {
      // The send ended between its row and its dispatch: nothing was started.
      if (spec.action === "onMessageReceived" && spec.from === "sendMessage" && fault.dropFastPathOnce) {
        fault.dropFastPathOnce = false;
        return Promise.reject(new Error("the process died before the dispatch"));
      }
      if (spec.action === "onMessageReceived" && spec.from === "sendMessage" && fault.throwFastPath) {
        return Promise.reject(new Error("the connection dropped"));
      }
      if (spec.action === "onMessageReceived" && spec.from === "sendMessage" && fault.refuseFastPath) {
        return Promise.resolve({ ok: false, refused: "session-not-found", detail: "no such session" });
      }
      if (spec.action === "onMessageReceived" && spec.from === "worker-message-resend" && fault.refuseResends) {
        return Promise.resolve({ ok: false, refused: "session-not-found", detail: "no such session" });
      }
      // Accepted, and the request it starts ends before its take: as a queued
      // request the host stopped would.
      if (spec.action === "onMessageReceived" && spec.from === "sendMessage" && fault.loseFastPath) {
        return actual.dispatchThroughSeam(ctx, { ...(spec as never as Record<string, unknown>), payload: { messageId: "msg_never_taken" } } as never);
      }
      return actual.dispatchThroughSeam(ctx, spec as never);
    }
  };
});

const { runAction } = await import("@flow-state-dev/engine");
const { mockGenerator } = await import("@flow-state-dev/testing");
const { bootBoardHost } = await import("./conversation-board-harness");
const { WORKER_MESSAGES_PATTERN } = await import("../src/messages/message-log");
const { MESSAGE_RESEND_FROM } = await import("../src/messages/delivery");
const { boardWorkers } = await import("./conversation-board-harness");
const { defineFlow, handler, markDispatcher } = await import("@flow-state-dev/core");
const { z } = await import("zod");
const { defineSessionBoard, workerConfigSchema } = await import("../src");
const { sendMessage } = await import("../src/messages/send-message");
const { messageTurnStateSchema } = await import("../src/messages/hop");
const { workerMessagesResources } = await import("../src/messages/message-log");
const { messageReceivedEntry } = await import("../src/messages/message-received-entry");
type WorkerInstallation = import("../src/workers/installation").WorkerInstallation;
type BoardHost = import("./conversation-board-harness").BoardHost;

const ORG = "acme";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const textOf = (input: unknown) => JSON.stringify(input).replaceAll("\\", "");

let open: BoardHost | undefined;
afterEach(async () => {
  fault.throwFastPath = false;
  fault.loseFastPath = false;
  fault.refuseFastPath = false;
  fault.throwAfterTake = false;
  fault.refuseResends = false;
  fault.dropFastPathOnce = false;
  await open?.dispose();
  open = undefined;
});

/** Otto's first turn mentioning `marker` messages `to` once. */
function ottoSends(to: string, marker = "ask the lead") {
  let called = false;
  return mockGenerator({
    script: [
      {
        when: (input) => {
          if (called || !textOf(input).includes(marker)) return false;
          called = true;
          return true;
        },
        then: { toolCalls: [{ toolCallId: "ask", toolName: "sendMessage", args: { to, text: "What is the codename?" } }] }
      },
      { when: () => true, then: { text: "" } }
    ]
  });
}

async function boot(to = "lead", extra: Parameters<typeof bootBoardHost>[0] = {}) {
  const judgment = mockGenerator({ script: [{ when: () => true, then: { text: "" } }] });
  const h = bootBoardHost({ durable: true, judgment, agentAnswer: ottoSends(to), ...extra });
  open = h;
  await h.state.getRouter();
  const created = await h.create("alice", "agent", { state: { workerId: "otto" } });
  return { h, judgment, otto: created.body.session!.id as string };
}

async function logRows(h: BoardHost) {
  const runtime = await h.state.getRuntime();
  const entries = await runtime.stores.resourceState.getByPrefix("user", `alice:~org:${ORG}`, WORKER_MESSAGES_PATTERN.replace("*", ""));
  return Object.values(entries).map((value) => value.state as Record<string, any>);
}

async function receivedIn(h: BoardHost, sessionId: string, id: string) {
  return (await h.requestsOf(sessionId))
    .flatMap((request) => (request as unknown as { items?: any[] }).items ?? [])
    .filter((item) => item.type === "component" && item.component === "workforce:received" && item.data?.id === id);
}

async function toolOutputs(h: BoardHost, sessionId: string) {
  return (await h.requestsOf(sessionId))
    .flatMap((request) => (request as unknown as { items?: any[] }).items ?? [])
    .filter((item) => item.type === "tool_output")
    .map((item) => JSON.stringify(item.output));
}

/** Wait until the one row in the log satisfies `done`, or give up. */
async function rowUntil(h: BoardHost, done: (row: Record<string, any>) => boolean, ms = 15_000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const [row] = await logRows(h);
    if (row !== undefined && done(row)) return row;
    if (Date.now() > deadline) return row;
    await sleep(100);
  }
}

/** Run `onMessageReceived` for `messageId` in `sessionId`, as another copy of the dispatch would. */
async function deliverAgain(h: BoardHost, flow: string, sessionId: string, messageId: string) {
  const runtime = await h.state.getRuntime();
  const run = await runAction({
    flow: h.instances[flow]!,
    actionName: "onMessageReceived",
    input: { messageId },
    userId: "alice",
    orgId: ORG,
    sessionId,
    source: "internal",
    stores: runtime.stores,
    runtimeConfig: { ...runtime.runtimeConfig }
  } as never);
  await h.settled();
  return run as { requestId?: string };
}

describe("a message whose send can't confirm it", () => {
  it("is answered { sent }, then sent again by the sending session's pass and heard once", async () => {
    fault.throwFastPath = true;
    const { h, otto } = await boot();
    await h.post("alice", otto, "respond", { message: "Please ask the lead" }, "agent");
    await h.settled();
    expect((await toolOutputs(h, otto))[0]).toMatch(/^\{"sent":"msg_\w+"\}$/);
    const [first] = await logRows(h);
    expect(first).toMatchObject({ status: "unconfirmed", reason: "the connection dropped" });

    const row = await rowUntil(h, (r) => r.status === "delivered");
    expect(row).toMatchObject({ status: "delivered", resent: { n: 1 } });
    await h.settled();
    const lead = (await h.client("alice").findWorkerSession({ worker: "lead" }))!;
    expect(await receivedIn(h, lead.id, row!.id)).toHaveLength(1);
    // The request it landed in was the pass's resend: nothing else sends it.
    const landed = (await h.requestsOf(lead.id)).find((r) => r.id === row!.deliveredAs) as any;
    expect(landed?.actionName).toBe("onMessageReceived");
    expect(JSON.stringify(landed?.metadata ?? {})).toContain(MESSAGE_RESEND_FROM);
    // Paid: the next pass finds it delivered and drops it, so the session owes nothing more.
    let owed: unknown[] = [row!.id];
    for (let i = 0; i < 100 && owed.length > 0; i += 1) {
      await sleep(100);
      owed = ((await h.session(otto)).state?.workerMessagesOwed as unknown[] | undefined) ?? [];
    }
    expect(owed).toEqual([]);
  }, 30_000);

  it("stays owed while the host accepts nothing, and lands once it does: an unaccepted dispatch is never final", async () => {
    const { h, otto } = await boot();
    const lost = await h.loseDispatches("onMessageReceived");
    await h.post("alice", otto, "respond", { message: "Please ask the lead" }, "agent");
    await h.settled();
    const [first] = await logRows(h);
    expect(first).toMatchObject({ status: "unconfirmed" });
    expect((await toolOutputs(h, otto))[0]).toMatch(/^\{"sent":"msg_\w+"\}$/);
    lost.restore();

    const row = await rowUntil(h, (r) => r.status === "delivered");
    expect(row?.status).toBe("delivered");
    await h.settled();
    const lead = (await h.client("alice").findWorkerSession({ worker: "lead" }))!;
    expect(await receivedIn(h, lead.id, row!.id)).toHaveLength(1);
  }, 30_000);
});

describe("a final refusal of the send's own dispatch", () => {
  it("ends the row refused and told, the tool says why, and nothing sends it again", async () => {
    fault.refuseFastPath = true;
    const { h, otto } = await boot();
    await h.post("alice", otto, "respond", { message: "Please ask the lead" }, "agent");
    await h.settled();
    const [row] = await logRows(h);
    expect(row).toMatchObject({ status: "refused", reason: "session-not-found: no such session", toldAt: expect.any(Number) });
    expect((await toolOutputs(h, otto))[0]).toMatch(/not_delivered.*session-not-found/);
    expect((await h.session(otto)).state?.workerMessagesOwed ?? []).toEqual([]);
    // The tool's answer told the model: no line beside it.
    await sleep(2_500);
    expect((await h.messages(otto)).some((m) => m.text.includes("wasn't delivered"))).toBe(false);
    expect((await logRows(h))[0]?.resent).toBeUndefined();
  }, 30_000);
});

describe("a message the host accepted", () => {
  it("isn't delivered until the recipient takes it: one whose request ended before the take is sent again and heard once", async () => {
    fault.loseFastPath = true;
    const { h, otto } = await boot();
    await h.post("alice", otto, "respond", { message: "Please ask the lead" }, "agent");
    await h.settled();
    const [first] = await logRows(h);
    expect(first).toMatchObject({ status: "unconfirmed" });
    const row = await rowUntil(h, (r) => r.status === "delivered");
    expect(row).toMatchObject({ status: "delivered", resent: { n: 1 } });
    await h.settled();
    expect(await receivedIn(h, row!.toSession, row!.id)).toHaveLength(1);
  }, 30_000);
});

describe("the take on the row", () => {
  it("keeps a message heard once at any distance: a copy after it landed runs nothing", async () => {
    const { h, judgment, otto } = await boot();
    await h.post("alice", otto, "respond", { message: "Please ask the lead" }, "agent");
    await h.settled();
    const [row] = await logRows(h);
    expect(row).toMatchObject({ status: "delivered", deliveredAs: expect.any(String) });
    const lead = (await h.client("alice").findWorkerSession({ worker: "lead" }))!;
    const turns = judgment.calls.length;
    await deliverAgain(h, "coordinator", lead.id, row!.id);
    expect(await receivedIn(h, lead.id, row!.id)).toHaveLength(1);
    expect(judgment.calls.length).toBe(turns);
  }, 30_000);

  it("is taken over from a taker that ended without delivering: the message lands, once", async () => {
    const { h, otto } = await boot();
    await h.post("alice", otto, "respond", { message: "Please ask the lead" }, "agent");
    await h.settled();
    const [row] = await logRows(h);
    const lead = (await h.client("alice").findWorkerSession({ worker: "lead" }))!;
    // As a crash after the take leaves it: taken by a request that ended, items gone, not delivered.
    const ended = (await h.requestsOf(lead.id)).find((r) => r.id === row!.deliveredAs)!;
    const runtime = await h.state.getRuntime();
    const key = `${WORKER_MESSAGES_PATTERN.replace("*", "")}${row!.id}`;
    const { deliveredAs: _a, deliveredAt: _b, ...taken } = row!;
    await runtime.stores.resourceState.set("user", `alice:~org:${ORG}`, key, { ...taken, status: "unconfirmed", takenBy: ended.id } as never, "any" as never);

    const copy = await deliverAgain(h, "coordinator", lead.id, row!.id);
    const [after] = await logRows(h);
    expect(after).toMatchObject({ status: "delivered", takenBy: copy.requestId, deliveredAs: copy.requestId });
    // The taker's items landed with it; the copy's are the second: the one window left (D: "delivered" before the turn).
    expect(await receivedIn(h, lead.id, row!.id)).toHaveLength(2);
  }, 30_000);
  it("is marked delivered only once its items are stored: the request store is flushed while the row is still only taken", async () => {
    const { h, otto } = await boot();
    const store = (await h.state.getRuntime()).stores.request;
    const flush = store.flushItems.bind(store);
    const atFlush: Array<{ requestId: string; status?: string; takenBy?: string }> = [];
    store.flushItems = async (requestId: string) => {
      const [row] = await logRows(h);
      atFlush.push({ requestId, status: row?.status, takenBy: row?.takenBy });
      return flush(requestId);
    };
    await h.post("alice", otto, "respond", { message: "Please ask the lead" }, "agent");
    await h.settled();
    const [row] = await logRows(h);
    expect(row).toMatchObject({ status: "delivered" });
    // The taker flushed its items while the row said only "taken by me", so a
    // crash before the write leaves a row the next copy takes over.
    expect(atFlush).toContainEqual({ requestId: row!.deliveredAs, status: "unconfirmed", takenBy: row!.deliveredAs });
  }, 30_000);

  it("is sent again when its taker died after the take and before the items: the pass resends it and it lands once", async () => {
    fault.throwAfterTake = true;
    const { h, otto } = await boot();
    await h.post("alice", otto, "respond", { message: "Please ask the lead" }, "agent");
    await h.settled();
    const [first] = await logRows(h);
    // Taken, then nothing: the take alone isn't a delivery, so the sender still owes it.
    expect(first).toMatchObject({ status: "unconfirmed", takenBy: expect.any(String) });
    const row = await rowUntil(h, (r) => r.status === "delivered");
    expect(row).toMatchObject({ status: "delivered", resent: { n: 1 } });
    expect(row!.takenBy).not.toBe(first!.takenBy);
    await h.settled();
    expect(await receivedIn(h, row!.toSession, row!.id)).toHaveLength(1);
  }, 30_000);
});

describe("a message that can't land after its send returned", () => {
  it("is refused when its recipient was fired before the resend, and the sending session gets a line its next turn reads", async () => {
    fault.throwFastPath = true;
    const { h, otto } = await boot("my.lead");
    expect((await h.hire("alice", { id: "my.lead", flow: "coordinator", instructions: "Mine." })).error).toBeUndefined();
    await h.post("alice", otto, "respond", { message: "Please ask the lead" }, "agent");
    await h.settled();
    expect((await h.fire("alice", "my.lead")).error).toBeUndefined();

    const row = await rowUntil(h, (r) => r.status !== "unconfirmed" && r.toldAt !== undefined);
    expect(row).toMatchObject({ status: "refused", reason: expect.stringMatching(/^worker_unavailable|^no_worker/) });
    await h.settled();
    const lines = (await h.messages(otto)).map((m) => m.text);
    expect(lines.filter((line) => line.startsWith(`Your message ${row!.id} to my.lead wasn't delivered`))).toHaveLength(1);
    expect(await receivedIn(h, row!.toSession, row!.id)).toEqual([]);
    expect((await h.session(otto)).state?.workerMessagesOwed ?? []).toEqual([]);
  }, 30_000);

  it("is ended undeliverable past the host's debt age, and its sender told", async () => {
    fault.throwFastPath = true;
    const { h, otto } = await boot("lead", { maxDebtAgeMs: 1_000 });
    const lost = await h.loseDispatches("onMessageReceived");
    await h.post("alice", otto, "respond", { message: "Please ask the lead" }, "agent");
    await h.settled();
    const row = await rowUntil(h, (r) => r.status === "undeliverable" && r.toldAt !== undefined);
    lost.restore();
    expect(row?.status).toBe("undeliverable");
    await h.settled();
    const lines = (await h.messages(otto)).map((m) => m.text);
    expect(lines.filter((line) => line.startsWith(`Your message ${row!.id} to lead wasn't delivered`))).toHaveLength(1);
  }, 30_000);

  it("is refused past the age when it was taken and its destination is gone for good, and its sender told", async () => {
    // Taken, then the taker died; every resend after is refused for good (its
    // session was deleted), while the recipient's recheck still passes.
    fault.throwAfterTake = true;
    fault.refuseResends = true;
    const { h, otto } = await boot("lead", { maxDebtAgeMs: 1_000 });
    await h.post("alice", otto, "respond", { message: "Please ask the lead" }, "agent");
    await h.settled();
    const row = await rowUntil(h, (r) => r.status !== "unconfirmed" && r.toldAt !== undefined);
    expect(row).toMatchObject({ status: "refused", reason: expect.stringMatching(/^session-not-found/), takenBy: expect.any(String) });
    await h.settled();
    const lines = (await h.messages(otto)).map((m) => m.text);
    expect(lines.filter((line) => line.startsWith(`Your message ${row!.id} to lead wasn't delivered`))).toHaveLength(1);
    expect((await h.session(otto)).state?.workerMessagesOwed ?? []).toEqual([]);
  }, 30_000);
});

/** A worker flow whose turn sends one message twice under one server-chosen id, as a send repeated after a crash would. */
function repeatingSenderFlow(installation: WorkerInstallation, results: unknown[]) {
  const board = defineSessionBoard({ installation, flowKind: "sender" });
  const doorInput = z.object({ message: z.string() });
  const turn = markDispatcher(
    handler({
      name: "repeat-sender-turn",
      inputSchema: doorInput,
      outputSchema: z.unknown(),
      requestStateSchema: messageTurnStateSchema,
      resources: { ...installation.resources, ...workerMessagesResources },
      execute: async (input, ctx) => {
        if (!input.message.startsWith("send")) return "";
        // From "sendMessage", as the tool's send is, so this file's send faults reach it.
        for (let i = 0; i < 2; i += 1) {
          results.push(await sendMessage(ctx as never, installation, "sender", { to: "lead", text: "Once?" }, "sendMessage", { id: "msg_fixedrepeat" }));
        }
        return "";
      }
    }),
    { type: "internal", action: "onMessageReceived" }
  );
  return defineFlow({
    kind: "sender",
    configSchema: workerConfigSchema(),
    session: { ...installation.session(board.sessionStateShape), serverOwned: [...board.serverOwned] },
    resources: { ...installation.resources, ...board.resources },
    actions: { respond: { inputSchema: doorInput.strict(), block: turn, userMessage: (i: { message: string }) => i.message }, ...board.actions },
    internal: { actions: board.entries(turn, () => "judgment") }
  } as never);
}

/**
 * The same send twice, from a worker flow with no session board: no pass, so
 * a send has its own dispatch only, as a server send from the coder does.
 */
function passlessSenderFlow(installation: WorkerInstallation, results: unknown[]) {
  const doorInput = z.object({ message: z.string() });
  const turn = handler({
    name: "passless-sender-turn",
    inputSchema: doorInput,
    outputSchema: z.unknown(),
    requestStateSchema: messageTurnStateSchema,
    resources: { ...installation.resources, ...workerMessagesResources },
    execute: async (_input, ctx) => {
      for (let i = 0; i < 2; i += 1) {
        results.push(await sendMessage(ctx as never, installation, "sender", { to: "lead", text: "Once?" }, "sendMessage", { id: "msg_fixedrepeat" }));
      }
      return "";
    }
  });
  return defineFlow({
    kind: "sender",
    configSchema: workerConfigSchema(),
    session: installation.session({}),
    resources: { ...installation.resources, ...workerMessagesResources },
    actions: { respond: { inputSchema: doorInput.strict(), block: turn, userMessage: (i: { message: string }) => i.message } },
    internal: { actions: { onMessageReceived: messageReceivedEntry({ installation, flowKind: "sender" }) } }
  } as never);
}

describe("a send repeated under one server-chosen id", () => {
  it("is one message: the repeat writes no second row, pays no second place and owes nothing new", async () => {
    const results: unknown[] = [];
    const judgment = mockGenerator({ script: [{ when: () => true, then: { text: "" } }] });
    const h = bootBoardHost({
      durable: true,
      judgment,
      standard: [...boardWorkers(), { id: "sendy", declared: { flow: "sender" }, body: "", skills: [] }],
      flows: (installation) => ({ sender: { flow: repeatingSenderFlow(installation, results), roles: ["manager"] } })
    });
    open = h;
    await h.state.getRouter();
    const created = await h.create("alice", "sender", { state: { workerId: "sendy" } });
    const sendy = created.body.session!.id as string;
    await h.post("alice", sendy, "respond", { message: "send it" }, "sender");
    await h.settled();
    // The first send names the request its dispatch became (what a call waits on); the repeat dispatches nothing.
    expect(results).toEqual([
      { ok: true, id: "msg_fixedrepeat", requestId: expect.any(String) },
      { ok: true, id: "msg_fixedrepeat" }
    ]);
    const rows = await logRows(h);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "msg_fixedrepeat", hop: 1, status: "delivered" });
    // One place in the exchange's budget, not two.
    const runtime = await h.state.getRuntime();
    const chains = Object.values(await runtime.stores.resourceState.getByPrefix("user", `alice:~org:${ORG}`, "workforce/message-chains/"));
    expect(chains.map((chain) => (chain.state as { sent: string[] }).sent)).toEqual([["msg_fixedrepeat"]]);
    const lead = (await h.client("alice").findWorkerSession({ worker: "lead" }))!;
    expect(await receivedIn(h, lead.id, "msg_fixedrepeat")).toHaveLength(1);
  }, 30_000);

  it("is sent by the repeat when the flow carries no pass and the first send never dispatched: the message isn't lost, and lands once", async () => {
    fault.dropFastPathOnce = true;
    const results: unknown[] = [];
    const judgment = mockGenerator({ script: [{ when: () => true, then: { text: "" } }] });
    const h = bootBoardHost({
      durable: true,
      judgment,
      standard: [...boardWorkers(), { id: "sendy", declared: { flow: "sender" }, body: "", skills: [] }],
      flows: (installation) => ({ sender: { flow: passlessSenderFlow(installation, results), roles: [] } })
    });
    open = h;
    await h.state.getRouter();
    const created = await h.create("alice", "sender", { state: { workerId: "sendy" } });
    await h.post("alice", created.body.session!.id as string, "respond", { message: "send it" }, "sender");
    await h.settled();
    // No pass would ever send it: the repeat is its only second chance.
    expect(results).toEqual([
      { ok: true, id: "msg_fixedrepeat" },
      { ok: true, id: "msg_fixedrepeat", requestId: expect.any(String) }
    ]);
    const rows = await logRows(h);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "msg_fixedrepeat", status: "delivered" });
    const lead = (await h.client("alice").findWorkerSession({ worker: "lead" }))!;
    expect(await receivedIn(h, lead.id, "msg_fixedrepeat")).toHaveLength(1);
  }, 30_000);

  it("answers a repeat of a refused send with the refusal: a repeat never turns it into a success", async () => {
    fault.refuseFastPath = true;
    const results: unknown[] = [];
    const judgment = mockGenerator({ script: [{ when: () => true, then: { text: "" } }] });
    const h = bootBoardHost({
      durable: true,
      judgment,
      standard: [...boardWorkers(), { id: "sendy", declared: { flow: "sender" }, body: "", skills: [] }],
      flows: (installation) => ({ sender: { flow: repeatingSenderFlow(installation, results), roles: ["manager"] } })
    });
    open = h;
    await h.state.getRouter();
    const created = await h.create("alice", "sender", { state: { workerId: "sendy" } });
    await h.post("alice", created.body.session!.id as string, "respond", { message: "send it" }, "sender");
    await h.settled();
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ ok: false, error: expect.stringMatching(/^not_delivered/) });
    expect(results[1]).toMatchObject({ ok: false, error: expect.stringMatching(/^not_delivered.*refused.*session-not-found/) });
    const rows = await logRows(h);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "msg_fixedrepeat", status: "refused" });
  }, 30_000);
});
