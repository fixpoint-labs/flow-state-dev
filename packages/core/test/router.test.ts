import { describe, expect, it } from "vitest";
import { handler, router, utility } from "../src";
import { createMockContext, runForTest } from "./helpers";
describe("router builder", () => {
  it("executes selected route", async () => {
    const low = handler({
      name: "low",
      execute: () => "low"
    });
    const high = handler({
      name: "high",
      execute: () => "high"
    });

    const block = router({
      name: "route",
      routes: [low, high],
      execute: (value) => (value < 10 ? low : high)
    });

    const ctx = createMockContext();
    await expect(runForTest(block, 3, ctx)).resolves.toBe("low");
    await expect(runForTest(block, 20, ctx)).resolves.toBe("high");
  });

  it("throws when selected route is not in declared candidates", async () => {
    const inRoutes = handler({
      name: "in-routes",
      execute: () => "ok"
    });
    const rogue = handler({
      name: "rogue",
      execute: () => "rogue"
    });

    const block = router({
      name: "route-validation",
      routes: [inRoutes],
      execute: () => rogue
    });

    const ctx = createMockContext();
    await expect(runForTest(block, 1, ctx)).rejects.toThrow("invalid route");
  });

  it("uses validateRoute override when provided", async () => {
    const routeA = handler({
      name: "a",
      execute: () => "a"
    });

    const block = router({
      name: "custom-validator",
      routes: [routeA],
      execute: () => routeA,
      validateRoute: () => false
    });

    const ctx = createMockContext();
    await expect(runForTest(block, 1, ctx)).rejects.toThrow("invalid route");
  });

  it("throws when selected route has no run method", async () => {
    const valid = handler({
      name: "valid",
      execute: () => "ok"
    });

    // FIX-503: substrate dispatch entry is `run` (was `run` before the
    // BP-011 type firewall). Strip it to simulate a misshapen route.
    const missingRun = {
      ...valid,
      name: "missing-run",
      run: undefined
    };

    const block = router({
      name: "missing-run-route",
      routes: [valid, missingRun as unknown as typeof valid],
      execute: () => missingRun as unknown as typeof valid
    });

    const ctx = createMockContext();
    await expect(runForTest(block, 1, ctx)).rejects.toThrow("not a function");
  });
});

describe("utility.keyedRouter", () => {
  it("dispatches to the block keyed by select()", async () => {
    const alpha = handler({ name: "alpha", execute: () => "A" });
    const beta = handler({ name: "beta", execute: () => "B" });

    const block = utility.keyedRouter({
      name: "by-name",
      blocks: { alpha, beta },
      select: (input: { which: string }) => input.which,
    });

    const ctx = createMockContext();
    await expect(runForTest(block, { which: "alpha" }, ctx)).resolves.toBe("A");
    await expect(runForTest(block, { which: "beta" }, ctx)).resolves.toBe("B");
  });

  it("allows two keys to alias the same block (FIX-814 uniqueness tolerates reference-equal routes)", async () => {
    const shared = handler({ name: "shared", execute: () => "S" });

    const block = utility.keyedRouter({
      name: "aliased",
      blocks: { alice: shared, bob: shared },
      select: (input: { which: string }) => input.which,
    });

    const ctx = createMockContext();
    await expect(runForTest(block, { which: "alice" }, ctx)).resolves.toBe("S");
    await expect(runForTest(block, { which: "bob" }, ctx)).resolves.toBe("S");
  });

  it("throws with the registered key list when no match and no fallback", async () => {
    const alpha = handler({ name: "alpha", execute: () => "A" });
    const beta = handler({ name: "beta", execute: () => "B" });

    const block = utility.keyedRouter({
      name: "missing-key",
      blocks: { alpha, beta },
      select: (input: { which: string }) => input.which,
    });

    const ctx = createMockContext();
    await expect(runForTest(block, { which: "gamma" }, ctx)).rejects.toThrow(
      /no block registered under key "gamma"[\s\S]*Available: alpha, beta/,
    );
  });

  it("uses fallback when select() returns an unregistered key", async () => {
    const alpha = handler({ name: "alpha", execute: () => "A" });
    const otherwise = handler({ name: "otherwise", execute: () => "X" });

    const block = utility.keyedRouter({
      name: "with-fallback",
      blocks: { alpha },
      fallback: otherwise,
      select: (input: { which: string }) => input.which,
    });

    const ctx = createMockContext();
    await expect(runForTest(block, { which: "alpha" }, ctx)).resolves.toBe("A");
    await expect(runForTest(block, { which: "anything-else" }, ctx)).resolves.toBe("X");
  });

  // `blocks` is a caller-supplied plain object, so `blocks[key]` alone would
  // resolve an inherited Object.prototype member as if it were a registered
  // route. `select` is fed runtime data (a model's chosen name, a task's
  // `assignee`), so these keys are reachable — they must miss like any other
  // unknown key, not be dispatched as a non-block.
  const PROTO_KEYS = ["toString", "constructor", "valueOf", "hasOwnProperty", "__proto__"];

  it.each(PROTO_KEYS)(
    "treats the Object.prototype member %s as an unregistered key (falls back)",
    async (protoKey) => {
      const alpha = handler({ name: "alpha", execute: () => "A" });
      const otherwise = handler({ name: "otherwise", execute: () => "X" });

      const block = utility.keyedRouter({
        name: "proto-key-fallback",
        blocks: { alpha },
        fallback: otherwise,
        select: (input: { which: string }) => input.which,
      });

      const ctx = createMockContext();
      await expect(runForTest(block, { which: protoKey }, ctx)).resolves.toBe("X");
    },
  );

  it.each(PROTO_KEYS)(
    "raises the registered-key error for the Object.prototype member %s when there is no fallback",
    async (protoKey) => {
      const alpha = handler({ name: "alpha", execute: () => "A" });

      const block = utility.keyedRouter({
        name: "proto-key-throw",
        blocks: { alpha },
        select: (input: { which: string }) => input.which,
      });

      const ctx = createMockContext();
      await expect(runForTest(block, { which: protoKey }, ctx)).rejects.toThrow(
        new RegExp(`no block registered under key "${protoKey.replace("$", "\\$")}"`),
      );
    },
  );

  it("propagates errors thrown from select() without wrapping", async () => {
    const alpha = handler({ name: "alpha", execute: () => "A" });

    const block = utility.keyedRouter({
      name: "select-throws",
      blocks: { alpha },
      select: () => {
        throw new Error("select bailed");
      },
    });

    const ctx = createMockContext();
    await expect(runForTest(block, undefined, ctx)).rejects.toThrow("select bailed");
  });
});
