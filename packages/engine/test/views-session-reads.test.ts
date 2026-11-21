// FIX-2725 D1.
/**
 * A view reads the caller's sessions: lists them, reads their turns, and
 * reads one's flow and lineage.
 *
 * Why it matters: a screen of a user's sessions is only live if each read is
 * heard on the notice that changes it, and only quiet if it is heard on no
 * other. A list hears its user topic's `run`; a session's turns its
 * `request`; a session's identity its `run`; none hears `items`, which a
 * reply publishes once per stored chunk. And a view answers only the caller's
 * own sessions, as the HTTP list would: what the owner rule or the view's
 * admission refuses answers nothing and never names its topic; a one-session
 * `read`, `turns` or `history` that answers nothing is heard on the caller's
 * own user topic alone.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DEFAULT_ORG_ID, defineFlow, defineView, handler } from "@flow-state-dev/core";
import { requestHostOf } from "@flow-state-dev/core/internal";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { runAction } from "../src";
import { createInMemoryStores } from "../src/host";
import { runView } from "../src/execution/runView";
import { createFlowRegistry } from "../src";
import { toClientSession } from "../src/routes/client-session";
import type { SessionRecord, StoreRegistry } from "../src/stores/types";

const ORG = DEFAULT_ORG_ID;

const out = z.any().nullable().describe("answer");
const host = (ctx: unknown) => requestHostOf(ctx as never)!.sessions!;

/**
 * The desk flow: its own singleton, or, as `collection`, the member of a
 * collection of kind "desk" whose instance id is also "desk".
 */
function app(cardinality: "singleton" | "collection" = "singleton"): FlowInstance {
  const definition = defineFlow({
    kind: "desk",
    ...(cardinality === "collection" ? { cardinality: "collection" as const } : {}),
    session: {
      stateSchema: z.object({ workerId: z.string().readonly().optional(), project: z.string().optional(), notes: z.string().optional() }),
      // A server-written, changeable field the HTTP session list shows the caller.
      client: { expose: ["project"] }
    },
    actions: { touch: { block: handler({ name: "touch", inputSchema: z.object({}), execute: () => ({ ok: true }) }) } },
    views: {
      list: defineView({
        scope: "user",
        block: handler({
          name: "list",
          inputSchema: z.object({ limit: z.number().optional(), offset: z.number().optional(), fields: z.record(z.string()).optional() }),
          outputSchema: out,
          execute: async (input, ctx) => host(ctx).list({ flowKind: "desk", ...input })
        })
      }),
      turns: defineView({
        scope: "user",
        block: handler({
          name: "turns",
          inputSchema: z.object({
            ids: z.array(z.string()),
            status: z.array(z.string()).optional(),
            actions: z.array(z.string()).optional(),
            limit: z.number().optional()
          }),
          outputSchema: out,
          execute: async (input, ctx) =>
            host(ctx).turns(input.ids.length === 1 ? input.ids[0]! : input.ids, {
              ...(input.status !== undefined ? { status: input.status as never } : {}),
              ...(input.actions !== undefined ? { actions: input.actions } : {}),
              ...(input.limit !== undefined ? { limit: input.limit } : {})
            })
        })
      }),
      identity: defineView({
        scope: "user",
        block: handler({
          name: "identity",
          inputSchema: z.object({ id: z.string(), withState: z.boolean().optional() }),
          outputSchema: out,
          execute: async (input, ctx) => {
            const read = await host(ctx).read(input.id);
            if (read === undefined) return null;
            return input.withState === true ? { flowKind: read.flowKind, state: read.state } : { flowKind: read.flowKind };
          }
        })
      }),
      history: defineView({
        scope: "user",
        block: handler({
          name: "history",
          inputSchema: z.object({ id: z.string() }),
          outputSchema: out,
          execute: async (input, ctx) => {
            const read = await host(ctx).history(input.id);
            return read === undefined ? null : { turns: read.turns.length };
          }
        })
      }),
      orgList: defineView({
        scope: "org",
        block: handler({ name: "org-list", inputSchema: z.object({}), outputSchema: out, execute: async (_input, ctx) => host(ctx).list() })
      })
    }
  });
  return (cardinality === "collection" ? (definition as never as (o: { id: string }) => unknown)({ id: "desk" }) : definition()) as unknown as FlowInstance;
}

async function seed(stores: StoreRegistry, id: string, over: Partial<SessionRecord> = {}) {
  await stores.session.set(
    id,
    {
      id,
      orgId: ORG,
      flowKind: "desk",
      flowId: "desk",
      userId: "alice",
      state: { workerId: "otto", project: "apollo", notes: "private" },
      version: 0,
      createdAt: 1,
      updatedAt: Number(over.updatedAt ?? 1),
      journal: [],
      lineageId: `lin_${id}`,
      ...over
    } as SessionRecord,
    "any"
  );
}

async function act(stores: StoreRegistry, flow: FlowInstance, sessionId: string, userId = "alice") {
  const result = await runAction({ orgId: ORG, flow, actionName: "touch" as never, input: {} as never, userId, sessionId, stores, runtimeConfig: {} });
  if (result.error !== undefined) throw result.error;
}

const view = (stores: StoreRegistry, flow: FlowInstance, viewName: string, input: unknown, extra: Record<string, unknown> = {}) =>
  runView({ flow, viewName, input, userId: "alice", orgId: ORG, stores, ...extra });

describe("sessions.list in a view", () => {
  it("answers the caller's own top-level sessions, newest first, with the state the HTTP list shows them, heard on their user topic's run", async () => {
    const stores = createInMemoryStores();
    const flow = app();
    await seed(stores, "old", { updatedAt: 10 });
    await seed(stores, "new", { updatedAt: 20 });
    await seed(stores, "child", { updatedAt: 30, parentSessionId: "new" });
    await seed(stores, "bobs", { updatedAt: 40, userId: "bob" });
    await seed(stores, "elsewhere", { updatedAt: 50, orgId: "org_2" });
    await seed(stores, "fsd-write.desk.x", { updatedAt: 60 });
    const answer = await view(stores, flow, "list", {});
    const list = answer.output as { sessions: Array<{ id: string; state: unknown; lineageId: string }>; more: boolean };
    expect(list.sessions.map((session) => session.id)).toEqual(["new", "old"]);
    // FIX-2754: readonly and exposed fields, as the HTTP list shows the same
    // caller, so a screen labels a row from the one read; never a private field.
    expect(list.sessions[0]!.state).toEqual({ workerId: "otto", project: "apollo" });
    expect(list.more).toBe(false);
    expect(answer.hears).toEqual([{ topic: { scope: "user" }, kinds: ["run"] }]);
  });

  it("is heard on its user topic even when it answers nothing, so a first session reaches it", async () => {
    const stores = createInMemoryStores();
    const answer = await view(stores, app(), "list", {});
    expect((answer.output as { sessions: unknown[] }).sessions).toEqual([]);
    expect(answer.hears).toEqual([{ topic: { scope: "user" }, kinds: ["run"] }]);
  });

  it("answers at most 100 rows, and says more matched", async () => {
    const stores = createInMemoryStores();
    for (let at = 0; at < 102; at += 1) await seed(stores, `s${at}`, { updatedAt: at });
    const list = (await view(stores, app(), "list", { limit: 500 })).output as { sessions: unknown[]; more: boolean };
    expect(list.sessions).toHaveLength(100);
    expect(list.more).toBe(true);
  });

  it("pages past the newest rows with an offset, so a caller can read on to older sessions", async () => {
    const stores = createInMemoryStores();
    for (let at = 0; at < 5; at += 1) await seed(stores, `s${at}`, { updatedAt: at });
    const first = (await view(stores, app(), "list", { limit: 2 })).output as { sessions: Array<{ id: string }>; more: boolean };
    const next = (await view(stores, app(), "list", { limit: 2, offset: 2 })).output as { sessions: Array<{ id: string }>; more: boolean };
    const last = (await view(stores, app(), "list", { limit: 2, offset: 4 })).output as { sessions: Array<{ id: string }>; more: boolean };
    expect([first, next, last].map((page) => [page.sessions.map((session) => session.id), page.more])).toEqual([
      [["s4", "s3"], true],
      [["s2", "s1"], true],
      [["s0"], false]
    ]);
  });

  it("filters by readonly fields at the store, and refuses a field the flow doesn't declare readonly", async () => {
    const stores = createInMemoryStores();
    const flow = app();
    await seed(stores, "otto1", { state: { workerId: "otto" } });
    await seed(stores, "ada1", { state: { workerId: "ada" } });
    const list = (await view(stores, flow, "list", { fields: { workerId: "ada" } })).output as { sessions: Array<{ id: string }> };
    expect(list.sessions.map((session) => session.id)).toEqual(["ada1"]);
    await expect(view(stores, flow, "list", { fields: { notes: "private" } })).rejects.toThrow(/only readonly state fields/);
  });

  it("refuses a filter on an exposed field: the list shows it, but a filter is trusted and takes readonly fields only", async () => {
    // FIX-2754: an exposed field is display data; filtering on it would let a
    // caller pick sessions by a field that changes after the session is made.
    const stores = createInMemoryStores();
    await seed(stores, "mine");
    await expect(view(stores, app(), "list", { fields: { project: "apollo" } })).rejects.toThrow(/only readonly state fields/);
  });

  it("answers only what the view's admission lets through", async () => {
    const stores = createInMemoryStores();
    await seed(stores, "kept", { updatedAt: 2 });
    await seed(stores, "refused", { updatedAt: 3 });
    const answer = await view(stores, app(), "list", {}, { admitSession: async (session: SessionRecord) => session.id !== "refused" });
    expect((answer.output as { sessions: Array<{ id: string }> }).sessions.map((session) => session.id)).toEqual(["kept"]);
  });

  it("is refused in an org view, which reads no session", async () => {
    await expect(view(createInMemoryStores(), app(), "orgList", {})).rejects.toMatchObject({ name: "NoSessionError" });
  });
});

// FIX-2754.
describe("a session whose owner the HTTP list can't attribute", () => {
  it("answers it with the state the HTTP list shows: none, when the row predates instance ownership and its kind is now a collection", async () => {
    // Why it matters: the HTTP list refuses to name an owner for this row
    // (it needs the owner migration), so it shows none of its state. A view
    // that took the collection member whose id equals the kind as its owner
    // would show a caller exposed fields the HTTP list withholds.
    const stores = createInMemoryStores();
    const flow = app("collection");
    await seed(stores, "legacy", { flowId: undefined });
    const registry = createFlowRegistry();
    registry.register(flow);
    const http = toClientSession(registry, (await stores.session.get("legacy"))!, "legacy");
    expect(http.state).toEqual({});
    const list = (await view(stores, flow, "list", {})).output as { sessions: Array<{ id: string; state: unknown }> };
    expect(list.sessions.map((session) => [session.id, session.state])).toEqual([["legacy", http.state]]);
    const read = await view(stores, flow, "identity", { id: "legacy", withState: true });
    expect(read.output).toEqual({ flowKind: "desk", state: {} });
  });
});

describe("sessions.turns in a view", () => {
  it("answers a session's requests by status, never their words, heard on its request notices and its delete or recreate, never items", async () => {
    const stores = createInMemoryStores();
    const flow = app();
    await act(stores, flow, "mine");
    const answer = await view(stores, flow, "turns", { ids: ["mine"] });
    const turns = answer.output as Array<Record<string, unknown>>;
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ sessionId: "mine", action: "touch", status: "completed" });
    expect(Object.keys(turns[0]!).sort()).toEqual(["action", "completedAtMs", "endedAtMs", "id", "retryable", "sessionId", "source", "startedAtMs", "status", "updatedAt"]);
    expect(turns[0]!.endedAtMs).toBe(turns[0]!.completedAtMs);
    expect(answer.hears).toEqual([{ topic: { scope: "session", id: "mine" }, kinds: ["request", "state"] }]);
  });

  // FIX-2771: a failed turn stamps `failedAtMs`, never `completedAtMs`; when it ended is still read.
  it("answers when a failed turn ended, which a failed turn's record keeps apart from completedAtMs", async () => {
    const stores = createInMemoryStores();
    const flow = app();
    await act(stores, flow, "mine");
    const [record] = await stores.request.list({ sessionId: "mine" });
    const { completedAtMs: _completed, ...rest } = record!;
    await stores.request.set(record!.id, { ...rest, status: "failed", failedAtMs: record!.startedAtMs + 5_000 } as never, "any");
    const [turn] = (await view(stores, flow, "turns", { ids: ["mine"] })).output as Array<Record<string, unknown>>;
    expect(turn).toMatchObject({ status: "failed", startedAtMs: record!.startedAtMs, endedAtMs: record!.startedAtMs + 5_000 });
    expect(turn!.completedAtMs).toBeUndefined();
  });

  it("answers where a turn's history window began, once earlier turns left it, so a screen can draw the divider", async () => {
    const stores = createInMemoryStores();
    const flow = app();
    await act(stores, flow, "mine");
    await act(stores, flow, "mine");
    const [first, second] = (await stores.request.list({ sessionId: "mine" })).sort((a, b) => a.startedAtMs - b.startedAtMs);
    // The engine records the mark when it opens the window: here, the second turn's started at the first.
    await stores.request.set(second!.id, { ...second!, historyStart: { requestId: first!.id } }, "any");
    const turns = (await view(stores, flow, "turns", { ids: ["mine"] })).output as Array<{ id: string; historyStart?: unknown }>;
    expect(turns.find((turn) => turn.id === second!.id)?.historyStart).toEqual({ requestId: first!.id });
    // A turn whose window held every turn before it has no mark.
    expect(turns.find((turn) => turn.id === first!.id)).not.toHaveProperty("historyStart");
  });

  it("answers another user's, a refused or a missing session as missing, heard on the caller's own user topic alone", async () => {
    // As `read`: a session made later under the id publishes `run` on the
    // caller's user topic, so a single-session view wakes; the id's own topic
    // is never named.
    const stores = createInMemoryStores();
    const flow = app();
    const own = [{ topic: { scope: "user" }, kinds: ["run"] }];
    await act(stores, flow, "bobs", "bob");
    const one = await view(stores, flow, "turns", { ids: ["bobs"] });
    expect(one.output).toBeUndefined();
    expect(one.hears).toEqual(own);
    const missing = await view(stores, flow, "turns", { ids: ["nobody"] });
    expect(missing.output).toBeUndefined();
    expect(missing.hears).toEqual(own);
    await act(stores, flow, "refused");
    const refused = await view(stores, flow, "turns", { ids: ["refused"] }, { admitSession: async () => false });
    expect(refused.output).toBeUndefined();
    expect(refused.hears).toEqual(own);
    await act(stores, flow, "mine");
    const many = await view(stores, flow, "turns", { ids: ["bobs", "mine"] });
    expect((many.output as Array<{ sessionId: string }>).map((turn) => turn.sessionId)).toEqual(["mine"]);
    // A batch with a member it doesn't answer is heard on the user topic too,
    // so that member, made later, wakes the view; its own topic never.
    expect(many.hears).toEqual([{ topic: { scope: "session", id: "mine" }, kinds: ["request", "state"] }, ...own]);
    const none = await view(stores, flow, "turns", { ids: ["bobs", "nobody"] });
    expect(none.output).toEqual([]);
    expect(none.hears).toEqual(own);
    const all = await view(stores, flow, "turns", { ids: ["mine"], status: ["completed"] });
    expect(all.hears).toEqual([{ topic: { scope: "session", id: "mine" }, kinds: ["request", "state"] }]);
  });

  it("filters by status at the store and by action", async () => {
    const stores = createInMemoryStores();
    const flow = app();
    await act(stores, flow, "mine");
    expect((await view(stores, flow, "turns", { ids: ["mine"], status: ["in_progress"] })).output).toEqual([]);
    expect((await view(stores, flow, "turns", { ids: ["mine"], actions: ["respond"] })).output).toEqual([]);
    expect((await view(stores, flow, "turns", { ids: ["mine"], actions: ["touch"] })).output).toHaveLength(1);
  });

  it("bounds each session on its own, so a busy session's newer requests never hide a quiet one's", async () => {
    // A worker's sessions are read at once: a reply running in the quiet
    // session must still answer when another session has more newer requests
    // than the limit, or the list reports that conversation as idle.
    const stores = createInMemoryStores();
    const flow = app();
    await act(stores, flow, "quiet");
    for (let at = 0; at < 3; at += 1) await act(stores, flow, "busy");
    const turns = (await view(stores, flow, "turns", { ids: ["busy", "quiet"], limit: 1 })).output as Array<{ sessionId: string }>;
    expect(turns.map((turn) => turn.sessionId).sort()).toEqual(["busy", "quiet"]);
  });

  it("answers at most 50 a session", async () => {
    const stores = createInMemoryStores();
    const flow = app();
    for (let at = 0; at < 52; at += 1) await act(stores, flow, "mine");
    expect((await view(stores, flow, "turns", { ids: ["mine"] })).output).toHaveLength(50);
  });
});

describe("sessions.history in a user view", () => {
  it("is heard on the session it answers, and on the caller's own user topic alone for one it doesn't", async () => {
    const stores = createInMemoryStores();
    const flow = app();
    await act(stores, flow, "mine");
    await act(stores, flow, "bobs", "bob");
    const answered = await view(stores, flow, "history", { id: "mine" });
    expect(answered.output).not.toBeNull();
    expect(answered.topics).toEqual([{ scope: "session", id: "mine" }]);
    const own = [{ topic: { scope: "user" }, kinds: ["run"] }];
    for (const [id, extra] of [["bobs", {}], ["nobody", {}], ["mine", { admitSession: async () => false }]] as const) {
      const answer = await view(stores, flow, "history", { id }, extra);
      expect(answer.output, id).toBeNull();
      expect(answer.hears, id).toEqual(own);
    }
  });
});

describe("sessions.read in a user view", () => {
  it("answers readonly state only, never an exposed field, though the list shows one", async () => {
    // FIX-2754: a block reading a peer session decides on server-written,
    // fixed fields; an exposed field is display data the list carries.
    const stores = createInMemoryStores();
    await seed(stores, "mine");
    const read = await view(stores, app(), "identity", { id: "mine", withState: true });
    expect(read.output).toEqual({ flowKind: "desk", state: { workerId: "otto" } });
  });

  it("answers the caller's session and hears its identity on state alone (its birth and its delete), never a turn's run", async () => {
    const stores = createInMemoryStores();
    const flow = app();
    await seed(stores, "mine");
    const identity = await view(stores, flow, "identity", { id: "mine" });
    expect(identity.output).toEqual({ flowKind: "desk" });
    // A turn starting or ending publishes `run` on the session, and changes neither its flow nor its lineage.
    expect(identity.hears).toEqual([{ topic: { scope: "session", id: "mine" }, kinds: ["state"] }]);
    const withState = await view(stores, flow, "identity", { id: "mine", withState: true });
    expect(withState.output).toEqual({ flowKind: "desk", state: { workerId: "otto" } });
    expect(withState.hears).toEqual([{ topic: { scope: "session", id: "mine" }, kinds: ["state"] }]);
  });

  it("answers nothing for a refused or missing session, heard on the caller's own user topic alone, alike", async () => {
    // A session made later under the id publishes `run` there, so the view
    // wakes; the session's own topic, which the caller can't be shown is
    // theirs, is never named, and a refusal reads as a missing session.
    const stores = createInMemoryStores();
    await seed(stores, "mine");
    await seed(stores, "bobs", { userId: "bob" });
    const own = [{ topic: { scope: "user" }, kinds: ["run"] }];
    const refused = await view(stores, app(), "identity", { id: "mine" }, { admitSession: async () => false });
    expect(refused.output).toBeNull();
    expect(refused.hears).toEqual(own);
    const others = await view(stores, app(), "identity", { id: "bobs" });
    expect(others.output).toBeNull();
    expect(others.hears).toEqual(own);
    const missing = await view(stores, app(), "identity", { id: "nobody" });
    expect(missing.output).toBeNull();
    expect(missing.hears).toEqual(own);
  });
});
