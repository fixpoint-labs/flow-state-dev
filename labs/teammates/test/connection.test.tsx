// @vitest-environment happy-dom
/**
 * When the lab's server goes away. Without the bar, a dead server looks like
 * a live one: the dots keep pulsing and the ages keep counting, and the only
 * sign is a line in the console. So a conversation whose feed has failed a
 * retry draws the bar and greys every status line drawn from that feed. A
 * feed's ordinary reconnect, which the first retry fixes, draws nothing: a
 * bar that flashes on every routine close teaches people to ignore it.
 *
 * A page opened while the server is down has nothing to keep on screen, so
 * it draws the connection screen and reads again until the roster lands.
 */
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { useNow } from "../src/lib/use-watch";
import { createFixtureLab } from "./fake-lab";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

const STALE = "opacity-60";
const headerStatus = () => document.querySelector<HTMLElement>("[data-header-status]")!;
const rowStatus = (name: string) => document.querySelector<HTMLElement>(`[data-worker="${name}"] [data-status]`)!;

describe("the server going away", () => {
  it("shows the bar and greys status only once a retry has failed, and clears both when the feed is live again", async () => {
    const lab = createFixtureLab({ speed: 0.05 });
    render(<App adapter={lab} />);
    await screen.findByLabelText("Message Chief of Staff");

    act(() => lab.setConnection("reconnecting"));
    expect(screen.queryByTestId("connection-banner")).toBeNull();
    expect(headerStatus().className).not.toContain(STALE);

    act(() => lab.setConnection("lapsed"));
    expect(screen.getByTestId("connection-banner").textContent).toContain("Lost the server");
    expect(headerStatus().className).toContain(STALE);
    expect(rowStatus("Chief of Staff").className).toContain(STALE);

    act(() => lab.setConnection("live"));
    expect(screen.queryByTestId("connection-banner")).toBeNull();
    expect(headerStatus().className).not.toContain(STALE);
    expect(rowStatus("Chief of Staff").className).not.toContain(STALE);
  });

  it("says a stopped feed has ended and offers Retry", async () => {
    const lab = createFixtureLab({ speed: 0.05 });
    render(<App adapter={lab} />);
    await screen.findByLabelText("Message Chief of Staff");
    act(() => lab.setConnection("stopped"));
    expect(screen.getByTestId("connection-banner").textContent).toContain("The server stopped this feed");
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("opened with the server down, draws the connection screen, then the lab once a read lands", async () => {
    render(<App adapter={createFixtureLab({ speed: 0.05, unreachableReads: 1 })} />);
    expect((await screen.findByTestId("unreachable-message")).textContent).toBe("fetch failed");
    expect(screen.queryByRole("navigation", { name: "Workers" })).toBeNull();
    await act(async () => fireEvent.click(screen.getByTestId("unreachable-retry")));
    expect(await screen.findByLabelText("Message Chief of Staff")).toBeTruthy();
    expect(screen.queryByTestId("unreachable")).toBeNull();
  });

  it("an age holds where it was while its feed is stale", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-02T12:00:00Z"));
    const { result, rerender } = renderHook(({ running }) => useNow(1_000, running), { initialProps: { running: true } });
    const start = result.current;
    act(() => vi.advanceTimersByTime(3_000));
    expect(result.current).toBe(start + 3_000);
    rerender({ running: false });
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current).toBe(start + 3_000);
  });
});
