// @vitest-environment happy-dom
/**
 * `useView` (FIX-2623): a screen watches a view with no topics of its own.
 * Two screens watching the same view and input share one read; the value
 * follows a change notice on the topics the answer named; a failed read says
 * `stale` until one lands; unmounting the last watcher closes the
 * subscription.
 */
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { SubscribeOptions, ViewResult, WireNotice, WireTopic } from "@flow-state-dev/client";
import { viewRef } from "@flow-state-dev/client";
import type { ViewWatchClient } from "@flow-state-dev/client/internal";
import { useView } from "../src";

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
});
