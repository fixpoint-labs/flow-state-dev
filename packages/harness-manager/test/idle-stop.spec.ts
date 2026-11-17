// FIX-2794.
/**
 * The silence stop on its own, with a fake clock: what it remembers after a
 * step it stopped settles, and what it says when a harness never reported an
 * event at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { idleStops } from "../src/idle-stop";

const WINDOW = 60_000;
const ctx = { request: { identity: { id: "req-1" } } } as Parameters<ReturnType<typeof idleStops>["arm"]>[0];

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("idleStops: what a stopped step leaves behind", () => {
  // The step's rescue reads the stop's words only on a throw. A step that
  // returned (its harness finished as the stop fired, or swallowed the abort)
  // must not leave them for a later, unrelated failure on the same request to
  // be relabelled as a silence stop.
  it("forgets the stop when the step it fired on returned", () => {
    const stops = idleStops(WINDOW, "Claude Code");
    stops.arm(ctx);
    stops.heard(ctx);
    vi.advanceTimersByTime(WINDOW);
    stops.clear(ctx, "returned");
    expect(stops.takeFired("req-1")).toBeUndefined();
  });

  it("keeps the stop for the rescue when the step it fired on threw", () => {
    const stops = idleStops(WINDOW, "Claude Code");
    const signal = stops.arm(ctx);
    stops.heard(ctx);
    vi.advanceTimersByTime(WINDOW);
    expect(signal.aborted).toBe(true);
    stops.clear(ctx, "threw");
    expect(stops.takeFired("req-1")).toBe("No output from Claude Code for 1 min; stopped.");
  });
});

describe("idleStops: a harness that never reports events", () => {
  // A host that builds a harness's feeds by name and drops `onEvent` gets
  // every run stopped at the window however busy it is. That must be
  // diagnosable from the log, not read as a hung model.
  it("warns, once, when it stops a step whose harness never reported an event", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const stops = idleStops(WINDOW, "Claude Code");
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
    const stops = idleStops(WINDOW, "Claude Code");
    stops.arm(ctx);
    stops.heard(ctx);
    vi.advanceTimersByTime(WINDOW);
    expect(warn).not.toHaveBeenCalled();
  });
});
