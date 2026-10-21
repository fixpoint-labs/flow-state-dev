/**
 * The dispatch substitution on the drain, and its payload gate (FIX-982 P3a).
 *
 * Two properties are pinned here, and both are ones whose failure is silent.
 *
 * The first is that a dispatched assignee does not route to its worker. If it
 * ever does, the board keeps working — the worker runs, the task settles,
 * every existing test passes — and the dispatch simply never happens. That is
 * the failure this whole issue exists to remove, so a behavioural assertion
 * that only checked "no error" would pass against exactly that bug (running
 * the worker inline looks like success). What makes the check decisive is
 * observing WHICH path ran: the dispatch seam, or the worker's own body.
 *
 * That has to be driven through the real engine rather than read off
 * `board.drain`'s static structure: the drain's worker pool is built by
 * `.forEach`, whose per-item block is a runtime factory
 * (`(workerId) => makeWorker(workerId)`), never a statically-registered
 * child — so it never joins `childBlocks`, and nothing about the
 * substitution is visible to a definition-time walk. `board.dispatchers` (a
 * plain value, not a walk) is what a definition-time check *can* see, and it
 * is enough to prove assignee-level keying is correct; only running the drain
 * proves the ROUTE itself dispatches instead of executing inline.
 *
 * The second property is the JSON-safety gate. Its whole reason to exist is
 * that the obvious check does not catch anything: a round-trip mangles a
 * Date, a Map and a class instance without throwing, so the values below have
 * to be rejected BY NAME or the gate is decorative.
 */
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { defineFlow, defineResource, dispatcher, handler } from "@flow-state-dev/core";
import { createInMemoryStores, runAction } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { z } from "zod";
import { taskBoard } from "../../src/task-board";
import { defineTaskCollection, type TaskWorker, type TaskWorkerInput } from "../../src/tasks";
import { assertJsonSafe } from "../../src/task-board/blocks/json-safe";
import { heard } from "../fixtures/heard";

const USER_ID = "u_dispatch_routing";

function worker(name: string) {
  return handler({
    name,
    inputSchema: z.unknown(),
    execute: (_input: TaskWorkerInput) => ({ done: true }),
  });
}

/** A fresh durable ledger per test — dispatch requires a resource backing. */
function ledger() {
  return defineTaskCollection({ id: "dispatch-tasks", scope: "user" });
}

/** An assignee that dispatches to the task entry `target`. */
function assignee(target: string) {
  return dispatcher({ name: `assignee-${target}`, type: "task", action: target, session: "per-task" }) as unknown as TaskWorker;
}

describe("a dispatched assignee routes to the dispatch seam, not to the worker", () => {
  it("keeps the worker off the drain's routing table", async () => {
    const implementSpy = vi.fn(() => ({ done: true }));
    const implement = handler({
      name: "implement",
      inputSchema: z.unknown(),
      execute: implementSpy,
    }) as unknown as TaskWorker;

    const board = taskBoard({
      name: "issue-work",
      boardId: "issue-work",
      mode: "delegation",
      collection: ledger(),
      workers: { implement: assignee("implement") },
      initialTasks: [{ id: "t1", goal: "implement it", assignee: "implement" }],
    });

    const dispatched: { action: string; sessionId: string; source: string }[] = [];
    const flow = defineFlow({ internal: { actions: { ...heard } },
      kind: "dispatch-routing-table",
      actions: { run: { block: board.drain } },
      task: { actions: { implement: { block: implement } } },
    })({ id: "dispatch-routing-table" });

    const result = await runAction({
    orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "run",
      input: {},
      userId: USER_ID,
      sessionId: "s_parent",
      stores: createInMemoryStores(),
      runtimeConfig: {
        // This worker is a handler, not a generator — it resolves no model.
        modelResolver: createMockModelResolver({}),
        requestHost: {
          dispatchOperation: async (spec) => {
            dispatched.push({ action: spec.action, sessionId: spec.sessionId, source: spec.source });
            return { requestId: "req_child" };
          },
        },
      },
    });

    expect(result.error).toBeUndefined();
    // The route taken: a task dispatch to the "implement" entry...
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({ action: "implement", source: "task" });
    // ...and NOT a call into the worker's own body. A regression that put the
    // worker back on the routing table would still resolve `result.error` as
    // undefined — this is the assertion that actually catches it.
    expect(implementSpy).not.toHaveBeenCalled();
  });

  it("still installs a resource only the dispatched entry block declares", () => {
    // The block is off the drain's routing table, so a resource
    // it declares is no longer reachable through `board.drain` — it bubbles
    // through the gated task entry instead, which is why the entry has to be
    // on the flow for it to show up at all.
    const auditLog = defineResource({
      scope: "user",
      stateSchema: z.object({ entries: z.array(z.unknown()) }),
      default: { entries: [] },
    });
    const implement = handler({
      name: "implement-with-resource",
      inputSchema: z.unknown(),
      resources: { auditLog },
      execute: () => ({ done: true }),
    });

    const board = taskBoard({
      name: "resourceful",
      boardId: "resourceful",
      mode: "delegation",
      collection: ledger(),
      workers: { implement: assignee("implement") },
    });

    const flow = defineFlow({ internal: { actions: { ...heard } },
      kind: "board",
      actions: { run: { block: board.drain } },
      task: { actions: { implement: { block: implement } } },
    } as never)({ id: "board" });

    expect(Object.keys(flow.resources ?? {})).toContain("auditLog");
  });

  it("leaves an inline board's routing untouched", () => {
    // The substitution must be invisible to every board that dispatches
    // nothing, or this change would alter every existing board in the
    // codebase.
    const summarize = worker("summarize");
    const board = taskBoard({
      name: "inline-board",
      workers: { summarize },
    });

    expect(board.dispatchers).toHaveLength(0);
  });
});

describe("the dispatch payload gate rejects what a round-trip would mangle", () => {
  const label = "payload";

  it("accepts an ordinary JSON payload", () => {
    expect(() =>
      assertJsonSafe(
        { taskId: "t1", goal: "ship it", deps: { a: [1, "two", null, { b: true }] } },
        { label }
      )
    ).not.toThrow();
  });

  it("rejects a Date, which would silently arrive as a string", () => {
    expect(() => assertJsonSafe({ when: new Date() }, { label })).toThrow(/\.when is a Date/);
  });

  it("rejects a Map, which would silently arrive as {}", () => {
    expect(() => assertJsonSafe({ index: new Map() }, { label })).toThrow(/\.index is a Map/);
  });

  it("rejects a class instance, which would arrive without its methods", () => {
    class Cursor {
      constructor(readonly at: number) {}
      next() {
        return this.at + 1;
      }
    }
    expect(() => assertJsonSafe({ cursor: new Cursor(1) }, { label })).toThrow(
      /\.cursor is a Cursor instance/
    );
  });

  it("rejects undefined in object position, which would drop the key entirely", () => {
    expect(() => assertJsonSafe({ feedback: undefined }, { label })).toThrow(
      /\.feedback is undefined.*dropped entirely/s
    );
  });

  it("rejects a function", () => {
    expect(() => assertJsonSafe({ retry: () => null }, { label })).toThrow(
      /\.retry is a function/
    );
  });

  it("rejects NaN, which serializes to null", () => {
    expect(() => assertJsonSafe({ score: Number.NaN }, { label })).toThrow(
      /\.score is NaN.*serializes to null/s
    );
  });

  it("rejects a BigInt", () => {
    expect(() => assertJsonSafe({ size: 1n }, { label })).toThrow(/\.size is a BigInt/);
  });

  it("names the path to a value buried in a dependency's output", () => {
    // The path is the point: the offending value is usually several levels
    // inside something another worker authored, and "not JSON-safe" alone
    // leaves the author with nothing to look at.
    expect(() =>
      assertJsonSafe({ deps: { upstream: { rows: [{ at: new Date() }] } } }, { label })
    ).toThrow(/\.deps\.upstream\.rows\[0\]\.at is a Date/);
  });

  it("rejects a cycle rather than recursing forever", () => {
    const node: Record<string, unknown> = { id: "a" };
    node.self = node;
    expect(() => assertJsonSafe(node, { label })).toThrow(/contains itself/);
  });

  it("rejects a hole in a sparse array, which serializes to null", () => {
    // `forEach` SKIPS holes, so the obvious walk accepts this and the worker
    // receives `[null, 2]` where the author wrote a hole — a silent change to
    // the input, which is the class this gate exists for.
    const sparse: unknown[] = [];
    sparse[1] = 2;
    expect(() => assertJsonSafe({ rows: sparse }, { label })).toThrow(
      /\.rows\[0\] is a hole in a sparse array/
    );
  });

  it("rejects a symbol-keyed property, which vanishes with no trace", () => {
    // Invisible to `Object.entries` AND to `JSON.stringify`, so the walk would
    // never look at it and the value would arrive `{}` with nothing saying a
    // property was dropped.
    expect(() => assertJsonSafe({ auth: { [Symbol("token")]: "x" } }, { label })).toThrow(
      /\.auth has symbol-keyed property/
    );
  });

  it("rejects a non-enumerable property, which vanishes with no trace", () => {
    // `Object.entries` does not see it and neither does `JSON.stringify`, so
    // the walk would never look at it and the value would arrive `{}` with
    // nothing saying a property was dropped — the symbol-key failure in a
    // different spelling.
    const auth: Record<string, unknown> = {};
    Object.defineProperty(auth, "token", { value: "secret", enumerable: false });
    expect(() => assertJsonSafe({ auth }, { label })).toThrow(
      /\.auth\.token is a non-enumerable property/
    );
  });

  it("rejects an accessor, because serialization reads it a second time", () => {
    // The walk validates what the getter returns NOW; `JSON.stringify` calls it
    // again and ships whatever it returns THEN. Nothing makes the two agree, so
    // a gate that accepted this would be checking a value that never crossed.
    let reads = 0;
    const payload = {
      auth: {
        get token() {
          reads += 1;
          return reads === 1 ? "safe" : new Date();
        },
      },
    };
    expect(() => assertJsonSafe(payload, { label })).toThrow(
      /\.auth\.token is an accessor property/
    );
  });

  it("rejects a non-writable property, which arrives writable", () => {
    // The value survives and the ATTRIBUTE does not: `JSON.parse` rebuilds every
    // property as an ordinary one, so a payload the author made read-only before
    // sending is mutable on the other side. Nothing anywhere says the guarantee
    // was dropped — the same silent change as the branches above, one level down
    // from the value.
    const auth: Record<string, unknown> = {};
    Object.defineProperty(auth, "token", {
      value: "secret",
      writable: false,
      enumerable: true,
      configurable: true,
    });
    expect(() => assertJsonSafe({ auth }, { label })).toThrow(
      /\.auth\.token is a non-writable property/
    );
  });

  it("rejects a non-configurable property, which arrives configurable", () => {
    // Same class as non-writable: the round trip hands back a property that can
    // be redefined and deleted, where the one that was sent could not be.
    const auth: Record<string, unknown> = {};
    Object.defineProperty(auth, "token", {
      value: "secret",
      writable: true,
      enumerable: true,
      configurable: false,
    });
    expect(() => assertJsonSafe({ auth }, { label })).toThrow(
      /\.auth\.token is a non-configurable property/
    );
  });

  it("rejects a frozen array's elements, checked like any other property", () => {
    // An array's indices are properties, and freezing sets both flags on each of
    // them. A gate that judged only objects would let a frozen array cross and
    // arrive fully mutable.
    expect(() => assertJsonSafe({ rows: Object.freeze([1, 2]) }, { label })).toThrow(
      /\.rows\.0 is a non-writable property/
    );
  });

  it("accepts a non-enumerable property that is an array's own length", () => {
    // `length` is non-enumerable by specification rather than by anyone's
    // declaration, and it is not dropped — it IS the array. Rejecting it would
    // refuse every array the gate ever sees.
    expect(() => assertJsonSafe({ rows: [1, 2, 3] }, { label })).not.toThrow();
  });

  it("rejects an array's non-index properties, dropped the same way", () => {
    const rows: unknown[] & { total?: number } = [1, 2];
    rows.total = 2;
    expect(() => assertJsonSafe({ rows }, { label })).toThrow(
      /\.rows is an array carrying non-index property \(total\)/
    );
  });

  it("rejects negative zero, which serializes to 0", () => {
    expect(() => assertJsonSafe({ delta: -0 }, { label })).toThrow(/\.delta is -0/);
  });

  it("rejects a null-prototype object, which arrives with Object.prototype", () => {
    // The same identity loss the class-instance branch rejects, running the
    // other way: the data survives and the prototype does not. `Object.create(
    // null)` is a real idiom for a dictionary that cannot collide with
    // inherited keys, and on the far side it is an ordinary object again —
    // `hasOwnProperty` goes from `undefined` to a function, and a key lookup
    // that could never hit `Object.prototype` now can.
    const dict: Record<string, unknown> = Object.create(null);
    dict.token = "x";
    expect(() => assertJsonSafe({ dict }, { label })).toThrow(
      /\.dict has a null prototype/
    );
  });

  it("names what to do about it, since the remedy is one spread", () => {
    expect(() => assertJsonSafe({ dict: Object.create(null) }, { label })).toThrow(
      /\{ \.\.\.value \}/
    );
  });

  it("still accepts an ordinary object literal", () => {
    // The control. A guard keyed on "not Object.prototype" rather than on
    // "null prototype" would reject every payload the gate exists to pass.
    expect(() => assertJsonSafe({ dict: { token: "x" } }, { label })).not.toThrow();
  });

  it("accepts the same object appearing twice on separate branches", () => {
    // Not a cycle — it round-trips as two copies. Tracking every object seen
    // rather than the current path would reject this legitimate shape.
    const shared = { kind: "note" };
    expect(() => assertJsonSafe({ left: shared, right: shared }, { label })).not.toThrow();
  });
});
