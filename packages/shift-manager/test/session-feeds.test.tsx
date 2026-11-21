// @vitest-environment happy-dom
/**
 * A session shown by several screens at once is one live feed: a
 * conversation, its composer's delivery check and Inbox's detail each read it
 * through `useSharedSessionFeed`, and the page holds one `useSessionFeed` for
 * it, so showing a session twice opens no second stream. The feed closes once
 * the last screen showing it goes, and every screen hears what it holds.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/** Each feed react's hook opened, by session, and whether it has closed. */
const opened: Array<{ sessionId: string; closed: boolean; push(items: unknown[]): void }> = [];
vi.mock("@flow-state-dev/react", async (original) => {
  const { useEffect, useState } = await import("react");
  return {
    ...(await original<typeof import("@flow-state-dev/react")>()),
    useSessionFeed: (sessionId: string | null) => {
      const [items, setItems] = useState<unknown[] | undefined>(undefined);
      useEffect(() => {
        if (sessionId == null) return;
        const entry = { sessionId, closed: false, push: (next: unknown[]) => setItems(next) };
        opened.push(entry);
        return () => void (entry.closed = true);
      }, [sessionId]);
      return sessionId == null ? undefined : { sessionId, items, hasEarlier: false, runs: null, state: "live", error: null, loadEarlier: async () => {}, followResponse: () => {} };
    },
  };
});

import { SessionFeedsProvider, useRetrySessionFeed, useSharedSessionFeed } from "../src/lib/session-feeds";

function Pane({ sessionId, testId }: { sessionId: string | null; testId: string }) {
  const feed = useSharedSessionFeed(sessionId);
  return <p data-testid={testId}>{feed?.items === undefined ? "reading" : `${feed.items.length} items`}</p>;
}

const client = { sessions: {} } as never;
afterEach(() => {
  cleanup();
  opened.length = 0;
});

describe("the page's session feeds", () => {
  it("opens one feed for a session two panes show, and both hear what it holds", async () => {
    render(
      <SessionFeedsProvider client={client}>
        <Pane sessionId="s1" testId="a" />
        <Pane sessionId="s1" testId="b" />
        <Pane sessionId="s2" testId="c" />
      </SessionFeedsProvider>,
    );
    expect(opened.map((feed) => feed.sessionId).sort()).toEqual(["s1", "s2"]);
    await act(async () => opened.find((feed) => feed.sessionId === "s1")!.push([{ id: "i1" }, { id: "i2" }]));
    expect(screen.getByTestId("a").textContent).toBe("2 items");
    expect(screen.getByTestId("b").textContent).toBe("2 items");
    expect(screen.getByTestId("c").textContent).toBe("reading");
  });

  it("keeps the feed while a pane still shows its session, and closes it when the last one goes", async () => {
    function Page({ panes }: { panes: number }) {
      return (
        <SessionFeedsProvider client={client}>
          {Array.from({ length: panes }, (_, n) => (
            <Pane key={n} sessionId="s1" testId={`p${n}`} />
          ))}
        </SessionFeedsProvider>
      );
    }
    const { rerender } = render(<Page panes={2} />);
    rerender(<Page panes={1} />);
    expect(opened).toHaveLength(1);
    expect(opened[0]!.closed).toBe(false);
    rerender(<Page panes={0} />);
    expect(opened[0]!.closed).toBe(true);
  });

  // A feed whose history read gave up (`stopped`) never reads again on its own: Retry opens it afresh.
  it("reads a stopped session again when a pane asks to retry it, and only that session", async () => {
    function Retrying() {
      const feed = useSharedSessionFeed("s1");
      const retry = useRetrySessionFeed("s1");
      return (
        <button type="button" data-testid="retry" onClick={retry}>
          {feed?.items === undefined ? "reading" : "read"}
        </button>
      );
    }
    render(
      <SessionFeedsProvider client={client}>
        <Retrying />
        <Pane sessionId="s1" testId="other" />
        <Pane sessionId="s2" testId="unrelated" />
      </SessionFeedsProvider>,
    );
    expect(opened.map((feed) => feed.sessionId).sort()).toEqual(["s1", "s2"]);
    await act(async () => fireEvent.click(screen.getByTestId("retry")));
    // The stopped feed is closed and a new one opened for the same session; the other session's is kept.
    expect(opened.filter((feed) => feed.sessionId === "s1").map((feed) => feed.closed)).toEqual([true, false]);
    expect(opened.filter((feed) => feed.sessionId === "s2")).toHaveLength(1);
    await act(async () => opened.at(-1)!.push([{ id: "i1" }]));
    expect(screen.getByTestId("other").textContent).toBe("1 items");
  });

  it("shows nothing for no session", () => {
    render(
      <SessionFeedsProvider client={client}>
        <Pane sessionId={null} testId="none" />
      </SessionFeedsProvider>,
    );
    expect(opened).toHaveLength(0);
    expect(screen.getByTestId("none").textContent).toBe("reading");
  });
});
