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
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/components/App";
import { codingTask, POPUP_READ, stubServer, TestProvider } from "./stub-server";
import { useNow } from "../src/lib/use-watch";
import { scriptedServer, ScriptedProvider, rosterReadsBy } from "./scripted-server";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

const STALE = "opacity-60";
// The lab's first draw is render work with no fixture timer: ~150 ms alone, past findBy's 1 s default under CI load.
const FIRST_DRAW = { timeout: 3_000 };
const headerStatus = () => document.querySelector<HTMLElement>("[data-header-status]")!;
const rowStatus = (name: string) => document.querySelector<HTMLElement>(`[data-worker="${name}"] [data-status]`)!;

describe("the server going away", () => {
  it("draws the header's bot and its status pill in one state on a lost feed: idle, not a stale running", async () => {
    const lab = scriptedServer({ speed: 0.05 });
    render(<ScriptedProvider server={lab}><App /></ScriptedProvider>);
    const box = await screen.findByLabelText("Message Lead", undefined, FIRST_DRAW);
    const release = lab.holdNextTurn("teammates.chief-of-staff");
    await act(async () => {
      fireEvent.change(box, { target: { value: "Outline the post." } });
      fireEvent.keyDown(box, { key: "Enter" });
    });
    const bot = () => document.querySelector<HTMLElement>("[data-bot-figure]")!.dataset.state;
    await waitFor(() => expect([headerStatus().dataset.state, bot()]).toEqual(["running", "running"]), { interval: 5 });

    act(() => lab.setConnection("lapsed"));
    expect([headerStatus().dataset.state, bot()]).toEqual(["idle", "idle"]);
    expect(headerStatus().className).toContain(STALE);
    act(() => release());
  });

  it("shows the bar and greys status only once a retry has failed, and clears both when the feed is live again", async () => {
    const lab = scriptedServer({ speed: 0.05 });
    render(<ScriptedProvider server={lab}><App /></ScriptedProvider>);
    await screen.findByLabelText("Message Lead", undefined, FIRST_DRAW);

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

  it("greys a running task's card and stops its pulse in the panel while the feed is stale", async () => {
    const server = stubServer({ board: { "conversation:teammates.chief-of-staff": [codingTask({ id: "t-1", assignee: "teammates.researcher", title: "Check the beta numbers", status: "in_progress" })] } });
    const lab = scriptedServer({ speed: 0.05 });
    render(<TestProvider server={lab} client={server.client}><App /></TestProvider>);
    const panel = await screen.findByRole("complementary", { name: "Lead's panel" }, FIRST_DRAW);
    const row = () => panel.querySelector<HTMLElement>("[data-task=running]")!;
    await waitFor(() => expect(row()).not.toBeNull(), POPUP_READ);
    expect(row().className).not.toContain(STALE);

    act(() => lab.setConnection("lapsed"));
    // The whole card greys, so STALE_CLASS's pulse suppression reaches everything inside it (a running card's bar).
    expect(row().className).toContain(STALE);
    expect(row().className).toContain("[&_.animate-pulse]:animate-none");

    act(() => lab.setConnection("live"));
    expect(row().className).not.toContain(STALE);
  });

  it("says a stopped feed has ended and offers Retry", async () => {
    const lab = scriptedServer({ speed: 0.05 });
    render(<ScriptedProvider server={lab}><App /></ScriptedProvider>);
    await screen.findByLabelText("Message Lead", undefined, FIRST_DRAW);
    act(() => lab.setConnection("stopped"));
    expect(screen.getByTestId("connection-banner").textContent).toContain("The server stopped this feed");
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("says a feed whose history never read has ended and offers Retry, rather than connecting for good", async () => {
    // Only the session's own history read fails, past the feed's four retries (2, 4, 8 and 16 s); the views still answer.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<ScriptedProvider server={scriptedServer({ speed: 0.05, historyUnreadable: true })}><App /></ScriptedProvider>);
      await screen.findByLabelText("Message Lead", undefined, FIRST_DRAW);
      await act(async () => void (await vi.advanceTimersByTimeAsync(31_000)));
      await waitFor(() => expect(screen.getByTestId("connection-banner").textContent).toContain("The server stopped this feed"));
      expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("opened with the server down, draws the connection screen, then the lab once a read lands", async () => {
    render(<ScriptedProvider server={scriptedServer({ speed: 0.05, unreachableReads: 1 })}><App /></ScriptedProvider>);
    expect((await screen.findByTestId("unreachable-message")).textContent).toBe("fetch failed");
    expect(screen.queryByRole("navigation", { name: "Workers" })).toBeNull();
    await act(async () => fireEvent.click(screen.getByTestId("unreachable-retry")));
    expect(await screen.findByLabelText("Message Lead", undefined, FIRST_DRAW)).toBeTruthy();
    expect(screen.queryByTestId("unreachable")).toBeNull();
  });

  it("a roster read the server answered with an error shows its status, so a 502 reads apart from a dead socket", async () => {
    const lab = scriptedServer({ speed: 0.05 });
    const failing = rosterReadsBy(lab, () => Promise.reject(new ClientHttpError("Bad Gateway", { status: 502, body: undefined })));
    render(<ScriptedProvider server={lab} client={failing}><App /></ScriptedProvider>);
    expect((await screen.findByTestId("unreachable-message")).textContent).toBe("502 · Bad Gateway");
  });

  it("a slow read a Retry overtook doesn't put the failure back over a lab that came back", async () => {
    const lab = scriptedServer({ speed: 0.05 });
    let rejectSlow: (error: Error) => void = () => {};
    const flaky = rosterReadsBy(lab, (call, read) => {
      if (call === 1) return Promise.reject(new Error("fetch failed"));
      // A read still out: its failure arrives after the next Retry.
      if (call === 2) return new Promise((_, reject) => (rejectSlow = reject));
      return read();
    });
    render(<ScriptedProvider server={lab} client={flaky}><App /></ScriptedProvider>);
    await screen.findByTestId("unreachable-message");
    await act(async () => fireEvent.click(screen.getByTestId("unreachable-retry")));
    await act(async () => fireEvent.click(screen.getByTestId("unreachable-retry")));
    expect(await screen.findByLabelText("Message Lead", undefined, FIRST_DRAW)).toBeTruthy();
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
