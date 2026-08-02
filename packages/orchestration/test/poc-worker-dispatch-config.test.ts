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
type TaskWithTopic = TaskWorkerInput & {
  topic?: string;
  /**
   * `assignee` is on `Task`, not on `TaskWorkerInput` — the board reads it to
   * pick the worker and then packs the worker's input without it
   * (`workers/types.ts:26-71`). It is carried here because routing happens on
   * the dispatch side of that boundary, and it is optional for the same reason
   * the delegation floor exists: a task may legitimately arrive with none.
   */
  assignee?: string;
};

/**
 * Registry value. A bare `TaskWorker` is the shape that ships today and keeps
 * meaning "inline"; the object form adds disposition without a second registry.
 */
type WorkerEntry = TaskWorker | { worker: TaskWorker; dispatch: WorkerDispatch };

/**
 * The shipping shape is a UNION — `workers: TaskWorker | TaskWorkerRegistry`
 * (`task-board/index.ts:288`). A single uniform worker has no assignee, so it
 * has no natural key coordinate.
 *
 * It gets a **tagged** coordinate, not a reserved string. Assignees are unrestricted
 * strings, so a registry may legally declare one named `__uniform__` — and on a
 * board that also has a `defaultWorker`, that authored worker and every
 * absent/unknown-assignee task would then share a Workstream key, routing two
 * different workers into one history. A tagged form cannot collide with any
 * authored name.
 */
type Coordinate =
  | { kind: "assignee"; name: string }
  | { kind: "uniform" }
  | { kind: "floor" };

const UNIFORM: Coordinate = { kind: "uniform" };
/**
 * The delegation floor is its OWN coordinate rather than reusing `uniform`.
 * The two can't coexist on one board — a uniform board has no registry to miss
 * — so sharing a key would be safe, but it would be a lie: a debug tool reading
 * the Workstream record could not tell a board that declares one worker from a
 * board where an assignee failed to resolve, and those want different
 * attention (N11's mutable-assignee case is exactly the second one).
 */
const FLOOR: Coordinate = { kind: "floor" };

/** Stable serialization for the Workstream key. `a:` can never equal `u` or `f`. */
const coordinateKey = (c: Coordinate) =>
  c.kind === "assignee" ? `a:${c.name}` : c.kind === "uniform" ? "u" : "f";

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
const BLOCK_KINDS = new Set(["handler", "generator", "sequencer", "router"]);

function isBareWorker(w: unknown): w is TaskWorker {
  if (typeof w !== "object" || w === null) return false;
  const o = w as { kind?: unknown; config?: unknown };
  // Check VALUES, not key presence. A registry whose assignees are literally
  // named `kind` and `config` satisfies a presence test, and would then be
  // invoked as if it were the block itself. `kind` is one of the four block
  // kinds (an architectural constant), and `config` is an object.
  return (
    typeof o.kind === "string" &&
    BLOCK_KINDS.has(o.kind) &&
    typeof o.config === "object" &&
    o.config !== null
  );
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
  coordinate: Coordinate;
} {
  // Uniform-worker board: every task runs the one worker, under the sentinel.
  if (!isRegistry(config.workers)) {
    const entry = config.workers;
    return {
      worker: entryWorker(entry),
      dispatch: entryDispatch(entry) ?? config.dispatch ?? INLINE,
      coordinate: UNIFORM
    };
  }

  const hit = assignee === undefined ? undefined : config.workers[assignee];
  if (hit !== undefined) {
    return {
      worker: entryWorker(hit),
      dispatch: entryDispatch(hit) ?? config.dispatch ?? INLINE,
      coordinate: { kind: "assignee", name: assignee! }
    };
  }

  // Miss — unknown OR absent — routes to the delegation floor when present.
  if (config.defaultWorker !== undefined) {
    return {
      worker: entryWorker(config.defaultWorker),
      dispatch: entryDispatch(config.defaultWorker) ?? config.dispatch ?? INLINE,
      // The floor's own coordinate, so its Workstream is not keyed under a name
      // that resolves to a different worker.
      coordinate: FLOOR
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

/**
 * The routing field is `coordinate` — `coordinateKey(...)` of whatever
 * `resolveDispatch` returned — NOT the raw assignee string. A uniform-worker
 * board and a floor-routed task both have no assignee at all, so a key built
 * from `assignee` cannot express them; keying on the coordinate makes those two
 * cases route rather than being special-cased at the call site.
 *
 * `assignee` is retained alongside it as the human-readable label, and is
 * `undefined` exactly when the coordinate is `uniform` — a Workstream that
 * carries a fabricated assignee it was never given would misreport its own
 * provenance in a debug tool.
 */
type Workstream = SessionRecord & {
  parentSessionId?: string;
  boardId?: string;
  coordinate?: string;
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
 * Keyed `(parentSessionId, boardId, coordinate, topic)`.
 *
 * The coordinate derives from `assignee` rather than `flowKind` because the
 * assignee is authored and already validated, so a refactor cannot silently
 * re-key a live Workstream. But `assignee` is scoped *within* a registry —
 * which is exactly why it is ambiguous *across* registries, and why `boardId`
 * is required rather than optional. An earlier draft argued board-scoping made
 * `boardId` unnecessary; that inverted the implication, and the two-board test
 * below is the counterexample.
 *
 * The parameter is the `Coordinate` `resolveDispatch` returned, not a raw
 * string, so the uniform-worker and delegation-floor paths reach routing as
 * themselves instead of the caller inventing a name for them.
 */
async function routeToWorkstream(
  stores: StoreRegistry,
  parentSessionId: string,
  boardId: string,
  coordinate: Coordinate,
  topic: string
): Promise<Workstream> {
  const ckey = coordinateKey(coordinate);
  const all = (await stores.session.list({ tenantId: TENANT })) as Workstream[];
  const existing = all.find(
    (s) =>
      s.parentSessionId === parentSessionId &&
      s.boardId === boardId &&
      s.coordinate === ckey &&
      s.topic === topic
  );
  if (existing !== undefined) return existing;
  const ts = 1_000;
  const publicId = `ws_${++seq}`;
  const created: Workstream = {
    // Record id IS the storage key, matching `id: sessionKey`
    // (`createExecutionContext.ts:584`) — later `setMetadata`/`appendJournal`
    // writes key on `sessionRef.current.id`, so a bare id here would fork a
    // second record and leave the canonical Workstream stale.
    id: storageKey(publicId, TENANT),
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
    coordinate: ckey,
    ...(coordinate.kind === "assignee" ? { assignee: coordinate.name } : {}),
    topic
  };
  await stores.session.set(created.id, created, "any");
  return created;
}

/** The end-to-end call a dispatch makes: resolve, then route on what it resolved. */
async function dispatchAndRoute(
  stores: StoreRegistry,
  config: BoardConfig,
  parentSessionId: string,
  boardId: string,
  task: TaskWithTopic
): Promise<Workstream> {
  const { dispatch, coordinate } = resolveDispatch(config, task.assignee);
  return routeToWorkstream(
    stores,
    parentSessionId,
    boardId,
    coordinate,
    resolveTopic(dispatch, task)
  );
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
function taskInput(
  taskId: string,
  goal: string,
  topic?: string,
  assignee?: string
): TaskWithTopic {
  return {
    taskId,
    goal,
    attempts: 0,
    ...(topic === undefined ? {} : { topic }),
    ...(assignee === undefined ? {} : { assignee })
  };
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
    expect(coordinate).toEqual(FLOOR);
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
    expect(r.coordinate).toEqual(UNIFORM);
    // ...and it honours a board-level detached default.
    expect(resolveDispatch({ workers: implementBlock, dispatch: { mode: "detached" } }, undefined)
      .dispatch.mode).toBe("detached");
  });

  it("an authored assignee cannot collide with the uniform coordinate", () => {
    // `__uniform__` is a legal assignee name. With a tagged coordinate it still
    // cannot collide with the floor's; with a reserved string it would have.
    const board2: BoardConfig = {
      workers: { __uniform__: implementBlock },
      defaultWorker: summarizeBlock
    };
    const authored = resolveDispatch(board2, "__uniform__");
    const floor = resolveDispatch(board2, "not-declared");

    expect(authored.worker).toBe(implementBlock);
    expect(floor.worker).toBe(summarizeBlock);
    expect(coordinateKey(authored.coordinate)).not.toBe(coordinateKey(floor.coordinate));
    expect(coordinateKey(authored.coordinate)).toBe("a:__uniform__");
    expect(coordinateKey(floor.coordinate)).toBe("f");
  });

  it("a registry with assignees named `kind` and `config` is NOT read as a block", () => {
    // A key-presence discriminator would classify this registry as one uniform
    // TaskWorker and then invoke the registry object instead of the block.
    const tricky: BoardConfig = { workers: { kind: summarizeBlock, config: implementBlock } };
    expect(resolveDispatch(tricky, "kind").worker).toBe(summarizeBlock);
    expect(resolveDispatch(tricky, "config").worker).toBe(implementBlock);
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
    expect(a.coordinate).toEqual(UNIFORM);
    expect(b.coordinate).toEqual(UNIFORM);
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

    const a = taskInput("t1", "write the parser", "FIX-981", "implement");
    const b = taskInput("t2", "fix the parser bug", "FIX-981", "implement");
    const c = taskInput("t3", "unrelated work", "FIX-982", "implement");

    const wsA = await dispatchAndRoute(stores, board, "S", BOARD_A, a);
    const wsB = await dispatchAndRoute(stores, board, "S", BOARD_A, b);
    const wsC = await dispatchAndRoute(stores, board, "S", BOARD_A, c);

    expect(wsB.id).toBe(wsA.id); // same issue → same Workstream
    expect(wsC.id).not.toBe(wsA.id); // different issue → its own
    expect(wsA.topic).toBe("FIX-981");
    expect(wsA.coordinate).toBe("a:implement");
  });

  it("with no topic named, each task gets its own Workstream — no accidental continuity", async () => {
    const stores = createInMemoryStores();
    const bare: BoardConfig = {
      workers: { impl: { worker: implementBlock, dispatch: { mode: "detached" } } }
    };
    const { dispatch } = resolveDispatch(bare, "impl");

    const a = taskInput("t1", "one", undefined, "impl");
    const b = taskInput("t2", "two", undefined, "impl");
    expect(resolveTopic(dispatch, a)).toBe("t1");

    const wsA = await dispatchAndRoute(stores, bare, "S", BOARD_A, a);
    const wsB = await dispatchAndRoute(stores, bare, "S", BOARD_A, b);
    expect(wsA.id).not.toBe(wsB.id);
  });

  it("boardId is REQUIRED in the key — two boards, same assignee and topic", async () => {
    const stores = createInMemoryStores();

    // Both boards legitimately declare an `implement` worker; the coordinator
    // files FIX-981 on each. `assignee` is unique only WITHIN a registry, so a
    // 3-part key `(parent, assignee, topic)` would return one Workstream for
    // both — mixing two boards' histories, and leaving the executor unable to
    // tell which registry supplies the worker.
    const task = taskInput("t1", "work", "FIX-981", "implement");
    const a = await dispatchAndRoute(stores, board, "S", BOARD_A, task);
    const b = await dispatchAndRoute(stores, board, "S", BOARD_B, task);

    expect(a.id).not.toBe(b.id);
    expect(a.boardId).toBe(BOARD_A);
    expect(b.boardId).toBe(BOARD_B);

    // The 3-part key these two would have shared — the counterexample, stated.
    const threePartKey = (w: Workstream) => `${w.parentSessionId}|${w.coordinate}|${w.topic}`;
    expect(threePartKey(a)).toBe(threePartKey(b));

    // ...and each still round-trips to its own board.
    expect((await dispatchAndRoute(stores, board, "S", BOARD_A, task)).id).toBe(a.id);
    expect((await dispatchAndRoute(stores, board, "S", BOARD_B, task)).id).toBe(b.id);
  });

  it("assignee is part of the key — two workers, one topic, two Workstreams", async () => {
    const stores = createInMemoryStores();
    const twoDetached: BoardConfig = {
      workers: { research: summarizeBlock, implement: implementBlock },
      dispatch: { mode: "detached" }
    };
    const asResearch = taskInput("t1", "work", "FIX-981", "research");
    const asImplement = taskInput("t2", "work", "FIX-981", "implement");

    const research = await dispatchAndRoute(stores, twoDetached, "S", BOARD_A, asResearch);
    const implement = await dispatchAndRoute(stores, twoDetached, "S", BOARD_A, asImplement);
    expect(research.id).not.toBe(implement.id);

    // ...and each round-trips to itself.
    expect((await dispatchAndRoute(stores, twoDetached, "S", BOARD_A, asResearch)).id).toBe(
      research.id
    );
  });

  it("UNIFORM — a uniform-worker board routes every task through one coordinate", async () => {
    const stores = createInMemoryStores();
    const uniform: BoardConfig = {
      workers: { worker: implementBlock, dispatch: { mode: "detached" } }
    };

    // Two tasks on one topic, and neither carries an assignee — there is none
    // to carry. Routing on a raw assignee string cannot express this at all;
    // the tagged coordinate does, and it does so without a reserved name that
    // an author could collide with.
    const a = taskInput("t1", "one", "FIX-981");
    const b = taskInput("t2", "two", "FIX-981");
    const wsA = await dispatchAndRoute(stores, uniform, "S", BOARD_A, a);
    const wsB = await dispatchAndRoute(stores, uniform, "S", BOARD_A, b);

    expect(wsB.id).toBe(wsA.id);
    expect(wsA.coordinate).toBe("u");
    // No assignee is fabricated for a task that never had one.
    expect(wsA.assignee).toBeUndefined();
  });

  it("FLOOR — an unknown assignee routes to the floor's coordinate, not an error", async () => {
    const stores = createInMemoryStores();
    // `defaultWorker` is the shipped delegation floor: it runs any task whose
    // assignee is "unknown or absent" (`task-board/index.ts:290-299`). Detached
    // mode must not convert a floor-routed task into a failure, so the floor
    // needs a coordinate of its own — end to end, not just at resolution.
    const withFloor: BoardConfig = {
      workers: { implement: implementBlock },
      defaultWorker: summarizeBlock,
      dispatch: { mode: "detached" }
    };

    const unknown = taskInput("t1", "one", "FIX-981", "nobody-declares-this");
    const absent = taskInput("t2", "two", "FIX-981");
    const wsUnknown = await dispatchAndRoute(stores, withFloor, "S", BOARD_A, unknown);
    const wsAbsent = await dispatchAndRoute(stores, withFloor, "S", BOARD_A, absent);

    // Both land on the floor, so both share its Workstream for this topic —
    // the floor is one participant, not one per misspelled assignee.
    expect(wsAbsent.id).toBe(wsUnknown.id);
    expect(wsUnknown.coordinate).toBe("f");
    expect(wsUnknown.assignee).toBeUndefined();

    // ...and it is a DIFFERENT Workstream from the declared worker on the same
    // board and topic.
    const declared = await dispatchAndRoute(
      stores,
      withFloor,
      "S",
      BOARD_A,
      taskInput("t3", "three", "FIX-981", "implement")
    );
    expect(declared.id).not.toBe(wsUnknown.id);
    expect(declared.coordinate).toBe("a:implement");
  });

  it("COLLISION — an author's `__uniform__` assignee does not land in the floor's Workstream", async () => {
    const stores = createInMemoryStores();
    const withFloor: BoardConfig = {
      workers: { __uniform__: implementBlock },
      defaultWorker: summarizeBlock,
      dispatch: { mode: "detached" }
    };

    // The reserved-string design would have merged these two. The tagged
    // coordinate keeps them apart all the way to the session record.
    const authored = await dispatchAndRoute(
      stores,
      withFloor,
      "S",
      BOARD_A,
      taskInput("t1", "one", "FIX-981", "__uniform__")
    );
    const floor = await dispatchAndRoute(
      stores,
      withFloor,
      "S",
      BOARD_A,
      taskInput("t2", "two", "FIX-981")
    );

    expect(authored.id).not.toBe(floor.id);
    expect(authored.coordinate).toBe("a:__uniform__");
    expect(floor.coordinate).toBe("f");
  });
});
