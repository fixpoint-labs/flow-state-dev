// FIX-2794.
/**
 * A step's stops on their own, with a fake clock: what they remember after a
 * step they stopped settles, what a harness that never reported an event
 * hears, and which stop a busy harness at its cap ends with.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runStops } from "../src/run-stops";

const WINDOW = 60_000;
const ctx = { request: { identity: { id: "req-1" } } } as Parameters<ReturnType<typeof runStops>["arm"]>[0];

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("runStops: what a stopped step leaves behind", () => {
  // The step's rescue reads the stop's words only on a throw. A step that
  // returned (its harness finished as the stop fired, or swallowed the abort)
  // must not leave them for a later, unrelated failure on the same request to
  // be relabelled as a silence stop.
  it("forgets the stop when the step it fired on returned", () => {
    const stops = runStops(WINDOW, "Claude Code");
    stops.arm(ctx);
    stops.heard(ctx);
    vi.advanceTimersByTime(WINDOW);
    stops.clear(ctx, "returned");
    expect(stops.takeFired("req-1")).toBeUndefined();
  });

  it("keeps the stop for the rescue when the step it fired on threw", () => {
    const stops = runStops(WINDOW, "Claude Code");
    const signal = stops.arm(ctx);
    stops.heard(ctx);
    vi.advanceTimersByTime(WINDOW);
    expect(signal.aborted).toBe(true);
    stops.clear(ctx, "threw");
    expect(stops.takeFired("req-1")).toEqual({ kind: "idle", message: "No output from Claude Code for 1 min; stopped." });
  });
});

describe("runStops: a harness that never reports events", () => {
  // A host that builds a harness's feeds by name and drops `onEvent` gets
  // every run stopped at the window however busy it is. That must be
  // diagnosable from the log, not read as a hung model.
  it("warns, once, when it stops a step whose harness never reported an event", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const stops = runStops(WINDOW, "Claude Code");
    stops.arm(ctx);
    vi.advanceTimersByTime(WINDOW);
    stops.clear(ctx, "threw");
    stops.arm(ctx);
    vi.advanceTimersByTime(WINDOW);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("onEvent");
  });

  it("does not warn when the stopped harness had reported an event", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const stops = runStops(WINDOW, "Claude Code");
    stops.arm(ctx);
    stops.heard(ctx);
    vi.advanceTimersByTime(WINDOW);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("runStops: a cap on run time", () => {
  // A host's cap fires however busy the harness is, and says it was the cap,
  // so the run doesn't end with the harness's aborted error, which reads as a
  // person's stop.
  it("stops a busy step at the cap, in the cap's own words", () => {
    const stops = runStops(WINDOW, "Claude Code", 3 * WINDOW);
    const signal = stops.arm(ctx);
    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(WINDOW / 2);
      stops.heard(ctx);
    }
    expect(signal.aborted).toBe(true);
    stops.clear(ctx, "threw");
    expect(stops.takeFired("req-1")).toEqual({ kind: "cap", message: "Claude Code ran for 3 mins, its cap on run time; stopped." });
  });
});
