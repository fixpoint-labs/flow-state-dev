/**
 * `queuedGraceMs` is rejected at the configuration boundary when it cannot
 * bound anything (FIX-999).
 *
 * The grace is the ONLY bound on a queued registry entry. `readLiveness` treats
 * a `queuedAt` entry as unconditionally live and defers the bound to the sweep
 * on purpose, and the sweep applies it as
 * `sweepStartedAt - entry.queuedAt > queuedGraceMs`.
 *
 * So a non-finite grace does not degrade the feature, it removes
 * reconciliation entirely: every comparison against `NaN` is `false`, and
 * nothing is `> Infinity`, so a queued row is never selected as stale, never
 * marked `interrupted`, never deregistered — and therefore reads live forever.
 * A job the queue lost after enqueue would sit `in_progress` for the life of
 * the deployment with nothing able to notice. A negative grace fails the other
 * way, reaping every queued row on sight, which is exactly the false negative
 * the grace was added to fix.
 *
 * Neither is a value anyone means. Both are rejected where the host configures
 * them, matching the `Number.isFinite` rejection the `check-interrupted` route
 * already applies to its caller-supplied `staleThresholdMs`.
 *
 * `0` is deliberately legal — "no grace, reap a queued row as soon as it is
 * stale" is a coherent choice, and it is the same shape as
 * `staleSweepIntervalMs: 0` meaning sweeping off.
 */
import { describe, expect, it } from "vitest";
import { createFlowApiRouter, createFlowRegistry, createInMemoryStores } from "../src";
import { DEFAULT_QUEUED_GRACE_MS, resolveStaleSweep } from "../src/runtime-config";

/** Every value that cannot bound a queued entry, and why it is reachable. */
const REJECTED: ReadonlyArray<[label: string, value: number]> = [
  ["NaN", Number.NaN],
  ["Infinity", Number.POSITIVE_INFINITY],
  ["-Infinity", Number.NEGATIVE_INFINITY],
  ["a negative value", -1]
];

describe("resolveStaleSweep — queuedGraceMs validation", () => {
  for (const [label, value] of REJECTED) {
    it(`rejects ${label}`, () => {
      expect(() => resolveStaleSweep({ queuedGraceMs: value })).toThrow(/queuedGraceMs/);
    });
  }

  it("accepts 0 — no grace is a choice, not a mistake", () => {
    expect(resolveStaleSweep({ queuedGraceMs: 0 }).queuedGraceMs).toBe(0);
  });

  it("accepts an ordinary value and still defaults when unset", () => {
    expect(resolveStaleSweep({ queuedGraceMs: 90_000 }).queuedGraceMs).toBe(90_000);
    expect(resolveStaleSweep({}).queuedGraceMs).toBe(DEFAULT_QUEUED_GRACE_MS);
  });
});

describe("the rejection reaches the public hosts", () => {
  it("createFlowApiRouter refuses at construction", () => {
    const registry = createFlowRegistry();
    expect(() =>
      createFlowApiRouter({
        registry,
        stores: createInMemoryStores(),
        queuedGraceMs: Number.NaN
      })
    ).toThrow(/queuedGraceMs/);
  });

  it("OTHER DIRECTION: a well-configured host still builds", () => {
    const registry = createFlowRegistry();
    const router = createFlowApiRouter({
      registry,
      stores: createInMemoryStores(),
      queuedGraceMs: 90_000
    });
    expect(router.POST).toBeTypeOf("function");
  });
});

describe("the premise: a non-finite grace makes the sweep predicate unfalsifiable", () => {
  it("no queued age is ever greater than NaN or Infinity", () => {
    // The exact comparison `detectInterruptedRequests` applies. This is what
    // makes the misconfiguration unbounded rather than merely wrong: the row is
    // never reaped, and `readLiveness` reports an unreaped queued row as live.
    const queuedAgeMs = 365 * 24 * 60 * 60_000; // a year in the queue
    expect(queuedAgeMs > Number.NaN).toBe(false);
    expect(queuedAgeMs > Number.POSITIVE_INFINITY).toBe(false);
    // And the other direction, which reaps everything on sight.
    expect(1 > -1).toBe(true);
  });
});
