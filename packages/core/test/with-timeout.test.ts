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
  it("arms nothing when the deadline is absent or non-positive", async () => {
    vi.useFakeTimers();
    const work = Promise.resolve("done");

    expect(withTimeout(work, undefined, "work")).toBe(work);
    expect(withTimeout(work, 0, "work")).toBe(work);
    expect(vi.getTimerCount()).toBe(0);
  });

  /**
   * The one reason the error is injectable: a caller that classifies its own
   * failures needs the timeout to arrive as its own error type, not as a plain
   * `Error` it would have to re-derive from the message.
   */
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
