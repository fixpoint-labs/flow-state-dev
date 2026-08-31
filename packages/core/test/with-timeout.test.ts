import { afterEach, describe, expect, it, vi } from "vitest";
import { withTimeout } from "../src/helpers/with-timeout";

afterEach(() => {
  vi.useRealTimers();
});

describe("withTimeout", () => {
  /**
   * The regression this helper exists to prevent. `withTimeout` runs on every
   * tool call and every settled step, so a timer left armed after the work
   * already won accumulates one handle per call and holds the event loop open
   * past a shutdown that is otherwise finished. Asserted on the timer count
   * rather than on the result, because the result is correct either way — a
   * leak is invisible to any assertion about the returned value.
   */
  it("leaves no timer armed once the work resolves", async () => {
    vi.useFakeTimers();

    await expect(withTimeout(Promise.resolve("done"), 60_000, "work")).resolves.toBe("done");

    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves no timer armed once the work rejects", async () => {
    vi.useFakeTimers();

    await expect(
      withTimeout(Promise.reject(new Error("boom")), 60_000, "work")
    ).rejects.toThrow("boom");

    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects with the label and the deadline once the time is up", async () => {
    vi.useFakeTimers();

    const bounded = withTimeout(new Promise<never>(() => {}), 500, "the provider call");
    const assertion = expect(bounded).rejects.toThrow("the provider call timed out after 500ms");
    await vi.advanceTimersByTimeAsync(500);

    await assertion;
  });

  /**
   * No deadline means no timer at all, not a timer with a large delay: callers
   * pass an optional config value straight through, and an unconfigured timeout
   * must not arm anything.
   */
  /**
   * `Infinity` is the third case, and the one with teeth. It is this repo's
   * no-deadline sentinel already — `engine/stores/scope-lock.ts` disables on
   * `undefined`, `Infinity`, or non-positive — so a caller wiring a config
   * value through arrives here expecting the same. Node does the opposite:
   * `setTimeout(fn, Infinity)` warns `TimeoutOverflowWarning` and coerces the
   * duration to **1ms**, so the value meaning "never time out" would reject
   * almost at once.
   */
  it("arms nothing when the deadline is absent, non-positive, or Infinity", async () => {
    vi.useFakeTimers();
    const work = Promise.resolve("done");

    expect(withTimeout(work, undefined, "work")).toBe(work);
    expect(withTimeout(work, 0, "work")).toBe(work);
    expect(withTimeout(work, Infinity, "work")).toBe(work);
    expect(vi.getTimerCount()).toBe(0);
  });

  /**
   * The one reason the error is injectable: a caller that classifies its own
   * failures needs the timeout to arrive as its own error type, not as a plain
   * `Error` it would have to re-derive from the message.
   */
  /**
   * A factory that throws is caller code misbehaving, but the blast radius is
   * out of proportion: the throw happens inside the timer callback, so it is
   * never seen by the executor. Node reports an uncaught exception — which by
   * default kills the process — and the returned promise stays pending for
   * ever. `never` is assignable to `Error`, so a factory that only throws
   * type-checks against this signature.
   */
  it("rejects rather than escaping when the caller's error factory throws", async () => {
    const bounded = withTimeout(new Promise(() => {}), 5, "work", () => {
      throw new Error("factory blew up");
    });

    await expect(bounded).rejects.toThrow("factory blew up");
  });

  it("rejects with the caller's error when one is supplied", async () => {
    vi.useFakeTimers();
    class Refused extends Error {}

    const bounded = withTimeout(
      new Promise<never>(() => {}),
      500,
      "the hook",
      (label, timeoutMs) => new Refused(`${label} did not answer within ${timeoutMs}ms`)
    );
    const assertion = expect(bounded).rejects.toBeInstanceOf(Refused);
    await vi.advanceTimersByTimeAsync(500);

    await assertion;
    await expect(bounded).rejects.toThrow("the hook did not answer within 500ms");
  });
});
