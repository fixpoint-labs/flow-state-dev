// @vitest-environment happy-dom
/**
 * `useSubscription` (FIX-2428): the hook a screen calls with the topics it
 * shows and the read it already makes. It subscribes through the client's
 * `subscribe`, which owns the socket and the timer, and runs the read through
 * the coalesced read, so a burst of notices is one read in flight and one
 * waiting.
 *
 * The read gets the notice that woke it, or `null` for a connect, a
 * reconnect or a timer tick. A waiting read that stands for several
 * different notices gets `null`: read everything, since no one notice
 * describes it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { SubscribeOptions, WireNotice, WireTopic } from "@flow-state-dev/client";

const { subscriptions, built } = vi.hoisted(() => ({
  subscriptions: [] as Array<{ topics: readonly WireTopic[]; options: SubscribeOptions; closed: boolean }>,
  built: { clients: 0 }
}));

vi.mock("@flow-state-dev/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@flow-state-dev/client")>();
  const { fakeClient } = await import("./support/fake-client");
  return {
    ...actual,
    createClient: () => {
      built.clients += 1;
      return fakeClient({
        subscribe: (topics, options) => {
          const entry = { topics, options, closed: false };
          subscriptions.push(entry);
          return {
            close() {
              entry.closed = true;
            }
          };
        }
      });
    }
  };
});

const { FlowProvider, useSubscription } = await import("../src");
const { createElement } = await import("react");
const { topic } = await import("@flow-state-dev/client");

afterEach(() => {
  subscriptions.length = 0;
  built.clients = 0;
});

const S1 = topic.session("s1");
const notice = (kind: WireNotice["kind"], at: WireTopic = S1): WireNotice => ({ topic: at, kind });

/** A read the test settles by hand. */
function gatedRead() {
  const calls: Array<WireNotice | null> = [];
  let release: (() => void) | undefined;
  const read = vi.fn((n: WireNotice | null) => {
    calls.push(n);
    return new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  return {
    read,
    calls,
    settle: async () => {
      await act(async () => {
        release?.();
        await Promise.resolve();
        await Promise.resolve();
      });
    }
  };
}

describe("useSubscription", () => {
  it("subscribes its topics through the client, with its poll interval, and closes on unmount", () => {
    const { unmount } = renderHook(() => useSubscription([S1, topic.org()], () => {}, { pollIntervalMs: 3000 }));
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0]!.topics).toEqual([S1, topic.org()]);
    expect(subscriptions[0]!.options.pollIntervalMs).toBe(3000);
    unmount();
    expect(subscriptions[0]!.closed).toBe(true);
  });

  it("omits the poll interval when the screen does: no timer", () => {
    renderHook(() => useSubscription([S1], () => {}));
    expect(subscriptions[0]!.options.pollIntervalMs).toBeUndefined();
  });

  it("passes the read the notice that woke it, and null for a connect or a tick", async () => {
    const gate = gatedRead();
    renderHook(() => useSubscription([S1], gate.read));
    act(() => subscriptions[0]!.options.onChange(notice("request")));
    await gate.settle();
    act(() => subscriptions[0]!.options.onChange(null));
    await gate.settle();
    expect(gate.calls).toEqual([notice("request"), null]);
  });

  it("folds a burst of notices into one read in flight and one waiting", async () => {
    const gate = gatedRead();
    renderHook(() => useSubscription([S1], gate.read));
    const { onChange } = subscriptions[0]!.options;
    act(() => {
      onChange(notice("items"));
      onChange(notice("items"));
      onChange(notice("items"));
      onChange(notice("items"));
    });
    expect(gate.read).toHaveBeenCalledTimes(1);
    await gate.settle();
    expect(gate.read).toHaveBeenCalledTimes(2);
    await gate.settle();
    expect(gate.read).toHaveBeenCalledTimes(2);
    expect(gate.calls).toEqual([notice("items"), notice("items")]);
  });

  it("gives a waiting read that stands for different notices null, so it reads everything", async () => {
    const gate = gatedRead();
    renderHook(() => useSubscription([S1], gate.read));
    const { onChange } = subscriptions[0]!.options;
    act(() => {
      onChange(notice("items"));
      onChange(notice("request"));
      onChange(notice("items"));
    });
    await gate.settle();
    expect(gate.calls).toEqual([notice("items"), null]);
  });

  it("gives a waiting read null when its notices came from different requests", async () => {
    const gate = gatedRead();
    renderHook(() => useSubscription([S1], gate.read));
    const { onChange } = subscriptions[0]!.options;
    const from = (requestId: string): WireNotice => ({ topic: S1, kind: "request", origin: { requestId } });
    act(() => {
      onChange(from("r1"));
      onChange(from("r2"));
      onChange(from("r3"));
    });
    await gate.settle();
    expect(gate.calls).toEqual([from("r1"), null]);
  });

  it("shares one client, and so one socket, across hooks under one provider", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      createElement(FlowProvider, { userId: "u1", baseUrl: "http://host", children });
    renderHook(
      () => {
        useSubscription([S1], () => {});
        useSubscription([topic.org()], () => {});
      },
      { wrapper }
    );
    expect(subscriptions).toHaveLength(2);
    expect(built.clients).toBe(1);
  });

  it("gives each provider its own clients", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      createElement(FlowProvider, { userId: "u1", baseUrl: "http://host", children });
    renderHook(() => useSubscription([S1], () => {}), { wrapper });
    renderHook(() => useSubscription([S1], () => {}), { wrapper });
    expect(built.clients).toBe(2);
  });

  it("keeps one subscription across renders with an equal topic list, and calls the latest read", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ read }) => useSubscription([topic.session("s1")], read), {
      initialProps: { read: first }
    });
    rerender({ read: second });
    expect(subscriptions).toHaveLength(1);
    await act(async () => {
      subscriptions[0]!.options.onChange(null);
      await Promise.resolve();
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(null, expect.any(AbortSignal));
  });

  it("subscribes again when the topics change, and closes the old one", () => {
    const { rerender } = renderHook(({ id }) => useSubscription([topic.session(id)], () => {}), {
      initialProps: { id: "s1" }
    });
    rerender({ id: "s2" });
    expect(subscriptions.map((entry) => [entry.topics, entry.closed])).toEqual([
      [[topic.session("s1")], true],
      [[topic.session("s2")], false]
    ]);
  });

  it("subscribes nothing while disabled or with no topics", () => {
    renderHook(() => useSubscription([S1], () => {}, { enabled: false }));
    renderHook(() => useSubscription([], () => {}));
    expect(subscriptions).toEqual([]);
  });

  it("subscribes through a host's own client when it passes one, so the socket carries that client's credential", () => {
    const own: Array<readonly WireTopic[]> = [];
    const client = {
      subscribe: (topics: readonly WireTopic[]) => {
        own.push(topics);
        return { close() {} };
      }
    };
    renderHook(() => useSubscription([S1], () => {}, { client }));
    expect(own).toEqual([[S1]]);
    expect(subscriptions).toEqual([]);
  });

  it("aborts the signal a running read holds when the hook unmounts, so it can drop what it read", async () => {
    const signals: AbortSignal[] = [];
    let release: (() => void) | undefined;
    const read = (_n: WireNotice | null, signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<void>((resolve) => (release = resolve));
    };
    const { unmount } = renderHook(() => useSubscription([S1], read));
    act(() => subscriptions[0]!.options.onChange(notice("items")));
    expect(signals).toHaveLength(1);
    expect(signals[0]!.aborted).toBe(false);
    unmount();
    // The read resumes after the hook is gone: its signal says so.
    release?.();
    expect(signals[0]!.aborted).toBe(true);
  });

  it("aborts a running read's signal when the topics change", () => {
    const signals: AbortSignal[] = [];
    const read = (_n: WireNotice | null, signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<void>(() => {});
    };
    const { rerender } = renderHook(({ at }) => useSubscription([at], read), { initialProps: { at: S1 } });
    act(() => subscriptions[0]!.options.onChange(notice("items")));
    rerender({ at: topic.session("s2") });
    expect(signals[0]!.aborted).toBe(true);
  });

  it("drops a waiting read on unmount", async () => {
    const gate = gatedRead();
    const { unmount } = renderHook(() => useSubscription([S1], gate.read));
    const { onChange } = subscriptions[0]!.options;
    act(() => {
      onChange(notice("items"));
      onChange(notice("items"));
    });
    unmount();
    await gate.settle();
    expect(gate.read).toHaveBeenCalledTimes(1);
  });
});
