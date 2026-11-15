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
 * admission refuses answers nothing and never names its topic; a `read` that
 * answers nothing is heard on the caller's own user topic alone.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DEFAULT_ORG_ID, defineFlow, defineView, handler } from "@flow-state-dev/core";
import { requestHostOf } from "@flow-state-dev/core/internal";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { runAction } from "../src";
import { createInMemoryStores } from "../src/host";
import { runView } from "../src/execution/runView";
import type { SessionRecord, StoreRegistry } from "../src/stores/types";

const ORG = DEFAULT_ORG_ID;

const out = z.any().nullable().describe("answer");
const host = (ctx: unknown) => requestHostOf(ctx as never)!.sessions!;

function app(): FlowInstance {
  return defineFlow({
    kind: "desk",
    session: { stateSchema: z.object({ workerId: z.string().readonly().optional(), notes: z.string().optional() }) },
    actions: { touch: { block: handler({ name: "touch", inputSchema: z.object({}), execute: () => ({ ok: true }) }) } },
    views: {
      list: defineView({
        scope: "user",
        block: handler({
          name: "list",
          inputSchema: z.object({ limit: z.number().optional(), fields: z.record(z.string()).optional() }),
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
      orgList: defineView({
        scope: "org",
        block: handler({ name: "org-list", inputSchema: z.object({}), outputSchema: out, execute: async (_input, ctx) => host(ctx).list() })
      })
    }
  })() as unknown as FlowInstance;
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
      state: { workerId: "otto", notes: "private" },
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
  it("answers the caller's own top-level sessions, newest first, with readonly state only, heard on their user topic's run", async () => {
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
    expect(list.sessions[0]!.state).toEqual({ workerId: "otto" });
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

  it("filters by readonly fields at the store, and refuses a field the flow doesn't declare readonly", async () => {
    const stores = createInMemoryStores();
    const flow = app();
    await seed(stores, "otto1", { state: { workerId: "otto" } });
    await seed(stores, "ada1", { state: { workerId: "ada" } });
    const list = (await view(stores, flow, "list", { fields: { workerId: "ada" } })).output as { sessions: Array<{ id: string }> };
    expect(list.sessions.map((session) => session.id)).toEqual(["ada1"]);
    await expect(view(stores, flow, "list", { fields: { notes: "private" } })).rejects.toThrow(/only readonly state fields/);
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

describe("sessions.turns in a view", () => {
  it("answers a session's requests by status, never their words, heard on its request notices only", async () => {
    const stores = createInMemoryStores();
    const flow = app();
    await act(stores, flow, "mine");
    const answer = await view(stores, flow, "turns", { ids: ["mine"] });
    const turns = answer.output as Array<Record<string, unknown>>;
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ sessionId: "mine", action: "touch", status: "completed" });
    expect(Object.keys(turns[0]!).sort()).toEqual(["action", "completedAtMs", "id", "sessionId", "source", "startedAtMs", "status", "updatedAt"]);
    expect(answer.hears).toEqual([{ topic: { scope: "session", id: "mine" }, kinds: ["request"] }]);
  });

  it("answers another user's session as a missing one, and records nothing for it", async () => {
    const stores = createInMemoryStores();
    const flow = app();
    await act(stores, flow, "bobs", "bob");
    const one = await view(stores, flow, "turns", { ids: ["bobs"] });
    expect(one.output).toBeUndefined();
    expect(one.hears).toEqual([]);
    await act(stores, flow, "mine");
    const many = await view(stores, flow, "turns", { ids: ["bobs", "mine"] });
    expect((many.output as Array<{ sessionId: string }>).map((turn) => turn.sessionId)).toEqual(["mine"]);
    expect(many.hears).toEqual([{ topic: { scope: "session", id: "mine" }, kinds: ["request"] }]);
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

describe("sessions.read in a user view", () => {
  it("answers the caller's session and hears its identity on run alone, its state once read", async () => {
    const stores = createInMemoryStores();
    const flow = app();
    await seed(stores, "mine");
    const identity = await view(stores, flow, "identity", { id: "mine" });
    expect(identity.output).toEqual({ flowKind: "desk" });
    expect(identity.hears).toEqual([{ topic: { scope: "session", id: "mine" }, kinds: ["run"] }]);
    const withState = await view(stores, flow, "identity", { id: "mine", withState: true });
    expect(withState.output).toEqual({ flowKind: "desk", state: { workerId: "otto" } });
    expect(withState.hears).toEqual([{ topic: { scope: "session", id: "mine" }, kinds: ["run", "state"] }]);
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
