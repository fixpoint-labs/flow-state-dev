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
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { taskBoard } from "../../src/task-board";
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

  it("accepts the same object appearing twice on separate branches", () => {
    // Not a cycle — it round-trips as two copies. Tracking every object seen
    // rather than the current path would reject this legitimate shape.
    const shared = { kind: "note" };
    expect(() => assertJsonSafe({ left: shared, right: shared }, { label })).not.toThrow();
  });
});
