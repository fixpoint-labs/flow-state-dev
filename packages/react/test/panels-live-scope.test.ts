// @vitest-environment happy-dom
/**
 * `Roster` and `BoardColumns` with `live` (FIX-1506): the panel reads its
 * collection again when another session changes it, heard through
 * `client.subscribe` on the session's, user's and org's topics.
 *
 * Why it matters: a roster two people watched showed a worker hired by the
 * other only after a remount or Retry. Reads are counted, not only rows
 * drawn: a panel that re-read on every notice, or on a timer, draws the same
 * rows and costs a read per change anywhere in the org.
 *
 * The roster's collection key (`roster`) is not its storage path
 * (`workforce/workers/*`), so the panel learns the path from the manifest.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { topic, type SubscribeOptions, type WireNotice, type WireTopic } from "@flow-state-dev/client";
import { Roster } from "../src/components/panels/Roster";
import { BoardColumns } from "../src/components/panels/BoardColumns";

const SESSION = "s1";

function hostClient(pattern: string, ref: string) {
  const subscriptions: Array<{ topics: readonly WireTopic[]; options: SubscribeOptions; closed: boolean }> = [];
  const client = {
    resources: {
      listCollectionItems: vi.fn(async () => ({ items: [] })),
      getResourceManifest: vi.fn(async () => ({
        flowKind: "desk",
        resources: [{ ref, kind: "collection", scope: "org", pattern, hasClientData: false, client: {} }]
      }))
    },
    subscribe: vi.fn((topics: readonly WireTopic[], options: SubscribeOptions) => {
      const entry = { topics, options, closed: false };
      subscriptions.push(entry);
      return {
        close() {
          entry.closed = true;
        }
      };
    })
  };
  const hear = async (notice: WireNotice | null) => {
    const open = subscriptions.filter((s) => !s.closed);
    expect(open).toHaveLength(1);
    await act(async () => {
      open[0]!.options.onChange(notice);
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });
  };
  return { client, subscriptions, hear, reads: () => client.resources.listCollectionItems.mock.calls.length };
}

afterEach(() => cleanup());

describe("Roster live", () => {
  it("reads again on a change to its collection from another session, and on nothing else", async () => {
    const host = hostClient("workforce/workers/*", "roster");
    render(createElement(Roster, { sessionId: SESSION, client: host.client as never, live: true }));
    await waitFor(() => expect(host.subscriptions).toHaveLength(1));
    expect(host.subscriptions[0]!.topics).toEqual([topic.session(SESSION), topic.user(), topic.org()]);
    await waitFor(() => expect(host.reads()).toBe(1));

    await host.hear({ topic: topic.org({ resource: "workforce/workers/ada" }), kind: "resource" });
    expect(host.reads()).toBe(2);

    await host.hear({ topic: topic.org({ resource: "licenses/one" }), kind: "resource" });
    await host.hear({ topic: topic.org(), kind: "state" });
    await host.hear({ topic: topic.session(SESSION), kind: "items" });
    expect(host.reads()).toBe(2);

    // A connect, a reconnect or a tick reads again.
    await host.hear(null);
    expect(host.reads()).toBe(3);
  });

  it("without `live`, subscribes nothing", async () => {
    const host = hostClient("workforce/workers/*", "roster");
    render(createElement(Roster, { sessionId: SESSION, client: host.client as never }));
    await waitFor(() => expect(host.reads()).toBe(1));
    expect(host.subscriptions).toHaveLength(0);
  });
});

describe("a live panel over a pattern with no static prefix", () => {
  it("reads again on any resource change, since no path can be ruled out", async () => {
    const host = hostClient("[topic]/observations", "observations");
    render(createElement(Roster, { sessionId: SESSION, collectionRef: "observations", client: host.client as never, live: true }));
    await waitFor(() => expect(host.subscriptions).toHaveLength(1));
    await waitFor(() => expect(host.reads()).toBe(1));
    await waitFor(() => expect(host.client.resources.getResourceManifest).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    await host.hear({ topic: topic.org({ resource: "t1/observations" }), kind: "resource" });
    expect(host.reads()).toBe(2);
  });
});

describe("BoardColumns live", () => {
  it("reads again on a change to its board", async () => {
    const host = hostClient("tasks/eng/**", "eng.feature.work");
    render(createElement(BoardColumns, { sessionId: SESSION, boardRef: "eng.feature.work", client: host.client as never, live: true }));
    await waitFor(() => expect(host.subscriptions).toHaveLength(1));
    await waitFor(() => expect(host.reads()).toBe(1));
    await host.hear({ topic: topic.org({ resource: "tasks/eng/t1" }), kind: "resource" });
    expect(host.reads()).toBe(2);
    await host.hear({ topic: topic.org({ resource: "tasks/ops/t1" }), kind: "resource" });
    expect(host.reads()).toBe(2);
  });
});
