/**
 * Unit tests for the built-in `flowPolicy.*` selectors and the
 * observation ledger they read from.
 *
 * Policies operate on a `ObservationLedgerView`, an optional
 * `TaskCollectionRef` and a `Task`. We build all three by hand here so
 * the tests don't drag the Task Board substrate in.
 */
import { describe, expect, it } from "vitest";
import {
  createObservationLedger,
  flowPolicy,
  type Observation,
  type Task,
  type TaskCollectionRef,
} from "../src/index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(id: string, deps?: string[]): Task {
  return {
    id,
    goal: `goal-${id}`,
    status: "completed",
    attempts: 0,
    createdAt: 0,
    updatedAt: 0,
    ...(deps !== undefined ? { deps } : {}),
  };
}

/**
 * Minimal in-memory collection stub. Only implements the two methods
 * the built-in policies actually call (`list({ status })` + `get(id)`).
 * Cast to `TaskCollectionRef` via `any` at the call site.
 */
function makeCollectionStub(tasks: Task[]): TaskCollectionRef {
  const map = new Map(tasks.map((t) => [t.id, t]));
  return {
    list: ({ status }: { status?: string } = {}) =>
      tasks.filter((t) => status === undefined || t.status === status),
    get: (id: string) => map.get(id),
  } as unknown as TaskCollectionRef;
}

/** Build a ledger pre-loaded with 5 observations: 2 from `a`, 2 from `b`, 1 untagged. */
function buildFixtureLedger() {
  const ledger = createObservationLedger();
  ledger.append({ collectionId: "c", taskId: "a", toolName: "t1", args: { i: 1 }, result: "r1", cached: false, ts: 1 });
  ledger.append({ collectionId: "c", taskId: "a", toolName: "t2", args: { i: 2 }, result: "r2", cached: false, ts: 2 });
  ledger.append({ collectionId: "c", taskId: "b", toolName: "t3", args: { i: 3 }, result: "r3", cached: false, ts: 3 });
  ledger.append({ collectionId: "c", taskId: "b", toolName: "t4", args: { i: 4 }, result: "r4", cached: true, ts: 4 });
  ledger.append({ collectionId: "c", toolName: "t5", args: { i: 5 }, result: "r5", cached: false, ts: 5 });
  return ledger;
}

const dummyCtx = {} as never;

describe("flowPolicy.none", () => {
  it("always returns empty observations", async () => {
    const ledger = buildFixtureLedger();
    const result = await flowPolicy.none().select({
      task: makeTask("x", ["a"]),
      ledger: ledger.view(),
      collection: makeCollectionStub([]),
      ctx: dummyCtx,
    });
    expect(result.observations.length).toBe(0);
    expect(result.meta?.policy).toBe("none");
  });
});

describe("flowPolicy.declaredDepsOnly", () => {
  it("returns observations from declared deps", async () => {
    const ledger = buildFixtureLedger();
    const result = await flowPolicy.declaredDepsOnly().select({
      task: makeTask("x", ["a"]),
      ledger: ledger.view(),
      collection: makeCollectionStub([]),
      ctx: dummyCtx,
    });
    expect(result.observations.length).toBe(2);
    expect(result.observations.every((o) => o.taskId === "a")).toBe(true);
    expect(result.meta?.policy).toBe("declaredDepsOnly");
  });

  it("returns empty when the task declares no deps", async () => {
    const ledger = buildFixtureLedger();
    const result = await flowPolicy.declaredDepsOnly().select({
      task: makeTask("x"),
      ledger: ledger.view(),
      collection: makeCollectionStub([]),
      ctx: dummyCtx,
    });
    expect(result.observations.length).toBe(0);
    expect(result.meta?.policy).toBe("declaredDepsOnly");
  });
});

describe("flowPolicy.recentTrajectory", () => {
  it("returns the last N observations", async () => {
    const ledger = buildFixtureLedger();
    const result = await flowPolicy.recentTrajectory({ n: 3 }).select({
      task: makeTask("x"),
      ledger: ledger.view(),
      collection: makeCollectionStub([]),
      ctx: dummyCtx,
    });
    expect(result.observations.length).toBe(3);
    // Chronological, newest last — the fixture ledger has ts 3, 4, 5 as the tail.
    expect(result.observations.map((o) => o.toolName)).toEqual(["t3", "t4", "t5"]);
    expect(result.meta?.policy).toBe("recentTrajectory");
  });
});

describe("flowPolicy.ancestors", () => {
  it("returns observations from declared deps when transitive is false", async () => {
    const ledger = buildFixtureLedger();
    const result = await flowPolicy.ancestors({ transitive: false }).select({
      task: makeTask("x", ["a"]),
      ledger: ledger.view(),
      collection: makeCollectionStub([makeTask("a")]),
      ctx: dummyCtx,
    });
    expect(result.observations.length).toBe(2);
    expect(result.observations.every((o) => o.taskId === "a")).toBe(true);
    expect(result.meta?.policy).toBe("ancestors");
  });
});

describe("flowPolicy.allCompleted", () => {
  it("returns observations from tasks the collection marks completed", async () => {
    const ledger = buildFixtureLedger();
    // Collection marks only `a` as completed — `b`'s observations should be filtered out.
    const collection = makeCollectionStub([makeTask("a")]);
    const result = await flowPolicy.allCompleted().select({
      task: makeTask("x"),
      ledger: ledger.view(),
      collection,
      ctx: dummyCtx,
    });
    expect(result.observations.length).toBe(2);
    expect(result.observations.every((o) => o.taskId === "a")).toBe(true);
    expect(result.meta?.policy).toBe("allCompleted");
  });
});

describe("flowPolicy.custom", () => {
  it("delegates to the supplied selectFn", async () => {
    const ledger = buildFixtureLedger();
    let called = false;
    const result = await flowPolicy
      .custom(({ ledger: lv }) => {
        called = true;
        const all = lv.all() as readonly Observation[];
        return {
          observations: [
            {
              toolName: all[0]!.toolName,
              args: all[0]!.args,
              cached: all[0]!.cached,
              ts: all[0]!.ts,
            },
          ],
          meta: { policy: "custom", selected: 1, available: all.length },
        };
      })
      .select({
        task: makeTask("x"),
        ledger: ledger.view(),
        collection: makeCollectionStub([]),
        ctx: dummyCtx,
      });
    expect(called).toBe(true);
    expect(result.observations.length).toBe(1);
    expect(result.meta?.policy).toBe("custom");
  });
});
