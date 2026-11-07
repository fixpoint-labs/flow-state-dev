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
import { ClientHttpError } from "@flow-state-dev/client";
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
    await screen.findByLabelText("Message Lead");

    act(() => lab.setConnection("reconnecting"));
    expect(screen.queryByTestId("connection-banner")).toBeNull();
    expect(headerStatus().className).not.toContain(STALE);

    act(() => lab.setConnection("lapsed"));
    expect(screen.getByTestId("connection-banner").textContent).toContain("Lost the server");
    expect(headerStatus().className).toContain(STALE);
    expect(rowStatus("Lead").className).toContain(STALE);

    act(() => lab.setConnection("live"));
    expect(screen.queryByTestId("connection-banner")).toBeNull();
    expect(headerStatus().className).not.toContain(STALE);
    expect(rowStatus("Lead").className).not.toContain(STALE);
  });

  it("greys a running task's dot and stops its pulse in the panel while the feed is stale", async () => {
    const tasks = [{ filer: "teammates.chief-of-staff", id: "t-1", to: "teammates.researcher", title: "Check the beta numbers", goal: "Check the beta numbers", status: "running" as const, boardStatus: "in_progress" }];
    const lab = createFixtureLab({ speed: 0.05, tasks });
    render(<App adapter={lab} />);
    const panel = await screen.findByRole("complementary", { name: "Lead's panel" });
    const row = () => panel.querySelector<HTMLElement>("[data-task=running]")!;
    expect(row().className).not.toContain(STALE);

    act(() => lab.setConnection("lapsed"));
    // The dot sits inside the greyed row, where STALE_CLASS's pulse suppression reaches it.
    expect(row().className).toContain(STALE);
    expect(row().className).toContain("[&_.animate-pulse]:animate-none");
    expect(row().querySelector("[data-task-dot]")).not.toBeNull();

    act(() => lab.setConnection("live"));
    expect(row().className).not.toContain(STALE);
  });

  it("says a stopped feed has ended and offers Retry", async () => {
    const lab = createFixtureLab({ speed: 0.05 });
    render(<App adapter={lab} />);
    await screen.findByLabelText("Message Lead");
    act(() => lab.setConnection("stopped"));
    expect(screen.getByTestId("connection-banner").textContent).toContain("The server stopped this feed");
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("opened with the server down, draws the connection screen, then the lab once a read lands", async () => {
    render(<App adapter={createFixtureLab({ speed: 0.05, unreachableReads: 1 })} />);
    expect((await screen.findByTestId("unreachable-message")).textContent).toBe("fetch failed");
    expect(screen.queryByRole("navigation", { name: "Workers" })).toBeNull();
    await act(async () => fireEvent.click(screen.getByTestId("unreachable-retry")));
    expect(await screen.findByLabelText("Message Lead")).toBeTruthy();
    expect(screen.queryByTestId("unreachable")).toBeNull();
  });

  it("a roster read the server answered with an error shows its status, so a 502 reads apart from a dead socket", async () => {
    const lab = createFixtureLab({ speed: 0.05 });
    const failing = {
      ...lab,
      watchWorkers: (_onChange: unknown, onError?: (error: unknown) => void) => {
        queueMicrotask(() => onError?.(new ClientHttpError("Bad Gateway", { status: 502, body: undefined })));
        return () => {};
      },
    };
    render(<App adapter={failing} />);
    expect((await screen.findByTestId("unreachable-message")).textContent).toBe("502 · Bad Gateway");
  });

  it("a slow read a Retry overtook doesn't put the failure back over a lab that came back", async () => {
    const lab = createFixtureLab({ speed: 0.05 });
    let rejectSlow: (error: Error) => void = () => {};
    let call = 0;
    const flaky: typeof lab = {
      ...lab,
      watchWorkers: (onChange, onError) => {
        call += 1;
        if (call === 1) {
          queueMicrotask(() => onError?.(new Error("fetch failed")));
          return () => {};
        }
        // A watch whose read is still out: its failure arrives after the next Retry.
        if (call === 2) {
          rejectSlow = (error) => onError?.(error);
          return () => {};
        }
        return lab.watchWorkers(onChange, onError);
      }
    };
    render(<App adapter={flaky} />);
    await screen.findByTestId("unreachable-message");
    await act(async () => fireEvent.click(screen.getByTestId("unreachable-retry")));
    await act(async () => fireEvent.click(screen.getByTestId("unreachable-retry")));
    expect(await screen.findByLabelText("Message Lead")).toBeTruthy();
    await act(async () => rejectSlow(new Error("fetch failed")));
    expect(screen.queryByTestId("unreachable")).toBeNull();
    expect(screen.getByLabelText("Message Lead")).toBeTruthy();
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
