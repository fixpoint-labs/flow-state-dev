/**
 * The change bus (FIX-2426): who hears a notice, and the one wrapper that makes
 * every request and session write publish on its session's topic once the
 * write can be read.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import {
  createInMemoryBus,
  createInMemoryStores,
  withChangeBus,
  type BusTopic,
  type ChangeBus,
  type ChangeNotice,
  type RequestRecord,
  type SessionRecord,
  type StoreRegistry
} from "../../src";
import { resolveStores } from "../../src/routes/http-handlers";
import { storeIdentity } from "../../src/bus/publish-writes";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function sessionTopic(id: string, tenantId = ""): BusTopic {
  return { scope: "session", id, tenantId };
}

/** Every notice `bus` delivers on `topic`, in order. */
function hear(bus: ChangeBus, topic: BusTopic): ChangeNotice[] {
  const heard: ChangeNotice[] = [];
  bus.subscribe(topic, (notice) => heard.push(notice));
  return heard;
}

function session(id: string, extra: Partial<SessionRecord> = {}): SessionRecord {
  const now = Date.now();
  return {
    orgId: DEFAULT_ORG_ID,
    id,
    flowKind: "chat",
    userId: "alice",
    state: {},
    version: 0,
    createdAt: now,
    updatedAt: now,
    journal: [],
    ...extra
  } as SessionRecord;
}

function request(id: string, sessionId: string, extra: Partial<RequestRecord> = {}): RequestRecord {
  const now = Date.now();
  return {
    id,
    sessionId,
    flowKind: "chat",
    actionName: "say",
    userId: "alice",
    orgId: DEFAULT_ORG_ID,
    source: "http",
    status: "in_progress",
    startedAtMs: now,
    state: {},
    version: 0,
    createdAt: now,
    updatedAt: now,
    ...extra
  } as unknown as RequestRecord;
}

function message(requestId: string, id: string) {
  return {
    id,
    type: "message",
    status: "completed",
    requestId,
    itemIndex: 0,
    ts: Date.now(),
    role: "assistant",
    content: [{ type: "output_text", text: "hello" }],
    provenance: { blockName: "say", blockInstanceId: `${requestId}:root:0`, phase: "main" }
  } as never;
}

describe("the in-memory bus", () => {
  it("never says it crosses processes", () => {
    expect(createInMemoryBus().crossesProcesses).toBe(false);
  });

  it("delivers a scope's narrowed notices to its unnarrowed subscribers, with the narrowed topic", async () => {
    const bus = createInMemoryBus();
    const whole = hear(bus, sessionTopic("s1"));
    const tasks = hear(bus, { ...sessionTopic("s1"), resource: "tasks" });
    const plan = hear(bus, { ...sessionTopic("s1"), resource: "plan" });

    await bus.publish({ topic: { ...sessionTopic("s1"), resource: "tasks" }, kind: "items" });
    await bus.publish({ topic: sessionTopic("s1"), kind: "request" });
    await tick();

    expect(whole.map((n) => [n.topic.resource, n.kind])).toEqual([["tasks", "items"], [undefined, "request"]]);
    // A narrowed subscriber hears only its own resource, never the bare scope.
    expect(tasks.map((n) => n.kind)).toEqual(["items"]);
    expect(plan).toEqual([]);
  });

  it("keeps tenants, scopes and ids apart", async () => {
    const bus = createInMemoryBus();
    const mine = hear(bus, sessionTopic("s1", "t1"));
    await bus.publish({ topic: sessionTopic("s1", "t2"), kind: "items" });
    await bus.publish({ topic: sessionTopic("s2", "t1"), kind: "items" });
    await bus.publish({ topic: { scope: "user", id: "s1", tenantId: "t1" }, kind: "items" });
    await tick();
    expect(mine).toEqual([]);
  });

  it("stops delivering once unsubscribed, even a notice already queued", async () => {
    const bus = createInMemoryBus();
    const heard: ChangeNotice[] = [];
    const stop = bus.subscribe(sessionTopic("s1"), (n) => heard.push(n));
    void bus.publish({ topic: sessionTopic("s1"), kind: "items" });
    stop();
    await tick();
    expect(heard).toEqual([]);
  });
});

describe("withChangeBus · every request and session write publishes its session's topic", () => {
  function wired(): { stores: StoreRegistry & { bus: ChangeBus }; bus: ChangeBus } {
    const bus = createInMemoryBus();
    return { stores: withChangeBus({ ...createInMemoryStores(), bus }), bus };
  }

  it("publishes a request's write only once a read sees it", async () => {
    const { stores, bus } = wired();
    const seen: Array<string | undefined> = [];
    // A listener that reads on the notice, as a view does: it must find the write.
    bus.subscribe(sessionTopic("s1"), () => {
      void stores.request.get("r1").then((record) => seen.push(record?.status));
    });
    await stores.request.set("r1", request("r1", "s1"), "any");
    await tick();
    await tick();
    expect(seen).toEqual(["in_progress"]);
  });

  it("publishes `items` once a request's persisted items can be read", async () => {
    const { stores, bus } = wired();
    await stores.request.set("r1", request("r1", "s1"), "any");
    await tick();
    const counts: number[] = [];
    const kinds: string[] = [];
    bus.subscribe(sessionTopic("s1"), (n) => {
      kinds.push(n.kind);
      void stores.request.countItems("r1").then((c) => counts.push(c));
    });
    stores.request.persistItems("r1", [message("r1", "m1")]);
    await tick();
    await tick();
    expect(kinds).toEqual(["items"]);
    expect(counts).toEqual([1]);
  });

  it("publishes on every write method, and not on persistEvents", async () => {
    const { stores, bus } = wired();
    await stores.session.set("s1", session("s1"), "any");
    await stores.request.set("r1", request("r1", "s1"), "any");
    await tick();
    const heard = hear(bus, sessionTopic("s1"));

    const writes: Array<[string, () => Promise<unknown>]> = [
      ["session.set", () => stores.session.set("s1", session("s1", { version: 1 }), "any")],
      ["session.patchField", () => stores.session.patchField!("s1", ["a"], 1, "any", Date.now())],
      ["session.incField", () => stores.session.incField!("s1", ["n"], 1, "any", Date.now())],
      ["session.pushToArray", () => stores.session.pushToArray!("s1", ["xs"], [1], "any", Date.now())],
      ["session.deleteField", () => stores.session.deleteField!("s1", ["a"], "any", Date.now())],
      ["request.set", () => stores.request.set("r1", request("r1", "s1", { version: 1 }), "any")],
      ["request.patchField", () => stores.request.patchField!("r1", ["a"], 1, "any", Date.now())],
      ["request.incField", () => stores.request.incField!("r1", ["n"], 1, "any", Date.now())],
      ["request.pushToArray", () => stores.request.pushToArray!("r1", ["xs"], [1], "any", Date.now())],
      ["request.deleteField", () => stores.request.deleteField!("r1", ["a"], "any", Date.now())],
      ["request.setFieldsIfStatus", () => stores.request.setFieldsIfStatus("r1", { abortRequested: true }, ["in_progress"], Date.now())],
      [
        "request.deleteIfStatus",
        async () => {
          await stores.request.set("r2", request("r2", "s1", { status: "completed" }), "any");
          await tick();
          heard.length = 0;
          return stores.request.deleteIfStatus("r2", ["completed"]);
        }
      ],
      ["request.delete", () => stores.request.delete("r1")],
      ["session.delete", () => stores.session.delete("s1")]
    ];

    // The delta verbs are optional on a store; the in-memory request store
    // leaves some off. Each one a store has must publish.
    const has = (name: string): boolean => {
      const [store, method] = name.split(".") as ["session" | "request", string];
      return typeof (stores[store] as unknown as Record<string, unknown>)[method] === "function";
    };
    expect(writes.filter(([name]) => has(name)).length).toBeGreaterThanOrEqual(11);
    for (const [name, write] of writes) {
      if (!has(name)) continue;
      heard.length = 0;
      await write();
      await tick();
      await tick();
      expect(heard.length, name).toBeGreaterThan(0);
    }

    await stores.request.set("r3", request("r3", "s1"), "any");
    await tick();
    heard.length = 0;
    stores.request.persistEvents("r3", [{ seq: 1, type: "noop" } as never]);
    await stores.request.flushEvents("r3");
    await tick();
    expect(heard).toEqual([]);
  });

  it("publishes nothing for a write that did not land", async () => {
    const { stores, bus } = wired();
    await stores.session.set("s1", session("s1"), "any");
    await stores.request.set("r1", request("r1", "s1", { status: "completed" }), "any");
    await tick();
    const heard = hear(bus, sessionTopic("s1"));

    // A version conflict, and a status predicate that fails.
    const conflict = await stores.session.set("s1", session("s1", { version: 9 }), 5);
    expect(conflict.ok).toBe(false);
    const refused = await stores.request.setFieldsIfStatus("r1", { abortRequested: true }, ["in_progress"], Date.now());
    expect(refused.applied).toBe(false);
    await tick();
    await tick();
    expect(heard).toEqual([]);
  });

  it("names the parent's topic for a run's writes, so the parent's view sees its runs move", async () => {
    const { stores, bus } = wired();
    const parent = hear(bus, sessionTopic("s1"));
    const child = hear(bus, sessionTopic("run_a"));
    await stores.session.set("run_a", session("run_a", { parentSessionId: "s1" }), "any");
    await tick();
    expect(parent.map((n) => n.kind)).toEqual(["run"]);
    expect(child.map((n) => n.kind)).toEqual(["run"]);

    parent.length = 0;
    await stores.request.set("run_a_req", request("run_a_req", "run_a"), "any");
    await tick();
    await tick();
    expect(parent.map((n) => n.kind)).toEqual(["run"]);
    expect(child.map((n) => n.kind)).toContain("request");
  });

  it("publishes under the record's tenant, by the bare session id", async () => {
    const { stores, bus } = wired();
    const t1 = hear(bus, sessionTopic("s1", "t1"));
    const untenanted = hear(bus, sessionTopic("s1"));
    await stores.session.set("t1:s1", session("t1:s1", { tenantId: "t1" }), "any");
    await stores.request.set("r1", request("r1", "s1", { tenantId: "t1" }), "any");
    await tick();
    await tick();
    expect(t1.map((n) => n.kind).sort()).toEqual(["request", "run"]);
    expect(untenanted).toEqual([]);
  });

  it("never fails a write when the bus fails to publish", async () => {
    const failing: ChangeBus = {
      crossesProcesses: false,
      publish: () => Promise.reject(new Error("bus down")),
      subscribe: () => () => {},
      onCrossingChange: () => () => {}
    };
    const stores = withChangeBus({ ...createInMemoryStores(), bus: failing });
    await expect(stores.request.set("r1", request("r1", "s1"), "any")).resolves.toMatchObject({ ok: true });
    await tick();
  });

  it("folds one topic's notices of a kind raised in one turn into one", async () => {
    const { stores, bus } = wired();
    await stores.request.set("r1", request("r1", "s1"), "any");
    await tick();
    const heard = hear(bus, sessionTopic("s1"));
    for (let i = 0; i < 5; i += 1) stores.request.persistItems("r1", [message("r1", `m${i}`)]);
    await tick();
    await tick();
    expect(heard.map((n) => n.kind)).toEqual(["items"]);
  });
});

describe("withChangeBus · applied at every entry, once", () => {
  it("hands every entry the same store objects, so per-store bookkeeping keyed by identity stays one", () => {
    const raw = createInMemoryStores();
    const first = withChangeBus(raw);
    const again = withChangeBus(raw);
    const viaResolve = resolveStores(raw);
    const ofTheWrapped = withChangeBus(first);
    for (const other of [again, viaResolve, ofTheWrapped]) {
      expect(other.request).toBe(first.request);
      expect(other.session).toBe(first.session);
    }
    // A registry this returned comes back as it is.
    expect(ofTheWrapped).toBe(first);
    // A caller still holding the raw store counts as the same store, so
    // bookkeeping keyed by identity (live attempts of a request) stays one.
    expect(storeIdentity(first.request)).toBe(storeIdentity(raw.request));
    expect(storeIdentity(first.session)).toBe(raw.session);
  });

  it("publishes once however many entries wrap the same stores", async () => {
    const raw = createInMemoryStores();
    const first = withChangeBus(raw);
    const again = withChangeBus(raw);
    const viaResolve = resolveStores(raw);
    // A raw registry with no bus finds the bus its stores already publish to.
    expect(again.bus).toBe(first.bus);
    expect(viaResolve.bus).toBe(first.bus);

    const heard = hear(first.bus, sessionTopic("s1"));
    await viaResolve.request.set("r1", request("r1", "s1"), "any");
    await tick();
    await tick();
    expect(heard.map((n) => n.kind)).toEqual(["request"]);
  });

  it("makes a raw registry's writes reach the host's bus when they share stores", async () => {
    const bus = createInMemoryBus();
    const raw = createInMemoryStores();
    // The host resolves the stores with its bus; a worker handed the raw
    // registry later (runAction, a job processor) wraps it again.
    resolveStores({ ...raw, bus });
    const worker = withChangeBus(raw);
    expect(worker.bus).toBe(bus);
    const heard = hear(bus, sessionTopic("s1"));
    await worker.request.set("r1", request("r1", "s1"), "any");
    await tick();
    await tick();
    expect(heard.map((n) => n.kind)).toEqual(["request"]);
  });
});
