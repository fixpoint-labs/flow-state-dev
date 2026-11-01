// @vitest-environment happy-dom
/**
 * The connection bar and the first-read screen: what a person sees when the
 * server is gone.
 *
 * The bar is the only sign, without the console, that what is drawn stopped
 * being current. So it must show once a retry has failed, and must not show
 * on a first load or on the server's ordinary close, which the first retry
 * fixes: a bar that flashes every 15 minutes teaches people to ignore it.
 * Its age counts from when the feed left `live`, because that is how old the
 * data on screen is.
 *
 * Renders registry source through the vitest aliases, as the other render
 * tests here do.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionBanner, isFeedStale, STALE_CLASS, type ConnectionFeedState } from "../../registry/components/connection-banner";
import { ConnectionScreen, retryDelayMs } from "../../registry/components/connection-screen";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-31T12:00:00Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("isFeedStale", () => {
  const cases: Array<[ConnectionFeedState, boolean]> = [
    ["connecting", false],
    ["live", false],
    ["reconnecting", false],
    ["lapsed", true],
    ["stopped", true],
  ];
  it.each(cases)("%s → %s", (state, stale) => {
    expect(isFeedStale(state)).toBe(stale);
  });
});

describe("ConnectionBanner", () => {
  it.each<ConnectionFeedState>(["connecting", "live", "reconnecting"])("draws nothing on %s", (state) => {
    render(<ConnectionBanner feed={{ state }} />);
    expect(screen.queryByTestId("connection-banner")).toBeNull();
  });

  it("says how long ago the feed left live, counting from the first close, not from when the bar showed", () => {
    const { rerender } = render(<ConnectionBanner feed={{ state: "live" }} />);
    rerender(<ConnectionBanner feed={{ state: "reconnecting" }} />);
    act(() => vi.advanceTimersByTime(3_000));
    rerender(<ConnectionBanner feed={{ state: "lapsed" }} />);
    expect(screen.getByTestId("connection-banner").textContent).toContain("Lost the server 3s ago, retrying…");
    act(() => vi.advanceTimersByTime(9_000));
    expect(screen.getByTestId("connection-banner").textContent).toContain("Lost the server 12s ago");
  });

  it("goes away when the feed is live again, and starts a fresh age on the next loss", () => {
    const { rerender } = render(<ConnectionBanner feed={{ state: "live" }} />);
    rerender(<ConnectionBanner feed={{ state: "lapsed" }} />);
    act(() => vi.advanceTimersByTime(60_000));
    rerender(<ConnectionBanner feed={{ state: "live" }} />);
    expect(screen.queryByTestId("connection-banner")).toBeNull();
    rerender(<ConnectionBanner feed={{ state: "lapsed" }} />);
    expect(screen.getByTestId("connection-banner").textContent).toContain("0s ago");
  });

  it("offers Retry on stopped only when the app can reopen its feed", () => {
    const onRetry = vi.fn();
    const { rerender } = render(<ConnectionBanner feed={{ state: "stopped" }} />);
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    rerender(<ConnectionBanner feed={{ state: "stopped" }} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
    rerender(<ConnectionBanner feed={{ state: "lapsed" }} onRetry={onRetry} />);
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("STALE_CLASS stops pulsing dots and spinners", () => {
    expect(STALE_CLASS).toContain("[&_.animate-pulse]:animate-none");
    expect(STALE_CLASS).toContain("[&_.animate-spin]:animate-none");
  });
});

describe("ConnectionScreen", () => {
  it("backs off 2, 4, 8… seconds, capped at 30", () => {
    expect([0, 1, 2, 3, 4, 5].map(retryDelayMs)).toEqual([2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
  });

  it("a refusal has no retry, by button or on its own", () => {
    const onRetry = vi.fn();
    render(<ConnectionScreen kind="refused" title="Not let in" failure={{ httpStatus: 403, message: "no org" }} onRetry={onRetry} />);
    expect(screen.getByTestId("refusal-message").textContent).toBe("403 · no org");
    expect(screen.queryByTestId("unreachable-retry")).toBeNull();
    act(() => vi.advanceTimersByTime(120_000));
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("an unreachable server is retried on its own, further apart after each failure, and on the button", async () => {
    const onRetry = vi.fn(() => Promise.resolve());
    render(<ConnectionScreen kind="unreachable" title="Can't reach" failure={{ message: "fetch failed" }} onRetry={onRetry} />);
    await act(async () => vi.advanceTimersByTime(1_999));
    expect(onRetry).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("unreachable-countdown").textContent).toBe("Trying again in 4s");
    await act(async () => vi.advanceTimersByTime(3_999));
    expect(onRetry).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(1));
    expect(onRetry).toHaveBeenCalledTimes(2);
    await act(async () => fireEvent.click(screen.getByTestId("unreachable-retry")));
    expect(onRetry).toHaveBeenCalledTimes(3);
  });

  it("keeps one schedule when the parent re-renders with new props each time", async () => {
    const onRetry = vi.fn(() => Promise.resolve());
    const draw = () => <ConnectionScreen kind="unreachable" title="Can't reach" failure={{ message: "fetch failed" }} onRetry={() => onRetry()} />;
    const { rerender } = render(draw());
    for (let i = 0; i < 5; i += 1) {
      rerender(draw());
      await act(async () => vi.advanceTimersByTime(300));
    }
    // 1.5s in: the first retry, due at 2s, has not run, however often the parent drew.
    expect(onRetry).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(500));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("a click on Retry replaces the pending automatic retry rather than adding one", async () => {
    const onRetry = vi.fn(() => Promise.resolve());
    render(<ConnectionScreen kind="unreachable" title="Can't reach" failure={{ message: "fetch failed" }} onRetry={onRetry} />);
    await act(async () => vi.advanceTimersByTime(1_900));
    await act(async () => fireEvent.click(screen.getByTestId("unreachable-retry")));
    expect(onRetry).toHaveBeenCalledTimes(1);
    // The 2s timer the click replaced never fires.
    await act(async () => vi.advanceTimersByTime(3_000));
    expect(onRetry).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it("a click during a slow read leaves one schedule, and nothing runs after the screen goes away", async () => {
    const settle: Array<() => void> = [];
    const onRetry = vi.fn(() => new Promise<void>((resolve) => settle.push(resolve)));
    const { unmount } = render(<ConnectionScreen kind="unreachable" title="Can't reach" failure={{ message: "fetch failed" }} onRetry={onRetry} />);
    await act(async () => vi.advanceTimersByTime(2_000));
    await act(async () => fireEvent.click(screen.getByTestId("unreachable-retry")));
    expect(onRetry).toHaveBeenCalledTimes(2);
    // Both reads finish; only the latest may schedule the next.
    await act(async () => settle.forEach((resolve) => resolve()));
    unmount();
    await act(async () => vi.advanceTimersByTime(120_000));
    expect(onRetry).toHaveBeenCalledTimes(2);
  });
});
