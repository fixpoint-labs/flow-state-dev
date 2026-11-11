// @vitest-environment happy-dom
// FIX-2623.
/**
 * `useView`: a screen watches a view with no topics of its own.
 * Two screens watching the same view and input share one read; the value
 * follows a change notice on the topics the answer named; a failed read says
 * `stale` until one lands; unmounting the last watcher closes the
 * subscription.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import type { SubscribeOptions, ViewResult, WireNotice, WireTopic } from "@flow-state-dev/client";
import { viewRef } from "@flow-state-dev/client";
import type { ViewWatchClient } from "@flow-state-dev/client/internal";
import { FlowProvider, useView } from "../src";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
};

function fakeClient(answer: () => ViewResult | Promise<ViewResult>) {
  const held: Array<{ topics: readonly WireTopic[]; options: SubscribeOptions; closed: boolean }> = [];
  let views = 0;
  const client: ViewWatchClient = {
    view: async () => {
      views += 1;
      return answer();
    },
    subscribe: (topics, options) => {
      const entry = { topics, options, closed: false };
      held.push(entry);
      return { close: () => void (entry.closed = true) };
    }
  };
  const notify = (notice: WireNotice | null) => {
    for (const entry of held) if (!entry.closed) entry.options.onChange(notice);
  };
  return { client, notify, views: () => views, open: () => held.filter((h) => !h.closed) };
}

const BOARD = viewRef("desk", "board");

describe("useView", () => {
  it("shares one read between two screens, and follows a change on the topics the answer named", async () => {
    let n = 0;
    const fake = fakeClient(() => ({ value: { n }, topics: [{ scope: "user" }] }));
    const options = { client: fake.client, pollIntervalMs: null };
    const a = renderHook(() => useView(BOARD, { open: true }, options));
    const b = renderHook(() => useView(BOARD, { open: true }, options));
    await flush();
    expect(a.result.current).toEqual({ value: { n: 0 }, stale: false });
    expect(b.result.current).toEqual({ value: { n: 0 }, stale: false });
    const reads = fake.views();

    n = 1;
    await act(async () => fake.notify({ topic: { scope: "user" }, kind: "resource" }));
    await flush();
    expect(fake.views()).toBe(reads + 1);
    expect(a.result.current.value).toEqual({ n: 1 });
    expect(b.result.current.value).toEqual({ n: 1 });

    a.unmount();
    expect(fake.open()).toHaveLength(1);
    b.unmount();
    expect(fake.open()).toHaveLength(0);
  });

  it("answers nothing while disabled, rather than the last value as if current", async () => {
    const fake = fakeClient(() => ({ value: "v1", topics: [] }));
    const hook = renderHook(({ enabled }) => useView(BOARD, undefined, { client: fake.client, pollIntervalMs: null, enabled }), {
      initialProps: { enabled: true }
    });
    await flush();
    expect(hook.result.current).toEqual({ value: "v1", stale: false });
    hook.rerender({ enabled: false });
    expect(hook.result.current).toEqual({ value: undefined, stale: false });
    expect(fake.open()).toHaveLength(0);
    hook.unmount();
  });

  it("answers nothing for a new input until its own answer lands, never the old input's", async () => {
    const fake = fakeClient(() => ({ value: "v", topics: [] }));
    let release: (() => void) | undefined;
    const gated = { ...fake.client, view: (...args: Parameters<typeof fake.client.view>) => new Promise<Awaited<ReturnType<typeof fake.client.view>>>((resolve) => {
      release = () => void fake.client.view(...args).then(resolve);
    }) };
    const hook = renderHook(({ team }) => useView(BOARD, { team }, { client: gated, pollIntervalMs: null }), {
      initialProps: { team: "eng" }
    });
    release?.();
    await flush();
    expect(hook.result.current.value).toBe("v");
    hook.rerender({ team: "ops" });
    expect(hook.result.current).toEqual({ value: undefined, stale: false });
    hook.unmount();
  });

  it("watches a null input as null, apart from an omitted one", async () => {
    const inputs: unknown[] = [];
    const fake = fakeClient(() => ({ value: "v", topics: [] }));
    const recording = { ...fake.client, view: (ref: never, input: unknown, options?: never) => (inputs.push(input), fake.client.view(ref, input, options)) };
    const asNull = renderHook(() => useView(BOARD, null as never, { client: recording, pollIntervalMs: null }));
    const omitted = renderHook(() => useView(BOARD, undefined, { client: recording, pollIntervalMs: null }));
    await flush();
    // Two reads, one per input: null is not shared with an omitted input.
    expect(new Set(inputs.map((input) => (input === undefined ? "omitted" : JSON.stringify(input))))).toEqual(new Set(["null", "omitted"]));
    asNull.unmount();
    omitted.unmount();
  });

  it("is stale while a read fails, and not once one lands", async () => {
    let fail = true;
    const fake = fakeClient(() => {
      if (fail) throw new Error("down");
      return { value: "ok", topics: [] };
    });
    const hook = renderHook(() => useView(BOARD, undefined, { client: fake.client, pollIntervalMs: null }));
    await flush();
    expect(hook.result.current).toEqual({ value: undefined, stale: true });
    fail = false;
    await act(async () => fake.notify(null));
    await flush();
    expect(hook.result.current).toEqual({ value: "ok", stale: false });
    hook.unmount();
  });

  it("is not stale once a restarted watch's read lands, after a failure before it stopped", async () => {
    // The old watch's `stale: true` belongs to that watch. A new one starts its
    // own live read, which never says `false` for a failure it didn't have.
    let fail = true;
    const fake = fakeClient(() => {
      if (fail) throw new Error("down");
      return { value: "ok", topics: [] };
    });
    const hook = renderHook(({ enabled }) => useView(BOARD, undefined, { client: fake.client, pollIntervalMs: null, enabled }), {
      initialProps: { enabled: true }
    });
    await flush();
    expect(hook.result.current).toEqual({ value: undefined, stale: true });
    hook.rerender({ enabled: false });
    fail = false;
    hook.rerender({ enabled: true });
    await flush();
    expect(hook.result.current).toEqual({ value: "ok", stale: false });
    hook.unmount();
  });

  it("answers nothing through a new client until that client's own answer lands, never the old client's", async () => {
    // A client is a user: holding the old client's answer over a new one shows
    // one user's data to another (BP-035, multi-tenant).
    const alice = fakeClient(() => ({ value: "alice's", topics: [] }));
    const bob = fakeClient(() => new Promise<ViewResult>(() => undefined));
    const hook = renderHook(({ client }) => useView(BOARD, undefined, { client, pollIntervalMs: null }), {
      initialProps: { client: alice.client }
    });
    await flush();
    expect(hook.result.current).toEqual({ value: "alice's", stale: false });
    hook.rerender({ client: bob.client });
    expect(hook.result.current).toEqual({ value: undefined, stale: false });
    await flush();
    expect(hook.result.current).toEqual({ value: undefined, stale: false });
    hook.unmount();
  });

  it("answers nothing for the provider's new user until that user's answer lands", async () => {
    // The provider's `userId` picks the client; the second user's read is held open.
    const held: Array<() => void> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if (!String(input).includes("/views/")) return Promise.resolve(new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
        const { userId: asked } = JSON.parse(String(init?.body ?? "{}")) as { userId?: string };
        const respond = () => new Response(JSON.stringify({ output: `${asked}'s`, topics: [] }), { status: 200, headers: { "content-type": "application/json" } });
        if (asked === "alice") return Promise.resolve(respond());
        return new Promise<Response>((resolve) => held.push(() => resolve(respond())));
      })
    );
    let userId = "alice";
    const hook = renderHook(() => useView(BOARD, undefined, { pollIntervalMs: null }), {
      wrapper: ({ children }: { children: ReactNode }) => createElement(FlowProvider, { flowKind: "desk", userId, baseUrl: "http://host.test", children })
    });
    await flush();
    expect(hook.result.current).toEqual({ value: "alice's", stale: false });
    userId = "bob";
    hook.rerender();
    expect(hook.result.current).toEqual({ value: undefined, stale: false });
    await act(async () => held.splice(0).forEach((release) => release()));
    await flush();
    expect(hook.result.current).toEqual({ value: "bob's", stale: false });
    hook.unmount();
  });
});
