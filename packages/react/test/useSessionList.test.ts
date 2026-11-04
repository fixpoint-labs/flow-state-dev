// @vitest-environment happy-dom
/**
 * `useSessionList`: a flow's sessions, read again when one of them changes.
 *
 * What makes it live is the user topic: the server publishes `run` there for
 * every write to one of the user's sessions, including a session the list has
 * never seen. The cases below fail if the hook listens anywhere else, ignores
 * `run`, stops reading when the page comes back into view (the only signal a
 * change from another process gets on a bus that doesn't cross), or starts
 * subscribing through a client that can't.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { SessionSummary, SubscribeOptions, WireNotice, WireTopic } from "@flow-state-dev/client";
import { topic } from "@flow-state-dev/client";
import { useSessionList, type SessionListClient } from "../src";

afterEach(cleanup);

const row = (id: string, extra: Partial<SessionSummary> = {}): SessionSummary =>
  ({ id, flowKind: "chat", userId: "u", createdAt: 1, updatedAt: 1, ...extra }) as unknown as SessionSummary;

function liveClient(pages: SessionSummary[][]) {
  const subscriptions: Array<{ topics: readonly WireTopic[]; options: SubscribeOptions; closed: boolean }> = [];
  let page = 0;
  const list = vi.fn(async () => pages[Math.min(page++, pages.length - 1)]!);
  const client = {
    sessions: { list },
    subscribe: (topics: readonly WireTopic[], options: SubscribeOptions) => {
      const entry = { topics, options, closed: false };
      subscriptions.push(entry);
      return {
        close() {
          entry.closed = true;
        }
      };
    }
  } as unknown as SessionListClient;
  const notify = async (notice: WireNotice | null) => {
    await act(async () => {
      subscriptions.at(-1)!.options.onChange(notice);
      await Promise.resolve();
    });
  };
  return { client, list, subscriptions, notify };
}

describe("useSessionList", () => {
  it("asks for each row's state, and listens on the user's topic", async () => {
    const live = liveClient([[row("s1", { requestStatus: "suspended" })]]);
    const { result } = renderHook(() => useSessionList({ flowKind: "chat", client: live.client }));

    await waitFor(() => expect(result.current.sessions.map((s) => s.id)).toEqual(["s1"]));
    expect(live.list).toHaveBeenCalledWith({ flowKind: "chat", include: ["status"] });
    expect(result.current.sessions[0]?.requestStatus).toBe("suspended");
    expect(live.subscriptions).toHaveLength(1);
    expect(live.subscriptions[0]!.topics).toEqual([topic.user()]);
  });

  it("reads again on a run notice, so a session made elsewhere joins the list", async () => {
    const live = liveClient([[row("s1")], [row("s2"), row("s1")]]);
    const { result } = renderHook(() => useSessionList({ flowKind: "chat", client: live.client }));
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));

    await live.notify({ topic: topic.user(), kind: "run" });

    await waitFor(() => expect(result.current.sessions.map((s) => s.id)).toEqual(["s2", "s1"]));
  });

  it("does not read on a notice that says nothing about the list", async () => {
    const live = liveClient([[row("s1")]]);
    renderHook(() => useSessionList({ flowKind: "chat", client: live.client }));
    await waitFor(() => expect(live.list).toHaveBeenCalledTimes(1));

    await live.notify({ topic: topic.user(), kind: "items" });

    expect(live.list).toHaveBeenCalledTimes(1);
  });

  it("reads again when the page becomes visible", async () => {
    const live = liveClient([[row("s1")], [row("s1", { requestStatus: "failed" })]]);
    const { result } = renderHook(() => useSessionList({ flowKind: "chat", client: live.client }));
    await waitFor(() => expect(live.list).toHaveBeenCalledTimes(1));

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.sessions[0]?.requestStatus).toBe("failed"));
  });

  it("reads once through a client that cannot subscribe", async () => {
    const list = vi.fn(async () => [row("s1")]);
    const client = { sessions: { list } } as unknown as SessionListClient;
    const { result } = renderHook(() => useSessionList({ flowKind: "chat", client }));

    await waitFor(() => expect(result.current.sessions).toHaveLength(1));
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("sends the listing it always has when asked for nothing", async () => {
    const live = liveClient([[row("s1")]]);
    renderHook(() => useSessionList({ flowId: "f1", includeStatus: false, client: live.client }));

    await waitFor(() => expect(live.list).toHaveBeenCalledWith({ flowId: "f1" }));
  });

  it("closes its subscription on unmount", async () => {
    const live = liveClient([[row("s1")]]);
    const view = renderHook(() => useSessionList({ flowKind: "chat", client: live.client }));
    await waitFor(() => expect(live.list).toHaveBeenCalled());

    view.unmount();

    expect(live.subscriptions[0]!.closed).toBe(true);
  });
});
