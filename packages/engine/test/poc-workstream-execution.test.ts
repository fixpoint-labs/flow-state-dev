/**
 * POC v2 (throwaway — FIX-939 design, not a shipping test).
 *
 * Extends the store-layer POC to the EXECUTION layer: two real flows, real
 * actions, real `runAction`, and a task dispatched from a coordinator session
 * into a Workstream (a sub-session) running a DIFFERENT flow.
 *
 * Answers three things the store-layer POC could not:
 *   1. can a Workstream run a different flow than its parent?
 *   2. what does a block actually have access to (i.e. how big is the gap
 *      between "record intent" and "dispatch a sibling")?
 *   3. does history isolation hold on the real execution path, not just at the
 *      store query?
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import { createInMemoryStores, runAction } from "../src";
import type { SessionRecord, StoreRegistry } from "../src/stores/types";

/**
 * A task as the board holds it. It names an `assignee` and a `topic` — never a
 * flow, an action, or a session id. §1 rejects storing a `(flowKind, action)`
 * target because `TaskWorkerRegistry` already says what runs; the executor
 * resolves the worker from the registry by `assignee`.
 */
type WorkstreamTask = {
  boardId: string;
  assignee: string;
  topic: string;
  input: string;
};

const BOARD_ID = "board_delivery";

/**
 * What actually gets persisted on the task/envelope: **strings only**, derived
 * from the board binding at spawn time rather than chosen per task by an author.
 *
 * This is the reconciliation the design needs. The board's live registry is
 * `TaskWorkerRegistry = Record<string, TaskWorker>` whose values are
 * `BlockDefinition`s — closures, not serializable — while
 * `InboundRequestEnvelope` carries `flowKind: string` and `action: string`
 * (`transports/types.ts:71-72`) and cannot carry a block. So a detached request
 * crossing BullMQ or surviving a restart cannot be handed the registry entry; it
 * must re-resolve one from string coordinates. "The board configures
 * disposition, not a target" governs AUTHORING; the envelope still needs a
 * re-resolvable coordinate.
 */
type DispatchBinding = {
  flowKind: string;
  action: string;
  boardId: string;
  assignee: string;
};

/**
 * ⚠️ UNRESOLVED DESIGN GAP — this map is invented by the POC, and that is the
 * finding, not an implementation detail.
 *
 * §1's board surface declares only `{ worker, dispatch }`: a `BlockDefinition`
 * and a disposition. **Nothing in it names a `flowKind` or an `action`**, and a
 * `BlockDefinition` carries no back-reference to the action that hosts it — so
 * there is no production source from which `bindWorker` could derive a
 * serializable coordinate. Two earlier drafts obscured this: first a parallel
 * hand-authored map beside the registry, then this "derived" map, which is
 * derived only from itself.
 *
 * What the tests below therefore prove is narrower than it looks: **given** a
 * correct binding, re-resolution works. They do NOT prove one can be produced.
 * Closing that is FIX-982's design work (N9/N14) — either the board surface
 * grows an explicit hosting coordinate per worker, or workers move to a
 * registry addressable outside `flow.actions`.
 */
type BoardWorkerDecl = {
  /** The action on `flowKind` whose block IS this worker. */
  flowKind: string;
  action: string;
  /** The live block — what an inline drain runs. Not serializable. */
  block: (input: string) => string;
};

const BOARD_DECL: Record<string, Record<string, BoardWorkerDecl>> = {
  [BOARD_ID]: {
    implementer: {
      flowKind: "worker",
      action: "execute",
      block: (input: string) => `did: ${input}`
    }
  }
};

/** Stands in for a binding the real surface cannot yet supply — see above. */
function bindWorker(boardId: string, assignee: string): DispatchBinding {
  const decl = BOARD_DECL[boardId]?.[assignee];
  if (decl === undefined) {
    throw new Error(`unknown_assignee: "${assignee}" is not on board "${boardId}"`);
  }
  return { flowKind: decl.flowKind, action: decl.action, boardId, assignee };
}

type Workstream = SessionRecord & {
  parentSessionId?: string;
  boardId?: string;
  assignee?: string;
  topic?: string;
};

/** Intent recorded from inside a running request; drained outside it. */
const filed: WorkstreamTask[] = [];
/** What a block could actually see on its ctx, captured at runtime. */
let observedCtxKeys: string[] = [];

const coordinatorFlow = defineFlow({
  kind: "coordinator",
  actions: {
    plan: {
      inputSchema: z.string(),
      block: handler({
        name: "plan",
        execute: (input: unknown, ctx: unknown) => {
          observedCtxKeys = Object.keys(ctx as object).sort();
          // A block can RECORD intent. It cannot dispatch: there is no
          // flow registry and no executor reachable from here.
          filed.push({
            boardId: BOARD_ID,
            assignee: "implementer",
            topic: String(input),
            input: `work for ${String(input)}`
          });
          return `planned ${String(input)}`;
        }
      })
    }
  }
})();

const workerFlow = defineFlow({
  kind: "worker",
  actions: {
    execute: {
      inputSchema: z.string(),
      block: handler({ name: "execute", execute: (input: unknown) => `did: ${String(input)}` })
    }
  }
})();

/**
 * Rebuilt from static flow definitions at process start. This is the
 * re-resolution path: a restarted process has no live registry, only the
 * definitions it can reconstruct plus the string coordinate on the envelope.
 */
function buildFlowRegistry(): Record<string, ReturnType<typeof defineFlow> extends never ? never : typeof workerFlow> {
  return { worker: workerFlow, coordinator: coordinatorFlow as unknown as typeof workerFlow };
}

let seq = 0;

/**
 * Stands in for the capability that does not exist today. Keyed on
 * (parentSessionId, boardId, assignee, topic). `boardId` is required because
 * `assignee` is unique only WITHIN a registry; `flowKind` is not in the key at
 * all — the flow follows from the resolved worker, it does not identify it.
 */
async function dispatchToWorkstream(
  stores: StoreRegistry,
  parentSessionId: string,
  task: WorkstreamTask,
  // The binding a restarted process would carry in the envelope. Defaults to
  // deriving it live, which is what an in-process dispatch does; the restart
  // test passes the PERSISTED one so the proof actually exercises it.
  binding: DispatchBinding = bindWorker(task.boardId, task.assignee)
): Promise<string> {
  const all = (await stores.session.list({})) as Workstream[];
  const existing = all.find(
    (s) =>
      s.parentSessionId === parentSessionId &&
      s.topic === task.topic &&
      s.boardId === task.boardId &&
      s.assignee === task.assignee
  );

  let workstreamId: string;
  if (existing !== undefined) {
    workstreamId = existing.id;
  } else {
    workstreamId = `ws_${++seq}`;
    const record: Workstream = {
      id: workstreamId,
      flowKind: binding.flowKind,
      boardId: task.boardId,
      assignee: task.assignee,
      userId: "u1",
      state: {},
      version: 0,
      createdAt: 1,
      updatedAt: 1,
      journal: [],
      parentSessionId,
      topic: task.topic
    };
    await stores.session.set(workstreamId, record, "any");
  }

  // Re-resolve from the string coordinate through a registry rebuilt from
  // static flow definitions — what a BullMQ worker or restarted process must
  // do, since it cannot be handed the block.
  const flow = buildFlowRegistry()[binding.flowKind];
  if (flow === undefined) throw new Error(`unresolvable flowKind: ${binding.flowKind}`);

  await runAction({
    flow,
    actionName: binding.action,
    input: task.input,
    userId: "u1",
    sessionId: workstreamId,
    stores,
    runtimeConfig: {}
  });
  return workstreamId;
}

async function historyOf(stores: StoreRegistry, sessionId: string): Promise<string[]> {
  const rs = await stores.request.list({ sessionId, status: "completed", limit: 50 });
  return rs.map((r) => r.actionName).sort();
}

describe("POC v2: Workstream execution across flows", () => {
  it("a Workstream runs a DIFFERENT flow than its parent, with isolated history", async () => {
    filed.length = 0;
    const stores = createInMemoryStores();

    await runAction({
      flow: coordinatorFlow,
      actionName: "plan",
      input: "FIX-981",
      userId: "u1",
      sessionId: "S",
      stores,
      runtimeConfig: {}
    });

    expect(filed).toHaveLength(1);
    const wsId = await dispatchToWorkstream(stores, "S", filed[0]!);

    const ws = (await stores.session.get(wsId)) as Workstream | undefined;
    expect(ws?.flowKind).toBe("worker");
    expect(ws?.parentSessionId).toBe("S");
    expect(ws?.topic).toBe("FIX-981");

    // The coordinator's turn stays in S; the worker's turn stays in the Workstream.
    expect(await historyOf(stores, "S")).toEqual(["plan"]);
    expect(await historyOf(stores, wsId)).toEqual(["execute"]);
  });

  it("a second task on the same topic REUSES the Workstream and accumulates", async () => {
    filed.length = 0;
    const stores = createInMemoryStores();

    await runAction({
      flow: coordinatorFlow, actionName: "plan", input: "FIX-981",
      userId: "u1", sessionId: "S", stores, runtimeConfig: {}
    });
    const first = await dispatchToWorkstream(stores, "S", filed[0]!);
    const second = await dispatchToWorkstream(stores, "S", filed[0]!);

    expect(second).toBe(first);
    expect(await historyOf(stores, first)).toEqual(["execute", "execute"]);
    expect(await historyOf(stores, "S")).toEqual(["plan"]);
  });

  it("separate topics get separate Workstreams", async () => {
    filed.length = 0;
    const stores = createInMemoryStores();
    const a = await dispatchToWorkstream(stores, "S", {
      boardId: BOARD_ID, assignee: "implementer", topic: "FIX-981", input: "a"
    });
    const b = await dispatchToWorkstream(stores, "S", {
      boardId: BOARD_ID, assignee: "implementer", topic: "FIX-982", input: "b"
    });
    expect(a).not.toBe(b);
    expect(await historyOf(stores, a)).toEqual(["execute"]);
    expect(await historyOf(stores, b)).toEqual(["execute"]);
  });

  it("BINDING — a detached request re-resolves its worker after a restart", async () => {
    filed.length = 0;
    const stores = createInMemoryStores();

    await runAction({
      flow: coordinatorFlow, actionName: "plan", input: "FIX-981",
      userId: "u1", sessionId: "S", stores, runtimeConfig: {}
    });
    const task = filed[0]!;

    // Everything the envelope persists is a string — nothing here is a block.
    const binding = bindWorker(task.boardId, task.assignee);
    expect(JSON.parse(JSON.stringify(binding))).toEqual(binding);
    expect(Object.values(binding).every((v) => typeof v === "string")).toBe(true);

    // Simulate a restart: throw away everything but the serialized task and
    // binding, rebuild the flow registry from static definitions, resolve, run.
    // The revived BINDING is passed through — an earlier draft serialized it,
    // asserted it round-tripped, then dropped it and re-derived from the live
    // BOARD_DECL, so the proof held even if the persisted binding disagreed.
    const revived = JSON.parse(JSON.stringify(task)) as typeof task;
    const revivedBinding = JSON.parse(JSON.stringify(binding)) as DispatchBinding;
    const wsId = await dispatchToWorkstream(stores, "S", revived, revivedBinding);
    expect(await historyOf(stores, wsId)).toEqual(["execute"]);
    // The Workstream's flowKind came from the persisted binding, not a literal.
    expect(((await stores.session.get(wsId)) as Workstream)!.flowKind).toBe(revivedBinding.flowKind);

    // And it is load-bearing: with the assignee REMOVED from the live board —
    // renamed, or the process restarted against a newer declaration — live
    // re-derivation throws, while the persisted binding still resolves and runs.
    const saved = BOARD_DECL[BOARD_ID]!.implementer!;
    delete BOARD_DECL[BOARD_ID]!.implementer;
    try {
      expect(() => bindWorker(task.boardId, task.assignee)).toThrow(/unknown_assignee/);
      const wsId2 = await dispatchToWorkstream(
        stores, "S2", { ...revived, topic: "after-rename" }, revivedBinding
      );
      expect(await historyOf(stores, wsId2)).toEqual(["execute"]);
    } finally {
      BOARD_DECL[BOARD_ID]!.implementer = saved;
    }

    // A binding that names nothing on the board fails loudly rather than
    // silently running the wrong worker.
    expect(() => bindWorker(task.boardId, "nobody")).toThrow(/unknown_assignee/);
  });

  it("GAP — the board surface cannot supply this binding, and that is the finding", () => {
    // What §1's config surface actually offers per worker.
    const boardSurfaceEntry = { worker: workerFlow.actions.execute.block, dispatch: { mode: "detached" } };
    const keys = Object.keys(boardSurfaceEntry);

    // No hosting coordinate anywhere in it.
    expect(keys).toEqual(["worker", "dispatch"]);
    expect(keys).not.toContain("flowKind");
    expect(keys).not.toContain("action");

    // And the block itself carries no back-reference to the action hosting it,
    // so the coordinate cannot be recovered from the value either.
    const block = boardSurfaceEntry.worker as unknown as Record<string, unknown>;
    expect(block.action).toBeUndefined();
    expect(block.flowKind).toBeUndefined();

    // Hence BOARD_DECL is an invention. The restart evidence below is therefore
    // conditional: GIVEN a correct binding, re-resolution works. Producing one
    // is FIX-982's unresolved design work (N9/N14).
    const binding = bindWorker(BOARD_ID, "implementer");
    const flow = buildFlowRegistry()[binding.flowKind];
    expect(Object.keys((flow as unknown as { actions: object }).actions)).toContain(binding.action);
  });

  it("PROBE — what a block can actually reach from ctx", async () => {
    filed.length = 0;
    const stores = createInMemoryStores();
    await runAction({
      flow: coordinatorFlow, actionName: "plan", input: "probe",
      userId: "u1", sessionId: "S", stores, runtimeConfig: {}
    });

    const has = (k: string) => observedCtxKeys.includes(k);
    // eslint-disable-next-line no-console
    console.log(
      `[poc2] ctx keys (${observedCtxKeys.length}): ${observedCtxKeys.join(", ")}\n` +
        `[poc2] stores=${has("stores")} sessionId=${has("sessionId")} ` +
        `flow=${has("flow")} runAction=${has("runAction")} dispatch=${has("dispatch")}`
    );
    // The epic scopes M3 using these four results, so assert each rather than
    // only logging it — otherwise the POC stays green while the design premise
    // silently goes stale.
    expect(has("stores")).toBe(true);
    expect(has("flow")).toBe(true);
    expect(has("runAction")).toBe(false);
    expect(has("dispatch")).toBe(false);
    expect(observedCtxKeys.length).toBeGreaterThan(0);
  });

  it("BINDING — a Workstream must inherit the parent's org, or the dispatch throws or silently unbinds", async () => {
    // Identity binds to a session at creation and is IMMUTABLE after
    // (`createExecutionContext.ts:625-632`, plus the user and tenant twins in
    // `binding-errors.ts`). A Workstream is a session, so the spawn has to copy
    // the parent's binding — and gets two different failures if it does not.
    const stores = createInMemoryStores();
    await stores.session.set(
      "S_org",
      { id: "S_org", flowKind: "epic", userId: "u1", orgId: "org_acme",
        state: {}, version: 0, createdAt: 1, updatedAt: 1, journal: [] } as never,
      "any"
    );
    // The Workstream as this POC's spawn builds it: no orgId.
    await stores.session.set(
      "ws_unbound",
      { id: "ws_unbound", flowKind: "worker", userId: "u1",
        state: {}, version: 0, createdAt: 1, updatedAt: 1, journal: [] } as never,
      "any"
    );

    // (a) Envelope carries the parent's org — the spec's own requirement — and
    // the mismatch against the unbound child is a HARD THROW on every dispatch.
    await expect(
      runAction({
        flow: workerFlow, actionName: "execute", input: "x",
        userId: "u1", orgId: "org_acme", sessionId: "ws_unbound",
        stores, runtimeConfig: {}
      })
    ).rejects.toThrow(/OrgBindingMismatch|org/i);

    // (b) Envelope omits it — no throw, and the worker runs UNBOUND: it has
    // lost the parent's org scope and every org-scoped resource with it. The
    // silent branch is the more dangerous one.
    const unbound = await runAction({
      flow: workerFlow, actionName: "execute", input: "x",
      userId: "u1", sessionId: "ws_unbound", stores, runtimeConfig: {}
    });
    expect(unbound).toBeDefined();
    expect((await stores.session.get("ws_unbound"))?.orgId).toBeUndefined();

    // (c) Inherited at creation, the same dispatch resolves cleanly.
    await stores.session.set(
      "ws_bound",
      { id: "ws_bound", flowKind: "worker", userId: "u1", orgId: "org_acme",
        state: {}, version: 0, createdAt: 1, updatedAt: 1, journal: [] } as never,
      "any"
    );
    const bound = await runAction({
      flow: workerFlow, actionName: "execute", input: "x",
      userId: "u1", orgId: "org_acme", sessionId: "ws_bound",
      stores, runtimeConfig: {}
    });
    expect(bound).toBeDefined();
    // eslint-disable-next-line no-console
    console.log("[poc2] org binding: unbound+orgId=throw · unbound+omitted=silent · inherited=ok");
  });

  it("GAP — `stores` and `flow` are present at RUNTIME but absent from the PUBLIC context type", () => {
    // The probe above enumerates runtime keys, which is not the same question as
    // "what may a capability read". `ExecutionContext = BlockContext & { flow,
    // actionName, requestRuntime, stores, ... }` (`engine/src/context/types.ts:25-43`)
    // — those four are the ENGINE's additions. A capability's `fns(ctx)` is
    // typed against `BlockContext`, which is declared in `@flow-state-dev/core`
    // and cannot name `StoreRegistry` or `FlowInstance` at all: `core` does not
    // depend on `engine`, and the package boundary is a locked constraint.
    //
    // So "only two pieces are missing" is measured on the wrong surface. A
    // spawn capability reaching `ctx.stores` today would be reading an
    // engine-internal field through a cast — which is what this POC does, and
    // is not a thing FIX-982 may ship.
    type PublicCtxKeys = keyof import("@flow-state-dev/core").BlockContext;
    const publicKeys: PublicCtxKeys[] = ["request", "session", "user", "resources", "emit"];
    // These are on the public type...
    for (const k of publicKeys) expect(observedCtxKeys).toContain(k);

    // ...and these two, which the POC depends on, are NOT — the cast in
    // `probeBlock` is the only reason it can see them.
    const publicOnly = ["stores", "flow"] as const;
    for (const k of publicOnly) {
      // Present at runtime (asserted above), but not assignable as a public key.
      expect(observedCtxKeys).toContain(k);
      // @ts-expect-error — `stores`/`flow` are not members of `BlockContext`.
      const _typed: PublicCtxKeys = k;
      void _typed;
    }
  });
});
