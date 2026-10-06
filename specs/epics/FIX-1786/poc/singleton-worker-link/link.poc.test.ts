/**
 * FIX-1786 end-state POC · can a singleton `agent` flow run a user's worker on
 * TODAY's Layer 1? Experimental evidence, not a maintained test: run it with
 * `run.sh`, which copies it into packages/orchestration/test for the run.
 *
 * Everything runs on the real engine: `createFlowState` with in-memory stores,
 * the real `/api/flows` router for the caller's own create, `runAction` for
 * admitted requests, the real in-process dispatcher for the board's children.
 * Nothing in the scope or store layer is stubbed.
 *
 * Three link shapes, one flow factory:
 *   "state"  the worker link lives in session state, checked by a user-scoped read
 *   "record" the link lives in a user-scoped row only flow code writes,
 *            keyed by session id; session state is never consulted for it
 *   "naive"  the CONTROL: link in session state, workers in org scope (the
 *            org-locked hire's shape). It must honour a forged link, or the
 *            assertions that call the other two safe could not fail.
 *
 * Legs:
 *   P   premise   bound session loads its worker, drains a lineage-shared board as its owner
 *   X   cross-user a forged link to another user's worker reads nothing
 *   O   own-roster a caller-seeded link to ANOTHER of the caller's own workers (Codex P1 #1)
 *   R   reuse     a deleted-and-recreated session id, record shape
 *   B   boundary  another user on the owner's session; the task entry over HTTP
 *   I   isolation two workers of one user on one singleton (Codex P1 #2)
 *   C   chain     a coordinator flow's lineage board handing a row to the agent flow
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  defineFlow,
  defineResource,
  defineResourceCollection,
  dispatcher,
  handler,
  sequencer,
} from "@flow-state-dev/core";
import type { ResourceCollectionRef, ResourceRef } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import type { FlowStateRuntime } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { defineTaskCollection, type TaskWorkerInput } from "../src/tasks";
import { taskBoard, taskBoardStateSchema, taskWorkerInputSchema } from "../src/task-board";

type Mode = "state" | "record" | "naive";
const KIND = "agent-poc";

// ─── the singleton flow ───────────────────────────────────────────────────

const workerState = z.object({ name: z.string() });
const seenState = z.object({
  role: z.string(),
  userId: z.string(),
  worker: z.string(),
  sessionId: z.string(),
  memoryBefore: z.array(z.string()),
});
const readable = { client: { state: { read: true } } } as const;

/** Worker-private memory, declared the way the agent flow declares its skills drawer today. */
const memory = defineResource({
  ref: "memory",
  scope: "user",
  flowIsolation: true,
  stateSchema: z.object({ notes: z.array(z.string()).default([]) }),
});

/**
 * `handOffTo` makes this a second flow (a coordinator) whose seat hands its
 * rows to the `agent` flow's task entry instead of its own.
 */
function agentFlow(mode: Mode, opts: { kind?: string; handOffTo?: string } = {}) {
  const resources = {
    workers: defineResourceCollection({
      pattern: "workers/*",
      scope: mode === "naive" ? "org" : "user",
      stateSchema: workerState,
      ...readable,
    }),
    links: defineResourceCollection({
      pattern: "worker-links/*",
      scope: "user",
      stateSchema: z.object({ workerId: z.string() }),
    }),
    seen: defineResourceCollection({ pattern: "seen/*", scope: "user", stateSchema: seenState, ...readable }),
    memory,
  };
  const col = (ctx: { resources: Record<string, unknown> }, name: keyof typeof resources) =>
    ctx.resources[name] as unknown as ResourceCollectionRef;

  const who = (ctx: { session: { identity: { id: string; userId?: string } } }) => ({
    userId: ctx.session.identity.userId ?? "",
    sessionId: ctx.session.identity.id,
  });

  /** Load a worker through the scope the flow trusts. A miss is a refusal. */
  const loadWorker = async (ctx: any, workerId: string) => {
    const worker = await col(ctx, "workers").getOptional(workerId);
    if (worker === undefined) throw new Error(`worker "${workerId}" is not readable by ${who(ctx).userId}`);
    return (worker.state as z.infer<typeof workerState>).name;
  };

  /** Where this shape keeps the link. */
  const readLink = async (ctx: any): Promise<string | null> => {
    if (mode !== "record") return (ctx.session.state.workerId as string | null) ?? null;
    const row = await col(ctx, "links").getOptional(who(ctx).sessionId);
    return row === undefined ? null : (row.state as { workerId: string }).workerId;
  };

  const record = async (ctx: any, key: string, role: string, workerName: string) => {
    const mem = ctx.resources.memory as unknown as ResourceRef<{ notes: string[] }>;
    const before = [...(mem.state.notes ?? [])];
    await mem.patchState({ notes: [...before, `${workerName}:${key}`] });
    await col(ctx, "seen").create(key, { role, ...who(ctx), worker: workerName, memoryBefore: before });
  };

  const hire = handler({
    name: "hire",
    inputSchema: z.object({ id: z.string(), name: z.string() }),
    outputSchema: z.object({ ok: z.boolean() }),
    resources,
    execute: async (input, ctx) => {
      await col(ctx, "workers").create(input.id, { name: input.name });
      return { ok: true };
    },
  });

  /** The trusted bind: from a worker the user can read, once. */
  const open = handler({
    name: "open",
    inputSchema: z.object({ workerId: z.string() }),
    outputSchema: z.object({ ok: z.boolean() }),
    resources,
    execute: async (input, ctx: any) => {
      await loadWorker(ctx, input.workerId);
      const current = await readLink(ctx);
      if (current !== null && current !== input.workerId) {
        throw new Error(`session is bound to "${current}"; a link never changes`);
      }
      if (current === null) {
        if (mode === "record") await col(ctx, "links").create(who(ctx).sessionId, { workerId: input.workerId });
        else await ctx.session.patchState({ workerId: input.workerId });
      }
      return { ok: true };
    },
  });

  // The board: session-scoped, shared down the lineage, one seat handed off
  // to this same flow's `work` task entry — so the child is same-flow and
  // inherits the lineage and the owner.
  const board = taskBoard({
    name: "poc_board",
    boardId: "poc-board",
    collection: defineTaskCollection({ id: "poc-tasks", scope: "session", sharedToLineage: true }),
    workers: {
      work: dispatcher<TaskWorkerInput>({
        name: "poc-hand-off",
        type: "task",
        action: "work",
        session: "per-task",
        ...(opts.handOffTo !== undefined ? { flowKind: opts.handOffTo } : {}),
      }),
    },
  });

  /** The door: run as the linked worker, then put one task on the board. */
  const door = handler({
    name: "door",
    inputSchema: z.object({ tag: z.string() }),
    outputSchema: z.null(),
    resources,
    uses: [board.capability],
    execute: async (input, ctx: any) => {
      const link = await readLink(ctx);
      if (link === null) throw new Error("unbound session: no worker link");
      const name = await loadWorker(ctx, link);
      await record(ctx, `door-${input.tag}`, "door", name);
      await ctx.cap.poc_board.addTask({ id: input.tag, goal: input.tag, assignee: "work", input: { workerId: link } });
      return null;
    },
  });

  /** The task session: same flow, its link arrives in the trusted payload. */
  const work = handler({
    name: "work",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.object({ worker: z.string() }),
    resources,
    execute: async (input: TaskWorkerInput, ctx: any) => {
      const workerId = (input.input as { workerId: string }).workerId;
      const name = await loadWorker(ctx, workerId);
      await record(ctx, `task-${input.taskId}`, "task", name);
      return { worker: name };
    },
  });

  const message = sequencer({ name: "message", inputSchema: z.object({ tag: z.string() }), stateSchema: taskBoardStateSchema })
    .step(door)
    .step(board.drain);

  const kind = opts.kind ?? KIND;
  return defineFlow({
    kind,
    authentication: verified,
    session: { stateSchema: z.object({ workerId: z.string().nullable().default(null) }) },
    resources,
    actions: {
      hire: { inputSchema: hire.inputSchema, block: hire },
      open: { inputSchema: open.inputSchema, block: open },
      message: { inputSchema: z.object({ tag: z.string() }), block: message },
    },
    ...(opts.handOffTo === undefined ? { task: { actions: { work: { block: work } } } } : {}),
  })({ id: kind });
}

/** Today's hire shape: one collection-kind instance per seat, id = the worker id. */
const seatKind = defineFlow({
  kind: "seat-poc",
  cardinality: "collection",
  resources: { memory },
  actions: {
    remember: {
      inputSchema: z.object({ note: z.string() }),
      block: handler({
        name: "remember",
        inputSchema: z.object({ note: z.string() }),
        outputSchema: z.null(),
        resources: { memory },
        execute: async (input, ctx: any) => {
          await ctx.resources.memory.patchState({ notes: [input.note] });
          return null;
        },
      }),
    },
  },
});

// ─── harness ──────────────────────────────────────────────────────────────

const verified = {
  resolvePrincipal: (context: { request?: Request }) => {
    const userId = context.request?.headers.get("x-verified-user");
    const orgId = context.request?.headers.get("x-verified-org");
    return userId && orgId ? { userId, orgId } : null;
  },
};

type Who = { user: string; org: string };
const ALICE: Who = { user: "alice", org: "acme" };
const BOB: Who = { user: "bob", org: "acme" };

const COORD = "coordinator-poc";

async function boot(mode: Mode) {
  const flow = agentFlow(mode);
  const coordinator = agentFlow(mode, { kind: COORD, handOffTo: KIND });
  const state = createFlowState({
    flows: { [KIND]: flow, [COORD]: coordinator },
    resolvePrincipal: verified.resolvePrincipal,
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({}),
  });
  const router = (await state.getRouter()) as any;
  const runtime: FlowStateRuntime = await state.getRuntime();
  const stores = runtime.stores;

  const http = async (method: "GET" | "POST" | "DELETE", path: string[], who: Who, body?: unknown) => {
    const response = await router[method](
      new Request(`http://test/api/flows/${path.join("/")}`, {
        method,
        headers: { "content-type": "application/json", "x-verified-user": who.user, "x-verified-org": who.org },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      { params: { path } }
    );
    const text = await response.text();
    return { status: response.status as number, json: text.length > 0 ? JSON.parse(text) : undefined };
  };

  /** The PUBLIC create: what `CreateSessionOptions.state` sends. */
  const createSession = async (who: Who, sessionId: string, seed?: Record<string, unknown>, kind = KIND) => {
    const res = await http("POST", [kind, "sessions"], who, { sessionId, ...(seed ? { state: seed } : {}) });
    if (res.status !== 201) throw new Error(`create ${res.status}: ${JSON.stringify(res.json)}`);
  };

  /** An admitted request by `who` — the `fsdev run` shape. Returns the error message, if any. */
  const act = async (who: Who, sessionId: string, actionName: string, input: unknown, target = flow) => {
    try {
      const result = await runAction({
        orgId: who.org,
        flow: target,
        actionName,
        input,
        userId: who.user,
        sessionId,
        stores,
        runtimeConfig: { ...runtime.runtimeConfig },
      });
      return result.error === undefined ? null : String((result.error as Error)?.message ?? result.error);
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  };

  const seen = async (user: string, key: string) =>
    (await stores.resourceState.get("user", user, `seen/${key}`))?.state as z.infer<typeof seenState> | undefined;

  const until = async (predicate: () => Promise<boolean>, label: string) => {
    for (let i = 0; i < 300; i++) {
      if (await predicate()) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`timed out waiting for ${label}`);
  };

  return { state, flow, coordinator, stores, runtime, http, createSession, act, seen, until };
}

// ─── P · premise ──────────────────────────────────────────────────────────

describe("P · a bound session loads its worker and drains a lineage-shared board as its owner", () => {
  for (const mode of ["state", "record"] as const) {
    it(`P1 [${mode}] the door runs as the linked worker; the task child runs as alice and settles the row`, async () => {
      const h = await boot(mode);
      try {
        await h.createSession(ALICE, "s_a");
        expect(await h.act(ALICE, "s_a", "hire", { id: "w1", name: "researcher" })).toBeNull();
        expect(await h.act(ALICE, "s_a", "open", { workerId: "w1" })).toBeNull();
        expect(await h.act(ALICE, "s_a", "message", { tag: "t1" })).toBeNull();

        expect(await h.seen("alice", "door-t1")).toMatchObject({ role: "door", userId: "alice", worker: "researcher" });
        await h.until(async () => (await h.seen("alice", "task-t1")) !== undefined, "the task child");
        const child = await h.seen("alice", "task-t1");
        expect(child).toMatchObject({ role: "task", userId: "alice", worker: "researcher" });
        expect(child!.sessionId).not.toBe((await h.seen("alice", "door-t1"))!.sessionId);

        // The child session: same flow, alice's, parented to the door session, same lineage.
        const parent = await h.stores.session.get("s_a");
        const [childRecord] = await h.stores.session.list({ userId: "alice", parentage: { parentOf: "s_a" } });
        expect(childRecord).toMatchObject({ userId: "alice", flowKind: KIND, lineageId: parent!.lineageId });

        // The row lives at the lineage address, and the child settled it there.
        await h.until(async () => {
          const row = await h.stores.resourceState.get("lineage", parent!.lineageId!, "poc-tasks/t1");
          return (row?.state as { status?: string } | undefined)?.status === "completed";
        }, "the row to settle on the parent's lineage board");
      } finally {
        await h.state.dispose();
      }
    });
  }
});

// ─── X · a forged link to another user's worker ──────────────────────────

describe("X · a forged link to another user's worker reads nothing", () => {
  for (const mode of ["state", "record"] as const) {
    it(`X1 [${mode}] bob seeds or binds alice's worker id: refused, nothing recorded`, async () => {
      const h = await boot(mode);
      try {
        await h.createSession(ALICE, "s_a");
        await h.act(ALICE, "s_a", "hire", { id: "w1", name: "researcher" });

        await h.createSession(BOB, "s_b", { workerId: "w1" });
        const bound = await h.act(BOB, "s_b", "open", { workerId: "w1" });
        expect(bound).toMatch(/not readable by bob/);
        expect(await h.act(BOB, "s_b", "message", { tag: "x1" })).toMatch(
          mode === "state" ? /not readable by bob/ : /unbound session/
        );
        expect(await h.seen("bob", "door-x1")).toBeUndefined();
      } finally {
        await h.state.dispose();
      }
    });
  }

  it("X2 [naive · CONTROL] workers in org scope: bob's seeded link IS honoured — the check can fail", async () => {
    const h = await boot("naive");
    try {
      await h.createSession(ALICE, "s_a");
      await h.act(ALICE, "s_a", "hire", { id: "w1", name: "alice-researcher" });

      await h.createSession(BOB, "s_b", { workerId: "w1" });
      expect(await h.act(BOB, "s_b", "message", { tag: "x2" })).toBeNull();
      // The BP-031 violation: bob runs as alice's worker on a link he wrote.
      expect(await h.seen("bob", "door-x2")).toMatchObject({ userId: "bob", worker: "alice-researcher" });
    } finally {
      await h.state.dispose();
    }
  });
});

// ─── O · a caller-seeded link to another of the caller's OWN workers ─────

describe("O · a caller-seeded link to another of alice's own workers (Codex P1 #1)", () => {
  it("O1 [state] the public create persists the seed and the door runs as w2 — NOT refused", async () => {
    const h = await boot("state");
    try {
      await h.createSession(ALICE, "s_setup");
      await h.act(ALICE, "s_setup", "hire", { id: "w1", name: "researcher" });
      await h.act(ALICE, "s_setup", "hire", { id: "w2", name: "writer" });

      // No `open`: the link came from `CreateSessionOptions.state`, verbatim.
      await h.createSession(ALICE, "s_seeded", { workerId: "w2" });
      expect((await h.stores.session.get("s_seeded"))!.state).toMatchObject({ workerId: "w2" });
      expect(await h.act(ALICE, "s_seeded", "message", { tag: "o1" })).toBeNull();
      expect(await h.seen("alice", "door-o1")).toMatchObject({ worker: "writer" });

      // A seed that parses keeps only declared keys; one that FAILS the schema is
      // persisted raw, undeclared keys and all ("validation happens at action time").
      await h.createSession(ALICE, "s_parsed", { workerId: "w1", delegates: ["anyone"] });
      expect((await h.stores.session.get("s_parsed"))!.state).toEqual({ workerId: "w1" });
      await h.createSession(ALICE, "s_raw", { workerId: 7, delegates: ["anyone"] });
      expect((await h.stores.session.get("s_raw"))!.state).toEqual({ workerId: 7, delegates: ["anyone"] });
    } finally {
      await h.state.dispose();
    }
  });

  it("O2 [record] the seed is ignored: unbound until the trusted bind, and the bind never changes", async () => {
    const h = await boot("record");
    try {
      await h.createSession(ALICE, "s_setup");
      await h.act(ALICE, "s_setup", "hire", { id: "w1", name: "researcher" });
      await h.act(ALICE, "s_setup", "hire", { id: "w2", name: "writer" });

      await h.createSession(ALICE, "s_seeded", { workerId: "w2" });
      expect(await h.act(ALICE, "s_seeded", "message", { tag: "o2" })).toMatch(/unbound session/);
      expect(await h.act(ALICE, "s_seeded", "open", { workerId: "w1" })).toBeNull();
      expect(await h.act(ALICE, "s_seeded", "open", { workerId: "w2" })).toMatch(/a link never changes/);
      expect(await h.act(ALICE, "s_seeded", "message", { tag: "o2b" })).toBeNull();
      expect(await h.seen("alice", "door-o2b")).toMatchObject({ worker: "researcher" });

      // No public route writes the row: not client-writable (403), and user-scope mutations are 501 anyway.
      const write = await h.http("POST", ["sessions", "s_seeded", "resources", "links"], ALICE, {
        key: "s_seeded",
        state: { workerId: "w2" },
      });
      expect(write.status).toBe(403);
    } finally {
      await h.state.dispose();
    }
  });
});

// ─── R · reuse of a session id, record shape ──────────────────────────────

describe("R · a recreated session id, record shape", () => {
  it("R1 [record] delete and recreate the same id: the new session inherits the old link", async () => {
    const h = await boot("record");
    try {
      await h.createSession(ALICE, "s_r");
      await h.act(ALICE, "s_r", "hire", { id: "w1", name: "researcher" });
      await h.act(ALICE, "s_r", "hire", { id: "w2", name: "writer" });
      await h.act(ALICE, "s_r", "open", { workerId: "w1" });

      const del = await h.http("DELETE", ["sessions", "s_r"], ALICE);
      expect(del.status).toBeLessThan(300);
      await h.createSession(ALICE, "s_r");
      expect((await h.stores.session.get("s_r"))!.lineageId).toBeDefined();

      // A new incarnation, but the row is keyed by the caller-chosen id.
      expect(await h.act(ALICE, "s_r", "open", { workerId: "w2" })).toMatch(/bound to "w1"/);
    } finally {
      await h.state.dispose();
    }
  });
});

// ─── B · boundaries the premise relies on ─────────────────────────────────

describe("B · boundaries", () => {
  it("B1 bob cannot act in alice's session, and nobody reaches the task entry over HTTP", async () => {
    const h = await boot("state");
    try {
      await h.createSession(ALICE, "s_a");
      await h.act(ALICE, "s_a", "hire", { id: "w1", name: "researcher" });
      await h.act(ALICE, "s_a", "open", { workerId: "w1" });

      expect(await h.act(BOB, "s_a", "message", { tag: "b1" })).toMatch(/belongs to another user/);
      expect(await h.seen("bob", "door-b1")).toBeUndefined();

      const viaHttp = await h.http("POST", [KIND, "s_a", "actions", "work"], ALICE, {
        input: { taskId: "forged", goal: "x", attempts: 1, input: { workerId: "w1" } },
      });
      // Refused as no public action (today a 500 DispatchFailed, not a 404).
      expect(viaHttp.status).toBeGreaterThanOrEqual(400);
      expect(viaHttp.json?.message).toMatch(/does not define action "work"/);
    } finally {
      await h.state.dispose();
    }
  });
});

// ─── I · two workers of one user on one singleton ─────────────────────────

describe("I · worker-private state on a singleton (Codex P1 #2)", () => {
  it("I1 a flowIsolation resource is ONE cell for every worker of a user: w2 reads w1's memory", async () => {
    const h = await boot("state");
    try {
      await h.createSession(ALICE, "s_w1");
      await h.act(ALICE, "s_w1", "hire", { id: "w1", name: "researcher" });
      await h.act(ALICE, "s_w1", "hire", { id: "w2", name: "writer" });
      await h.act(ALICE, "s_w1", "open", { workerId: "w1" });
      await h.act(ALICE, "s_w1", "message", { tag: "i1" });

      await h.createSession(ALICE, "s_w2");
      await h.act(ALICE, "s_w2", "open", { workerId: "w2" });
      await h.act(ALICE, "s_w2", "message", { tag: "i2" });

      expect((await h.seen("alice", "door-i2"))!.memoryBefore).toContain("researcher:door-i1");
      // The cell: user scope, keyed (userId, flowInstanceId) — and the singleton's instance id is its kind.
      const cell = await h.stores.resourceState.get("user", `alice:${KIND}`, "memory");
      expect((cell!.state as { notes: string[] }).notes).toEqual(
        expect.arrayContaining(["researcher:door-i1", "writer:door-i2"])
      );
    } finally {
      await h.state.dispose();
    }
  });

  it("I2 today's per-seat cell (alice:w1) is not what the singleton reads — it would be stranded", async () => {
    const h = await boot("state");
    try {
      // A hire-era seat: a collection-kind instance whose id is the worker id.
      const seat = seatKind({ id: "w1" });
      await runAction({
        orgId: "acme",
        flow: seat,
        actionName: "remember",
        input: { note: "hire-era note" },
        userId: "alice",
        sessionId: "s_seat",
        stores: h.stores,
        runtimeConfig: { ...h.runtime.runtimeConfig },
      });
      expect((await h.stores.resourceState.get("user", "alice:w1", "memory"))!.state).toMatchObject({
        notes: ["hire-era note"],
      });

      await h.createSession(ALICE, "s_new");
      await h.act(ALICE, "s_new", "hire", { id: "w1", name: "researcher" });
      await h.act(ALICE, "s_new", "open", { workerId: "w1" });
      await h.act(ALICE, "s_new", "message", { tag: "i3" });
      expect((await h.seen("alice", "door-i3"))!.memoryBefore).not.toContain("hire-era note");
    } finally {
      await h.state.dispose();
    }
  });
});

// ─── C · the chain across flows: a coordinator hands a row to the agent flow ─

describe("C · a lineage-shared board across two flows (FIX-1794's chain)", () => {
  it("C1 a coordinator's session board handing a row to the agent flow: what the child sees", async () => {
    const h = await boot("state");
    try {
      await h.createSession(ALICE, "s_setup");
      await h.act(ALICE, "s_setup", "hire", { id: "w1", name: "researcher" });

      await h.createSession(ALICE, "s_c", undefined, COORD);
      expect(await h.act(ALICE, "s_c", "open", { workerId: "w1" }, h.coordinator)).toBeNull();
      const sent = await h.act(ALICE, "s_c", "message", { tag: "c1" }, h.coordinator);

      const parent = await h.stores.session.get("s_c");
      const rowOf = async () =>
        (await h.stores.resourceState.get("lineage", parent!.lineageId!, "poc-tasks/c1"))?.state as
          | { status?: string; error?: string }
          | undefined;
      await new Promise((r) => setTimeout(r, 300));
      const children = await h.stores.session.list({ userId: "alice", parentage: { parentOf: "s_c" } });
      const observed = {
        sent,
        children: children.map((c) => ({ flowKind: c.flowKind, sameLineage: c.lineageId === parent!.lineageId })),
        childRan: (await h.seen("alice", "task-c1")) !== undefined,
        row: (await rowOf())?.status,
        rowError: (await rowOf())?.error,
        childRequest: await (async () => {
          const [req] = await h.stores.request.list({ sessionId: children[0]!.id, userId: "alice" } as never);
          return req === undefined ? null : { status: req.status, error: String((req as any).error?.message ?? (req as any).error ?? "") };
        })(),
      };
      // Observed on b8e5f1531: the cross-flow child roots its own lineage, so it
      // resolves an empty ledger, its gate skips the row, its request completes
      // having run nothing, and the parent's row is left in_progress. Same-flow
      // (P1) settles. A user-scoped ledger crosses flows today
      // (packages/orchestration/test/task-board/hand-off-cross-flow.test.ts).
      expect(observed).toEqual({
        sent: null,
        children: [{ flowKind: KIND, sameLineage: false }],
        childRan: false,
        row: "in_progress",
        rowError: undefined,
        childRequest: { status: "completed", error: "" },
      });
    } finally {
      await h.state.dispose();
    }
  });
});
