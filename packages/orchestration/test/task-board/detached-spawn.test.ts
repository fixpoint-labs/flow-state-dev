/**
 * The spawn substitution and its payload gate (FIX-982 P3a).
 *
 * Two properties are pinned here, and both are ones whose failure is silent.
 *
 * The first is that a detached slot does not route to its worker. If it ever
 * does, the board keeps working — the worker runs, the task settles, every
 * existing test passes — and detachment simply never happens. That is the
 * failure this whole issue exists to remove, so it is asserted structurally
 * rather than by observing a spawn.
 *
 * The second is the JSON-safety gate. Its whole reason to exist is that the
 * obvious check does not catch anything: a round-trip mangles a Date, a Map and
 * a class instance without throwing, so the values below have to be rejected
 * BY NAME or the gate is decorative.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, defineResource, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { taskBoard, coordinateKey } from "../../src/task-board";
import { defineTaskCollection } from "../../src/tasks";
import { assertJsonSafe } from "../../src/task-board/blocks/json-safe";

function worker(name: string) {
  return handler({
    name,
    inputSchema: z.unknown(),
    execute: () => ({ done: true }),
  });
}

function ledger() {
  return defineTaskCollection({ id: "detached-spawn-tasks", scope: "user" });
}

describe("a detached slot routes to the spawn, not to the worker", () => {
  it("keeps the worker off the drain's routing table", () => {
    // Structural, because a behavioural assertion here would pass against the
    // bug: routing to the worker runs it inline and looks like success.
    const implement = worker("implement");
    const board = taskBoard({
      name: "issue-work",
      boardId: "issue-work",
      collection: ledger(),
      workers: { implement: { worker: implement, dispatch: { mode: "detached" } } },
    });

    const binding = [...(board.drain.workstreamBindings?.values() ?? [])][0];
    expect(binding).toBeDefined();
    // The binding still names the real worker — that is what the Workstream
    // runs once it has verified the claim.
    expect(binding!.worker).toBe(implement);
    // ...but the runner the dispatch enters is not the worker itself.
    expect(binding!.runner).not.toBe(implement);
  });

  it("detaches only the coordinate that asked, when one block sits at two", () => {
    // A block may legitimately be registered twice with different dispatch
    // modes. Keying the substitution by block identity detaches BOTH — and the
    // wrongly-detached assignee then fails inside the Workstream, where the gate
    // routes on the row's assignee and finds no binding for it.
    const shared = worker("shared");
    const board = taskBoard({
      name: "mixed-board",
      boardId: "mixed-board",
      collection: ledger(),
      workers: {
        inline: shared,
        background: { worker: shared, dispatch: { mode: "detached" } },
      },
    });

    // Exactly one coordinate detached, and it is the one that declared it.
    expect(board.detachedWorkers).toHaveLength(1);
    expect(board.detachedWorkers[0]!.label).toBe("assignee:background");

    const bindings = [...(board.drain.workstreamBindings?.values() ?? [])];
    expect(bindings).toHaveLength(1);
    expect(bindings[0]!.coordinateKey).toBe(coordinateKey({ kind: "assignee", name: "background" }));
  });

  it("still installs a resource only the detached worker declares", () => {
    // The substitution takes the worker off the drain's routing table, so it is
    // no longer reachable from any action root — and `defineFlow` collects
    // resources from exactly that reachable set. Without folding the board's
    // runner into the collection, a resource declared only by a detached worker
    // vanishes from `flow.resources` and the failure surfaces much later, as an
    // unresolved resource inside the Workstream.
    const auditLog = defineResource({
      name: "detached-audit-log",
      scope: "user",
      load: () => ({ entries: [] }),
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
      collection: ledger(),
      workers: { implement: { worker: implement, dispatch: { mode: "detached" } } },
    });

    const flow = defineFlow({
      kind: "board",
      actions: { run: { block: board.drain } },
    } as never)({ id: "board" });

    expect(Object.keys(flow.resources ?? {})).toContain("auditLog");
  });

  it("leaves an inline board's routing untouched", () => {
    // The substitution must be invisible to every board that declared nothing
    // detached, or this change would alter every existing board in the codebase.
    const summarize = worker("summarize");
    const board = taskBoard({
      name: "inline-board",
      workers: { summarize },
    });

    expect(board.drain.workstreamBindings).toBeUndefined();
    expect(board.detachedWorkers).toHaveLength(0);
  });
});

describe("the detached payload gate rejects what a round-trip would mangle", () => {
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
