/**
 * Push delivery (FIX-2428) in the engine: what `GET /capabilities` reports,
 * what the mint grants, and what a socket session hears.
 *
 * The mint checks each topic with the check its scope's read route uses, on
 * the mint's own request, and a refused topic is absent from the answer, as a
 * topic for a missing session is. The socket accepts topics only from a
 * ticket the mint signed, for the user the socket's path names.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { DEFAULT_ORG_ID, defineFlow, handler, topic } from "@flow-state-dev/core";
import type { PushMintAnswer, PushServerFrame } from "@flow-state-dev/core/internal";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores,
  type StoreRegistry
} from "../src";
import {
  createInMemoryBus,
  enablePushDelivery,
  type ChangeBus,
  type FlowApiRouter,
  type PushDelivery
} from "../src/host";
import { openPushSocket, PUSH_SOCKET_TIMINGS } from "../src/push/socket-session";
import { signPushTicket } from "../src/push/ticket";

const SECRET = "test-secret";

function demoFlow(kind = "demo") {
  return defineFlow({
    kind,
    actions: {
      run: {
        inputSchema: z.object({}),
        block: handler({ name: `${kind}-run`, inputSchema: z.object({}), outputSchema: z.object({}), execute: () => ({}) })
      }
    }
  })();
}

/** A host that verifies user and organization from two headers. */
function app(options: { bus?: ChangeBus; push?: boolean } = {}) {
  const registry = createFlowRegistry();
  registry.register(demoFlow());
  const stores: StoreRegistry = { ...createInMemoryStores(), ...(options.bus !== undefined ? { bus: options.bus } : {}) };
  const router = createFlowApiRouter({
    registry,
    stores,
    tenantIdHeader: "x-tenant-id",
    resolvePrincipal: (context) => {
      const user = context.request?.headers.get("x-user");
      const org = context.request?.headers.get("x-org") ?? "acme";
      return user == null ? null : { userId: user, orgId: org };
    }
  });
  const delivery = options.push === false ? undefined : enablePushDelivery(router, { secret: SECRET });
  return { router, stores, delivery };
}

async function seedSession(
  stores: StoreRegistry,
  id: string,
  owner: { userId: string; orgId?: string; tenantId?: string }
): Promise<void> {
  const now = Date.now();
  const key = owner.tenantId === undefined ? id : `${owner.tenantId}:${id}`;
  await stores.session.set(
    key,
    {
      id,
      flowKind: "demo",
      flowId: "demo",
      userId: owner.userId,
      orgId: owner.orgId ?? "acme",
      ...(owner.tenantId !== undefined ? { tenantId: owner.tenantId } : {}),
      state: {},
      version: 0,
      createdAt: now,
      updatedAt: now,
      journal: []
    },
    "any"
  );
}

async function call(
  router: FlowApiRouter,
  method: "GET" | "POST",
  path: string,
  headers: Record<string, string> = {},
  body?: unknown
): Promise<Response> {
  const segments = path.split("/").filter(Boolean);
  return router[method](
    new Request(`http://localhost/api/flows/${segments.join("/")}`, {
      method,
      headers: { "content-type": "application/json", ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    }),
    { params: { path: segments } }
  );
}

const ALICE = { "x-user": "alice", "x-org": "acme" };

async function mint(
  router: FlowApiRouter,
  topics: unknown[],
  headers: Record<string, string> = ALICE,
  userId = "alice"
): Promise<{ status: number; answer: PushMintAnswer }> {
  const response = await call(router, "POST", `/users/${userId}/stream`, headers, { topics });
  return { status: response.status, answer: (await response.json()) as PushMintAnswer };
}

/** A socket session over a fake wire: what the server sent, and how it closed. */
function socket(delivery: PushDelivery, userId = "alice") {
  const frames: PushServerFrame[] = [];
  let closed: { code: number; reason: string } | undefined;
  const session = delivery.openSocket(userId, {
    send: (frame) => frames.push(frame),
    close: (code, reason) => {
      closed ??= { code, reason };
    }
  });
  return {
    frames,
    notices: () => frames.filter((frame) => frame.type === "notice"),
    closed: () => closed,
    send: (frame: unknown) => session.receive(JSON.stringify(frame)),
    end: () => session.closed()
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("GET /capabilities", () => {
  it("reports no push until a host serves the socket", async () => {
    const { router } = app({ push: false });
    expect(await (await call(router, "GET", "/capabilities")).json()).toEqual({ userStream: false, push: null });
  });

  it("reports the WebSocket push once the host serves it", async () => {
    const { router } = app();
    expect(await (await call(router, "GET", "/capabilities")).json()).toEqual({
      userStream: false,
      push: { transport: "websocket" }
    });
  });
});

describe("GET /users/:userId/stream without an upgrade", () => {
  it("answers 426: the route only takes a WebSocket upgrade", async () => {
    const { router } = app();
    const response = await call(router, "GET", "/users/alice/stream", ALICE);
    expect(response.status).toBe(426);
  });
});

describe("POST /users/:userId/stream (the mint)", () => {
  it("answers 404 on a host with no push", async () => {
    const { router } = app({ push: false });
    expect((await mint(router, [topic.user()])).status).toBe(404);
  });

  it("refuses a caller who is not the path's user, before checking any topic", async () => {
    const { router } = app();
    expect((await mint(router, [topic.user()], { "x-user": "bob" }, "alice")).status).toBe(403);
    expect((await mint(router, [topic.user()], {}, "alice")).status).toBe(401);
  });

  it("answers a websocket ticket for the caller's own session, user and org topics", async () => {
    const { router, stores } = app();
    await seedSession(stores, "s1", { userId: "alice" });
    const { status, answer } = await mint(router, [
      topic.session("s1"),
      topic.session("s1", { resource: "tasks" }),
      topic.user(),
      topic.org()
    ]);
    expect(status).toBe(200);
    expect(answer.transport).toBe("websocket");
    if (answer.transport !== "websocket") return;
    expect(answer.path).toBe("/users/alice/stream");
    expect(typeof answer.ticket).toBe("string");
    expect(answer.topics).toEqual([
      topic.session("s1"),
      topic.session("s1", { resource: "tasks" }),
      topic.user(),
      topic.org()
    ]);
  });

  it("drops another user's session exactly as a session that doesn't exist", async () => {
    const { router, stores } = app();
    await seedSession(stores, "bobs", { userId: "bob" });
    await seedSession(stores, "own", { userId: "alice" });
    const { status, answer } = await mint(router, [topic.session("bobs"), topic.session("missing"), topic.session("own")]);
    expect(status).toBe(200);
    expect(answer.topics).toEqual([topic.session("own")]);
  });

  it("drops a session of the caller's that another organization owns, and one on another tenant", async () => {
    const { router, stores } = app();
    await seedSession(stores, "globex", { userId: "alice", orgId: "globex" });
    await seedSession(stores, "t2", { userId: "alice", tenantId: "t2" });
    await seedSession(stores, "t1", { userId: "alice", tenantId: "t1" });
    const { answer } = await mint(router, [topic.session("globex"), topic.session("t2"), topic.session("t1")], {
      ...ALICE,
      "x-tenant-id": "t1"
    });
    expect(answer.topics).toEqual([topic.session("t1")]);
  });

  it("refuses a body whose topics aren't wire topics", async () => {
    const { router } = app();
    expect((await mint(router, [{ scope: "user", id: "bob" }])).status).toBe(400);
    expect((await mint(router, [{ scope: "session" }])).status).toBe(400);
    expect((await mint(router, [{ scope: "team" }])).status).toBe(400);
    const notArray = await call(router, "POST", "/users/alice/stream", ALICE, { topics: "user" });
    expect(notArray.status).toBe(400);
  });

  it("drops a session deleted and created again for another user while the caller is being signed in", async () => {
    const registry = createFlowRegistry();
    registry.register(demoFlow());
    const stores = createInMemoryStores();
    let swap: (() => Promise<void>) | undefined;
    const router = createFlowApiRouter({
      registry,
      stores,
      resolvePrincipal: async (context) => {
        const user = context.request?.headers.get("x-user");
        // The session check signs the caller in after reading the session:
        // that is the window in which the id changes hands.
        if (swap !== undefined && context.envelope.sessionId === "s1") {
          const run = swap;
          swap = undefined;
          await run();
        }
        return user == null ? null : { userId: user, orgId: "acme" };
      }
    });
    enablePushDelivery(router, { secret: SECRET });
    await seedSession(stores, "s1", { userId: "alice" });
    swap = async () => {
      await stores.session.delete("s1");
      await seedSession(stores, "s1", { userId: "bob" });
    };
    const { status, answer } = await mint(router, [topic.session("s1")]);
    expect(swap).toBeUndefined();
    expect(status).toBe(200);
    expect(answer.topics).toEqual([]);
  });

  it("in a mixed app, gives an anonymous caller no user or org topic", async () => {
    const registry = createFlowRegistry();
    registry.register(demoFlow("open"));
    registry.register(
      defineFlow({
        kind: "secure",
        actions: demoFlow("secure").actions,
        authentication: { resolvePrincipal: () => null }
      })()
    );
    const router = createFlowApiRouter({ registry, stores: createInMemoryStores() });
    enablePushDelivery(router, { secret: SECRET });
    const { status, answer } = await mint(router, [topic.user(), topic.org()], {});
    expect(status).toBe(200);
    expect(answer.topics).toEqual([]);
  });
});

describe("the socket session", () => {
  async function ticketFor(router: FlowApiRouter, topics: unknown[], headers = ALICE, userId = "alice") {
    const { answer } = await mint(router, topics, headers, userId);
    if (answer.transport !== "websocket") throw new Error("expected a websocket answer");
    return answer.ticket;
  }

  it("hears a notice under a granted topic, as a wire topic with no tenant, user or org id", async () => {
    const bus = createInMemoryBus();
    const { router, stores, delivery } = app({ bus });
    await seedSession(stores, "s1", { userId: "alice" });
    const ws = socket(delivery!);
    ws.send({ type: "subscribe", ticket: await ticketFor(router, [topic.session("s1"), topic.user(), topic.org()]) });
    await bus.publish({ topic: { scope: "session", id: "s1", tenantId: "", resource: "tasks" }, kind: "items", origin: { requestId: "r1" } });
    await bus.publish({ topic: { scope: "user", id: "alice", tenantId: "" }, kind: "request" });
    await bus.publish({ topic: { scope: "org", id: "acme", tenantId: "" }, kind: "run" });
    await flush();
    expect(ws.notices()).toEqual([
      { type: "notice", topic: topic.session("s1", { resource: "tasks" }), kind: "items", origin: { requestId: "r1" } },
      { type: "notice", topic: topic.user(), kind: "request" },
      { type: "notice", topic: topic.org(), kind: "run" }
    ]);
  });

  it("fills user and org topics from the verified caller: another user's or org's notices never arrive", async () => {
    const bus = createInMemoryBus();
    const { router, delivery } = app({ bus });
    const ws = socket(delivery!);
    ws.send({ type: "subscribe", ticket: await ticketFor(router, [topic.user(), topic.org()]) });
    await bus.publish({ topic: { scope: "user", id: "bob", tenantId: "" }, kind: "request" });
    await bus.publish({ topic: { scope: "org", id: "globex", tenantId: "" }, kind: "request" });
    await bus.publish({ topic: { scope: "user", id: "alice", tenantId: "t9" }, kind: "request" });
    await flush();
    expect(ws.notices()).toEqual([]);
  });

  it("hears nothing of a topic the mint dropped", async () => {
    const bus = createInMemoryBus();
    const { router, stores, delivery } = app({ bus });
    await seedSession(stores, "bobs", { userId: "bob" });
    const ws = socket(delivery!);
    ws.send({ type: "subscribe", ticket: await ticketFor(router, [topic.session("bobs")]) });
    await bus.publish({ topic: { scope: "session", id: "bobs", tenantId: "" }, kind: "items" });
    await flush();
    expect(ws.notices()).toEqual([]);
    expect(ws.closed()).toBeUndefined();
  });

  // An app on the default bus runs as one process, so push covers every
  // change and the client stops its fallback poll while the socket is open.
  it("tells a socket on the default in-memory bus that push covers it", async () => {
    const { router, delivery } = app();
    const ws = socket(delivery!);
    ws.send({ type: "subscribe", ticket: await ticketFor(router, [topic.user()]) });
    expect(ws.frames).toEqual([{ type: "subscribed" }, { type: "crossing", crosses: true }]);
    ws.end();
  });

  it("says whether its bus crosses processes after the first ticket, and on every change", async () => {
    const inner = createInMemoryBus();
    const crossingListeners = new Set<(crosses: boolean) => void>();
    let crosses = false;
    const bus: ChangeBus = {
      publish: inner.publish,
      subscribe: inner.subscribe,
      get crossesProcesses() {
        return crosses;
      },
      onCrossingChange(listener) {
        crossingListeners.add(listener);
        return () => crossingListeners.delete(listener);
      }
    };
    const { router, delivery } = app({ bus });
    const ws = socket(delivery!);
    expect(ws.frames).toEqual([]);
    ws.send({ type: "subscribe", ticket: await ticketFor(router, [topic.user()]) });
    expect(ws.frames).toEqual([{ type: "subscribed" }, { type: "crossing", crosses: false }]);
    crosses = true;
    for (const listener of crossingListeners) listener(true);
    expect(ws.frames).toEqual([
      { type: "subscribed" },
      { type: "crossing", crosses: false },
      { type: "crossing", crosses: true }
    ]);
    // A second ticket adds topics: it is acknowledged once its topics are
    // heard, and sends no second crossing frame.
    ws.send({ type: "subscribe", ticket: await ticketFor(router, [topic.org()]) });
    expect(ws.frames.slice(3)).toEqual([{ type: "subscribed" }]);
    ws.end();
    expect(crossingListeners.size).toBe(0);
  });

  it("acknowledges a ticket only after its topics are subscribed on the bus", async () => {
    const inner = createInMemoryBus();
    const order: string[] = [];
    const bus: ChangeBus = {
      ...inner,
      publish: inner.publish,
      subscribe: (busTopic, listener) => {
        order.push(`bus:${busTopic.scope}`);
        return inner.subscribe(busTopic, listener);
      },
      crossesProcesses: true,
      onCrossingChange: () => () => {}
    };
    const { router, delivery } = app({ bus });
    const frames: string[] = [];
    const session = delivery!.openSocket("alice", {
      send: (frame) => {
        order.push(`frame:${frame.type}`);
        frames.push(frame.type);
      },
      close: () => {}
    });
    session.receive(JSON.stringify({ type: "subscribe", ticket: await ticketFor(router, [topic.user()]) }));
    session.receive(JSON.stringify({ type: "subscribe", ticket: await ticketFor(router, [topic.org()]) }));
    expect(order).toEqual(["bus:user", "frame:subscribed", "frame:crossing", "bus:org", "frame:subscribed"]);
    session.closed();
  });

  it("stops hearing a topic it unsubscribes, and everything once it closes", async () => {
    const bus = createInMemoryBus();
    const { router, delivery } = app({ bus });
    const ws = socket(delivery!);
    ws.send({ type: "subscribe", ticket: await ticketFor(router, [topic.user(), topic.org()]) });
    ws.send({ type: "unsubscribe", topics: [topic.user()] });
    await bus.publish({ topic: { scope: "user", id: "alice", tenantId: "" }, kind: "request" });
    await bus.publish({ topic: { scope: "org", id: "acme", tenantId: "" }, kind: "request" });
    await flush();
    expect(ws.notices().map((frame) => frame.type === "notice" && frame.topic.scope)).toEqual(["org"]);
    ws.end();
    await bus.publish({ topic: { scope: "org", id: "acme", tenantId: "" }, kind: "request" });
    await flush();
    expect(ws.notices()).toHaveLength(1);
  });

  it("closes a socket whose ticket names another user, and logs it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { router, delivery } = app();
    const ws = socket(delivery!, "bob");
    ws.send({ type: "subscribe", ticket: await ticketFor(router, [topic.user()]) });
    expect(ws.closed()).toEqual({ code: 4401, reason: expect.any(String) });
    expect(ws.frames).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it("closes a socket whose ticket was signed with another secret, or has expired", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { delivery } = app();
    const forged = signPushTicket(
      { sub: "alice", exp: Date.now() + 30_000, topics: [{ wire: topic.user(), bus: { scope: "user", id: "alice", tenantId: "" } }] },
      "another-secret"
    );
    const a = socket(delivery!);
    a.send({ type: "subscribe", ticket: forged });
    expect(a.closed()?.code).toBe(4401);
    const expired = signPushTicket(
      { sub: "alice", exp: Date.now() - 1, topics: [{ wire: topic.user(), bus: { scope: "user", id: "alice", tenantId: "" } }] },
      SECRET
    );
    const b = socket(delivery!);
    b.send({ type: "subscribe", ticket: expired });
    expect(b.closed()?.code).toBe(4401);
  });

  it("accepts no topic named outside a ticket", () => {
    const { delivery } = app();
    const ws = socket(delivery!);
    ws.send({ type: "subscribe", topics: [topic.user()] });
    expect(ws.closed()?.code).toBe(4401);
    const other = socket(delivery!);
    other.send({ type: "unsubscribe", topics: [topic.user()] });
    expect(other.closed()?.code).toBe(4400);
  });

  it("closes a socket with no ticket within five seconds, and any socket after an hour", async () => {
    const { router, delivery } = app();
    const ticket = await ticketFor(router, [topic.user()]);
    vi.useFakeTimers();
    const silent = socket(delivery!);
    vi.advanceTimersByTime(PUSH_SOCKET_TIMINGS.ticketTimeoutMs);
    expect(silent.closed()?.code).toBe(4408);
    expect(PUSH_SOCKET_TIMINGS.ticketTimeoutMs).toBe(5_000);

    const ws = socket(delivery!);
    ws.send({ type: "subscribe", ticket });
    vi.advanceTimersByTime(PUSH_SOCKET_TIMINGS.maxAgeMs - 1);
    expect(ws.closed()).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(ws.closed()?.code).toBe(4000);
    expect(PUSH_SOCKET_TIMINGS.maxAgeMs).toBe(60 * 60_000);
  });

  it("refuses a ticket thirty seconds after it was minted", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { router, delivery } = app();
    vi.useFakeTimers({ toFake: ["Date"] });
    const ticket = await ticketFor(router, [topic.user()]);
    vi.setSystemTime(Date.now() + 30_001);
    const ws = socket(delivery!);
    ws.send({ type: "subscribe", ticket });
    expect(ws.closed()?.code).toBe(4401);
  });

  it("is reachable without a router, for a host that runs the session itself", () => {
    const frames: PushServerFrame[] = [];
    const session = openPushSocket({
      bus: createInMemoryBus(),
      secret: () => SECRET,
      userId: "alice",
      io: { send: (frame) => frames.push(frame), close: () => {} }
    });
    session.receive(
      JSON.stringify({
        type: "subscribe",
        ticket: signPushTicket(
          { sub: "alice", exp: Date.now() + 1000, topics: [{ wire: topic.user(), bus: { scope: "user", id: "alice", tenantId: "" } }] },
          SECRET
        )
      })
    );
    expect(frames).toEqual([{ type: "subscribed" }, { type: "crossing", crosses: true }]);
    session.closed();
  });
});

describe("enablePushDelivery", () => {
  it("takes the secret from a function, read when a ticket is signed and checked", async () => {
    let secret = "one";
    const registry = createFlowRegistry();
    registry.register(demoFlow());
    const router = createFlowApiRouter({ registry, stores: createInMemoryStores() });
    const delivery = enablePushDelivery(router, { secret: () => secret });
    const { answer } = await mint(router, [topic.user()], {}, "alice");
    if (answer.transport !== "websocket") throw new Error("expected websocket");
    secret = "two";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const ws = socket(delivery);
    ws.send({ type: "subscribe", ticket: answer.ticket });
    expect(ws.closed()?.code).toBe(4401);
  });

  it("keeps one key when two hosts turn push on for the same router", async () => {
    const registry = createFlowRegistry();
    registry.register(demoFlow());
    const router = createFlowApiRouter({ registry, stores: createInMemoryStores() });
    const first = enablePushDelivery(router);
    const second = enablePushDelivery(router);
    const { answer } = await mint(router, [topic.user()], {}, "alice");
    if (answer.transport !== "websocket") throw new Error("expected websocket");
    for (const delivery of [first, second]) {
      const ws = socket(delivery);
      ws.send({ type: "subscribe", ticket: answer.ticket });
      expect(ws.closed()).toBeUndefined();
      expect(ws.frames).toEqual([{ type: "subscribed" }, { type: "crossing", crosses: true }]);
    }
  });

  it("uses one random secret per router when none is given", async () => {
    const registry = createFlowRegistry();
    registry.register(demoFlow());
    const a = createFlowApiRouter({ registry, stores: createInMemoryStores() });
    const b = createFlowApiRouter({ registry, stores: createInMemoryStores() });
    enablePushDelivery(a);
    const deliveryB = enablePushDelivery(b);
    const { answer } = await mint(a, [topic.user()], {}, "alice");
    if (answer.transport !== "websocket") throw new Error("expected websocket");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const ws = socket(deliveryB);
    ws.send({ type: "subscribe", ticket: answer.ticket });
    expect(ws.closed()?.code).toBe(4401);
  });

  it("refuses a value that is not a router from createFlowApiRouter", () => {
    expect(() => enablePushDelivery({} as FlowApiRouter)).toThrow(/createFlowApiRouter/);
  });

  it("keeps the default organization for a caller of an app that authenticates nothing", async () => {
    const bus = createInMemoryBus();
    const registry = createFlowRegistry();
    registry.register(demoFlow());
    const router = createFlowApiRouter({ registry, stores: { ...createInMemoryStores(), bus } });
    const delivery = enablePushDelivery(router, { secret: SECRET });
    const { answer } = await mint(router, [topic.org()], {}, "alice");
    if (answer.transport !== "websocket") throw new Error("expected websocket");
    const ws = socket(delivery);
    ws.send({ type: "subscribe", ticket: answer.ticket });
    await bus.publish({ topic: { scope: "org", id: DEFAULT_ORG_ID, tenantId: "" }, kind: "request" });
    await flush();
    expect(ws.notices()).toHaveLength(1);
  });
});
