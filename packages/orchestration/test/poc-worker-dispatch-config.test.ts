/**
 * POC (throwaway — FIX-939 design, not a shipping test).
 *
 * What the board's worker config looks like once disposition (WHERE a task
 * runs) is board-level and the target (WHAT runs) stays the existing worker
 * registry.
 *
 * The competing shape — the board declaring `(flowKind, action)` — is rejected
 * here because the registry already says what runs; naming a flow and action
 * beside it is a second source of truth for one fact.
 *
 * Settles four things about the surface:
 *   1. a bare worker value still means inline (BP-030: old boards unchanged)
 *   2. board default + per-worker override, and which wins
 *   3. the SAME block runs inline or detached — disposition is orthogonal
 *   4. topic derivation is what gives a Workstream continuity across tasks
 *
 * Execution itself is not re-proven here — poc-workstream-execution covers
 * cross-flow dispatch on the real `runAction` path. This is the config layer.
 */
import { describe, expect, it } from "vitest";
import { handler } from "@flow-state-dev/core";
// `engine` is a devDependency of `orchestration`, so a test may reach for the
// stores; `src` may not. That boundary is why this POC lives here and not in
// `engine`, which would have to deep-import `orchestration/src` to see the
// worker contract.
import { createInMemoryStores, type SessionRecord, type StoreRegistry } from "@flow-state-dev/engine";
import type { TaskWorker, TaskWorkerInput } from "../src/tasks/workers/types";

// ─── The proposed config surface ─────────────────────────────────────────────

/**
 * WHERE a task runs. The only thing the board gains; WHAT runs is the registry.
 *
 * Deliberately a bare discriminant with no options. An earlier draft carried
 * `topic: (input) => string` here, which SKILL.md frontmatter cannot express —
 * it is declarative, and a YAML path mini-language was rejected as scope creep
 * for the same reason FIX-925's spec rejected one for dep inputs. Topic is task
 * data instead (below), which both surfaces can express.
 */
type WorkerDispatch = { mode: "inline" } | { mode: "detached" };

/**
 * The task field that decides which Workstream the work lands in. The *skill
 * author* knows statically whether a participant detaches; the *coordinator*
 * knows per task which body of work it belongs to. Different knowledge, held at
 * different times, so it lives in different places.
 */
type TaskWithTopic = TaskWorkerInput & { topic?: string };

/**
 * Registry value. A bare `TaskWorker` is the shape that ships today and keeps
 * meaning "inline"; the object form adds disposition without a second registry.
 */
type WorkerEntry = TaskWorker | { worker: TaskWorker; dispatch: WorkerDispatch };

/**
 * The shipping shape is a UNION — `workers: TaskWorker | TaskWorkerRegistry`
 * (`task-board/index.ts:288`). A single uniform worker has no assignee, so it
 * has no natural key coordinate; it gets the reserved sentinel below, mirroring
 * how `worker-step` already steers an absent assignee through a reserved
 * fallback route.
 */
const UNIFORM_ASSIGNEE = "__uniform__";

type BoardConfig = {
  workers: WorkerEntry | Record<string, WorkerEntry>;
  /** Board-level default, itself defaulting to inline. */
  dispatch?: WorkerDispatch;
  /** Runs tasks with no `assignee` (the roster's "default worker"). */
  defaultWorker?: WorkerEntry;
};

const INLINE: WorkerDispatch = { mode: "inline" };

function entryWorker(entry: WorkerEntry): TaskWorker {
  return isWrapper(entry) ? entry.worker : (entry as TaskWorker);
}

function entryDispatch(entry: WorkerEntry): WorkerDispatch | undefined {
  return isWrapper(entry) ? entry.dispatch : undefined;
}

/**
 * Discriminates the shipping union. A `BlockDefinition` is identified by its own
 * `kind` field (`core/src/types/block.ts:886` — the top-level keys are `kind`,
 * `name`, `inputSchema`, `outputSchema`, `config`; there is **no** top-level
 * `execute`). An earlier draft keyed off `execute`/`worker` presence, which
 * misclassified a bare `TaskWorker` as a registry and would also have mistaken a
 * registry containing an assignee literally named `worker` for the wrapper form.
 */
function isBareWorker(w: unknown): w is TaskWorker {
  return typeof w === "object" && w !== null && "kind" in w && "config" in w;
}

/**
 * `dispatch` is REQUIRED on the wrapper, and that is load-bearing rather than
 * stylistic: `{ worker: <block> }` alone is indistinguishable from a registry
 * whose single assignee is literally named `worker`. Requiring the discriminant
 * removes the ambiguity — and costs nothing, since a wrapper with no disposition
 * has no reason to exist over the bare block.
 */
function isWrapper(w: unknown): w is { worker: TaskWorker; dispatch: WorkerDispatch } {
  if (typeof w !== "object" || w === null) return false;
  const o = w as { worker?: unknown; dispatch?: unknown };
  if (!isBareWorker(o.worker)) return false;
  return typeof o.dispatch === "object" && o.dispatch !== null && "mode" in o.dispatch;
}

function isRegistry(w: BoardConfig["workers"]): w is Record<string, WorkerEntry> {
  return !isBareWorker(w) && !isWrapper(w);
}

/**
 * Per-worker overrides the board default; the board default overrides inline.
 *
 * Registry-miss handling matches the shipped router rather than inventing new
 * behavior: `defaultWorker` is the **delegation floor** and runs any task whose
 * assignee is *"unknown or absent"* (`task-board/index.ts:290-299`,
 * `worker-step.ts:24-38`). Throwing on an unknown assignee — as an earlier draft
 * did — would remove that floor for tasks admitted outside the roster-validated
 * skills path.
 */
function resolveDispatch(config: BoardConfig, assignee?: string): {
  worker: TaskWorker;
  dispatch: WorkerDispatch;
  /** The coordinate that goes in the Workstream key. */
  coordinate: string;
} {
  // Uniform-worker board: every task runs the one worker, under the sentinel.
  if (!isRegistry(config.workers)) {
    const entry = config.workers;
    return {
      worker: entryWorker(entry),
      dispatch: entryDispatch(entry) ?? config.dispatch ?? INLINE,
      coordinate: UNIFORM_ASSIGNEE
    };
  }

  const hit = assignee === undefined ? undefined : config.workers[assignee];
  if (hit !== undefined) {
    return {
      worker: entryWorker(hit),
      dispatch: entryDispatch(hit) ?? config.dispatch ?? INLINE,
      coordinate: assignee!
    };
  }

  // Miss — unknown OR absent — routes to the delegation floor when present.
  if (config.defaultWorker !== undefined) {
    return {
      worker: entryWorker(config.defaultWorker),
      dispatch: entryDispatch(config.defaultWorker) ?? config.dispatch ?? INLINE,
      // The floor's own coordinate, so its Workstream is not keyed under a name
      // that resolves to a different worker.
      coordinate: UNIFORM_ASSIGNEE
    };
  }
  throw new Error(
    `unknown_assignee: "${assignee}" is not a participant on this board.`
  );
}

/**
 * Falls back to `taskId`, so a coordinator that names no topic gets one
 * Workstream per task — continuity is opted into, never accidental.
 */
function resolveTopic(dispatch: WorkerDispatch, task: TaskWithTopic): string {
  if (dispatch.mode !== "detached") {
    throw new Error("resolveTopic called for an inline worker");
  }
  return task.topic ?? task.taskId;
}

// ─── Workstream routing, keyed on assignee (not flowKind) ────────────────────

type Workstream = SessionRecord & {
  parentSessionId?: string;
  boardId?: string;
  assignee?: string;
  topic?: string;
};

let seq = 0;

/**
 * Mirrors `resolveSessionStorageKey` (`stores/scope-keys.ts:75-82`): production
 * resolves a session as `${tenantId}:${sessionId}`, so the record must persist
 * under the namespaced key while the public id stays bare. Writing under the
 * bare id passes an in-memory scan but a real detached request would miss it and
 * create a second session with no Workstream metadata.
 */
const storageKey = (id: string, tenantId: string | undefined) =>
  tenantId !== undefined && tenantId.length > 0 ? `${tenantId}:${id}` : id;

/** Two boards under one parent session, each declaring an `implement` worker. */
const BOARD_A = "board_research";
const BOARD_B = "board_delivery";
/** Tenant leads the key — see poc-workstream-routing for the aliasing case. */
const TENANT = "tenant_a";

/**
 * Keyed `(parentSessionId, boardId, assignee, topic)`.
 *
 * `assignee` rather than `flowKind` because it is authored and already
 * validated, so a refactor cannot silently re-key a live Workstream. But
 * `assignee` is scoped *within* a registry — which is exactly why it is
 * ambiguous *across* registries, and why `boardId` is required rather than
 * optional. An earlier draft argued board-scoping made `boardId` unnecessary;
 * that inverted the implication, and the two-board test below is the
 * counterexample.
 */
async function routeToWorkstream(
  stores: StoreRegistry,
  parentSessionId: string,
  boardId: string,
  assignee: string,
  topic: string
): Promise<Workstream> {
  const all = (await stores.session.list({ tenantId: TENANT })) as Workstream[];
  const existing = all.find(
    (s) =>
      s.parentSessionId === parentSessionId &&
      s.boardId === boardId &&
      s.assignee === assignee &&
      s.topic === topic
  );
  if (existing !== undefined) return existing;
  const ts = 1_000;
  const created: Workstream = {
    id: `ws_${++seq}`,
    flowKind: "worker",
    userId: "u1",
    tenantId: TENANT,
    state: {},
    version: 0,
    createdAt: ts,
    updatedAt: ts,
    journal: [],
    parentSessionId,
    boardId,
    assignee,
    topic
  };
  await stores.session.set(storageKey(created.id, TENANT), created, "any");
  return created;
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const implementBlock: TaskWorker = handler({
  name: "implement",
  execute: (input: unknown) => `implemented ${(input as TaskWorkerInput).goal}`
}) as unknown as TaskWorker;

const summarizeBlock: TaskWorker = handler({
  name: "summarize",
  execute: (input: unknown) => `summarized ${(input as TaskWorkerInput).goal}`
}) as unknown as TaskWorker;

/** What the coordinator produces: `addTask({ goal, assignee, topic })`. */
function taskInput(taskId: string, goal: string, topic?: string): TaskWithTopic {
  return { taskId, goal, attempts: 0, ...(topic === undefined ? {} : { topic }) };
}

/** The surface a board author writes. */
const board: BoardConfig = {
  workers: {
    // Bare block — the shape that ships today. Still inline.
    summarize: summarizeBlock,

    // Object form — same registry, plus disposition.
    implement: {
      worker: implementBlock,
      dispatch: { mode: "detached" }
    }
  },
  defaultWorker: summarizeBlock
};

describe("POC: board worker config — disposition, not target", () => {
  it("a bare worker value still means inline (BP-030: old boards unchanged)", () => {
    const { worker, dispatch } = resolveDispatch(board, "summarize");
    expect(dispatch).toEqual({ mode: "inline" });
    expect(worker).toBe(summarizeBlock);
  });

  it("per-worker disposition overrides the board default", () => {
    const detachedByDefault: BoardConfig = {
      ...board,
      dispatch: { mode: "detached" }
    };
    // `summarize` is bare, so it inherits the board default...
    expect(resolveDispatch(detachedByDefault, "summarize").dispatch.mode).toBe("detached");
    // ...while `implement` carries its own and keeps it.
    expect(resolveDispatch(detachedByDefault, "implement").dispatch.mode).toBe("detached");
  });

  it("an unassigned task runs on the default worker", () => {
    const { worker, dispatch } = resolveDispatch(board, undefined);
    expect(worker).toBe(summarizeBlock);
    expect(dispatch).toEqual({ mode: "inline" });
  });

  it("an unknown assignee routes to the delegation floor, not an error", () => {
    // Shipped behavior: defaultWorker runs any task whose assignee is "unknown
    // or absent". An earlier draft threw here, which would have removed the
    // floor for tasks admitted outside the roster-validated skills path.
    const { worker, coordinate } = resolveDispatch(board, "nope");
    expect(worker).toBe(summarizeBlock);
    expect(coordinate).toBe(UNIFORM_ASSIGNEE);
  });

  it("without a defaultWorker, a registry miss still fails loudly", () => {
    const noFloor: BoardConfig = { workers: { implement: implementBlock } };
    expect(() => resolveDispatch(noFloor, "nope")).toThrow(/unknown_assignee/);
    expect(() => resolveDispatch(noFloor, undefined)).toThrow(/unknown_assignee/);
  });

  it("the LEGACY bare uniform worker (no wrapper) is still supported", () => {
    // `workers: TaskWorker` — the shipping form, no object wrapper. A
    // BlockDefinition has no top-level `execute`, so a presence-based predicate
    // would misread this as a registry and then do an assignee lookup on it.
    const legacy: BoardConfig = { workers: implementBlock };
    const r = resolveDispatch(legacy, undefined);
    expect(r.worker).toBe(implementBlock);
    expect(r.dispatch).toEqual({ mode: "inline" });
    expect(r.coordinate).toBe(UNIFORM_ASSIGNEE);
    // ...and it honours a board-level detached default.
    expect(resolveDispatch({ workers: implementBlock, dispatch: { mode: "detached" } }, undefined)
      .dispatch.mode).toBe("detached");
  });

  it("a registry with an assignee named `worker` is NOT read as the wrapper form", () => {
    const tricky: BoardConfig = { workers: { worker: summarizeBlock, implement: implementBlock } };
    expect(resolveDispatch(tricky, "worker").worker).toBe(summarizeBlock);
    expect(resolveDispatch(tricky, "implement").worker).toBe(implementBlock);
  });

  it("a single uniform worker board is supported, and gets a stable coordinate", () => {
    // `workers: TaskWorker | TaskWorkerRegistry` is the shipping union. A
    // uniform worker has no assignee, so the key needs a reserved coordinate.
    const uniform: BoardConfig = {
      workers: { worker: implementBlock, dispatch: { mode: "detached" } }
    };
    const a = resolveDispatch(uniform, undefined);
    const b = resolveDispatch(uniform, "anything");
    expect(a.worker).toBe(implementBlock);
    expect(a.dispatch.mode).toBe("detached");
    // Every task on the board resolves to one coordinate, so they share a
    // Workstream per topic rather than fragmenting by an assignee that is absent.
    expect(a.coordinate).toBe(UNIFORM_ASSIGNEE);
    expect(b.coordinate).toBe(UNIFORM_ASSIGNEE);
  });

  it("the SAME block runs inline or detached — disposition is orthogonal", () => {
    const inlineBoard: BoardConfig = { workers: { impl: implementBlock } };
    const detachedBoard: BoardConfig = {
      workers: { impl: { worker: implementBlock, dispatch: { mode: "detached" } } }
    };
    // One block definition, two dispositions, no change to the block.
    expect(resolveDispatch(inlineBoard, "impl").worker).toBe(
      resolveDispatch(detachedBoard, "impl").worker
    );
    expect(resolveDispatch(inlineBoard, "impl").dispatch.mode).toBe("inline");
    expect(resolveDispatch(detachedBoard, "impl").dispatch.mode).toBe("detached");
  });

  it("topic derivation gives continuity — two tasks, one issue, one Workstream", async () => {
    const stores = createInMemoryStores();
    const { dispatch } = resolveDispatch(board, "implement");

    const a = taskInput("t1", "write the parser", "FIX-981");
    const b = taskInput("t2", "fix the parser bug", "FIX-981");
    const c = taskInput("t3", "unrelated work", "FIX-982");

    const wsA = await routeToWorkstream(stores, "S", BOARD_A, "implement", resolveTopic(dispatch, a));
    const wsB = await routeToWorkstream(stores, "S", BOARD_A, "implement", resolveTopic(dispatch, b));
    const wsC = await routeToWorkstream(stores, "S", BOARD_A, "implement", resolveTopic(dispatch, c));

    expect(wsB.id).toBe(wsA.id); // same issue → same Workstream
    expect(wsC.id).not.toBe(wsA.id); // different issue → its own
    expect(wsA.topic).toBe("FIX-981");
  });

  it("with no topic named, each task gets its own Workstream — no accidental continuity", async () => {
    const stores = createInMemoryStores();
    const bare: BoardConfig = {
      workers: { impl: { worker: implementBlock, dispatch: { mode: "detached" } } }
    };
    const { dispatch } = resolveDispatch(bare, "impl");

    const a = taskInput("t1", "one");
    const b = taskInput("t2", "two");
    expect(resolveTopic(dispatch, a)).toBe("t1");

    const wsA = await routeToWorkstream(stores, "S", BOARD_A, "impl", resolveTopic(dispatch, a));
    const wsB = await routeToWorkstream(stores, "S", BOARD_A, "impl", resolveTopic(dispatch, b));
    expect(wsA.id).not.toBe(wsB.id);
  });

  it("boardId is REQUIRED in the key — two boards, same assignee and topic", async () => {
    const stores = createInMemoryStores();

    // Both boards legitimately declare an `implement` worker; the coordinator
    // files FIX-981 on each. `assignee` is unique only WITHIN a registry, so a
    // 3-part key `(parent, assignee, topic)` would return one Workstream for
    // both — mixing two boards' histories, and leaving the executor unable to
    // tell which registry supplies the worker.
    const a = await routeToWorkstream(stores, "S", BOARD_A, "implement", "FIX-981");
    const b = await routeToWorkstream(stores, "S", BOARD_B, "implement", "FIX-981");

    expect(a.id).not.toBe(b.id);
    expect(a.boardId).toBe(BOARD_A);
    expect(b.boardId).toBe(BOARD_B);

    // The 3-part key these two would have shared — the counterexample, stated.
    const threePartKey = (w: Workstream) => `${w.parentSessionId}|${w.assignee}|${w.topic}`;
    expect(threePartKey(a)).toBe(threePartKey(b));

    // ...and each still round-trips to its own board.
    expect((await routeToWorkstream(stores, "S", BOARD_A, "implement", "FIX-981")).id).toBe(a.id);
    expect((await routeToWorkstream(stores, "S", BOARD_B, "implement", "FIX-981")).id).toBe(b.id);
  });

  it("assignee is part of the key — two workers, one topic, two Workstreams", async () => {
    const stores = createInMemoryStores();
    const research = await routeToWorkstream(stores, "S", BOARD_A, "research", "FIX-981");
    const implement = await routeToWorkstream(stores, "S", BOARD_A, "implement", "FIX-981");
    expect(research.id).not.toBe(implement.id);

    // ...and each round-trips to itself.
    expect((await routeToWorkstream(stores, "S", BOARD_A, "research", "FIX-981")).id).toBe(research.id);
  });
});
