// @vitest-environment happy-dom
/**
 * `useResource(def, { sessionId })`: a session resource read by the session's
 * id and kept current, for a screen that follows the session with
 * `useSessionFeed` and has no `useSession` view to take a snapshot from. It
 * reads the session's state without its items, and reads again on that
 * session's notice for the resource's own name, never on another resource's,
 * so a screen like a conversation's "earlier turns summarized" divider moves
 * when the summary does.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SubscribeOptions, WireNotice, WireTopic } from "@flow-state-dev/client";
import { fakeClient } from "./support/fake-client";

const { useResource } = await import("../src");

const summary = { scope: "session" as const, ref: "historySummary", ClientType: { throughRequestId: null as string | null, complete: true } };

const notice = (resource: string): WireNotice => ({ topic: { scope: "session", id: "s1", resource }, kind: "resource" });

function host(initial: unknown) {
  let face = initial;
  const subscriptions: Array<{ topics: readonly WireTopic[]; options: SubscribeOptions }> = [];
  const state = vi.fn(async (_sessionId: string, _options?: { includeItems?: boolean }) => ({
    sessionId: "s1",
    resources: { session: face === undefined ? {} : { historySummary: { clientData: face } } },
  }));
  const client = fakeClient({
    sessions: { state },
    subscribe: (topics, options) => {
      subscriptions.push({ topics, options });
      return { close() {} };
    },
  });
  return { client, state, subscriptions, set: (next: unknown) => void (face = next) };
}

describe("useResource at session scope, by session id", () => {
  it("reads the session's state without its items, and again on the session's notice for its name only", async () => {
    const h = host({ throughRequestId: "req_1", complete: true });
    const { result } = renderHook(() => useResource(summary, { sessionId: "s1", client: h.client }));
    await waitFor(() => expect(result.current.value).toEqual({ throughRequestId: "req_1", complete: true }));
    expect(h.state).toHaveBeenCalledWith("s1", { includeItems: false });
    expect(h.subscriptions[0]!.topics).toEqual([{ scope: "session", id: "s1" }]);

    h.set({ throughRequestId: "req_4", complete: false });
    await act(async () => h.subscriptions[0]!.options.onChange(notice("artifacts/notes")));
    expect(h.state).toHaveBeenCalledTimes(1);
    await act(async () => h.subscriptions[0]!.options.onChange(notice("historySummary")));
    await waitFor(() => expect(result.current.value).toEqual({ throughRequestId: "req_4", complete: false }));
  });

  it("is null while the session holds no such resource", async () => {
    const h = host(undefined);
    const { result } = renderHook(() => useResource(summary, { sessionId: "s1", client: h.client }));
    await waitFor(() => expect(h.state).toHaveBeenCalled());
    expect(result.current.value).toBeNull();
  });

  it("shows nothing the previous client read once the client changes, even when the new client's read fails", async () => {
    // Another account on the same page: the session id is the same, the client (its user) is not.
    const first = host({ throughRequestId: "req_alices", complete: true });
    const second = host(undefined);
    second.state.mockRejectedValue(new Error("not yours"));
    const { result, rerender } = renderHook(({ client }) => useResource(summary, { sessionId: "s1", client }), {
      initialProps: { client: first.client },
    });
    await waitFor(() => expect(result.current.value).toEqual({ throughRequestId: "req_alices", complete: true }));
    rerender({ client: second.client });
    await waitFor(() => expect(second.state).toHaveBeenCalled());
    await waitFor(() => expect(result.current.stale).toBe(true));
    expect(result.current.value).toBeNull();
  });

  it("hears the resource's own stored path when the flow declares it under another name", async () => {
    // The flow declares it as `earlier`; the server stores it, and names it in a notice, as `historySummary`.
    const h = host({ throughRequestId: "req_1", complete: true });
    // The host stub is typed to the default name; this flow declares it as `earlier`.
    h.state.mockImplementation(async () => ({ sessionId: "s1", resources: { session: { earlier: { clientData: face() } } } }) as never);
    let current = { throughRequestId: "req_1", complete: true };
    function face() {
      return current;
    }
    const { result } = renderHook(() => useResource(summary, { sessionId: "s1", key: "earlier", client: h.client }));
    await waitFor(() => expect(result.current.value).toEqual({ throughRequestId: "req_1", complete: true }));
    current = { throughRequestId: "req_7", complete: true };
    await act(async () => h.subscriptions[0]!.options.onChange(notice("historySummary")));
    await waitFor(() => expect(result.current.value).toEqual({ throughRequestId: "req_7", complete: true }));
  });

  it("reads the new session's when the id changes", async () => {
    const h = host({ throughRequestId: "req_1", complete: true });
    const { rerender } = renderHook(({ id }) => useResource(summary, { sessionId: id, client: h.client }), { initialProps: { id: "s1" } });
    await waitFor(() => expect(h.state).toHaveBeenCalledWith("s1", { includeItems: false }));
    rerender({ id: "s2" });
    await waitFor(() => expect(h.state).toHaveBeenCalledWith("s2", { includeItems: false }));
  });
});
