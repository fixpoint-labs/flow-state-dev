/**
 * `watchRoster` (FIX-2412): a view of the user's roster that follows hires,
 * forks, edits and fires made anywhere, through the client's one
 * `subscribe`, never a timer of its own.
 *
 * The reads go to a real engine through the HTTP router; the subscription is
 * a recording double, so each notice the watch hears is one the test sends.
 * What each case pins:
 *
 * - it hears the user topic, with the one fallback pace, and reads at start;
 * - a notice under either worker collection, a bare one, a connect and a
 *   `resync` read again, and a change reaches the view;
 * - a notice under another path, or a `state` notice, reads nothing;
 * - a read that finds nothing new reports nothing;
 * - notices that land during a read queue one more read, not one each;
 * - a failed read reaches `onError`, and the next read that lands reports
 *   even an unchanged roster, so the view leaves its failure;
 * - after stop, nothing reports and the subscription is closed.
 */
import { describe, expect, it } from "vitest";
import { createInMemoryStores } from "@flow-state-dev/engine/host";
import { createClient, type SubscribeOptions, type WireNotice, type WireTopic } from "@flow-state-dev/client";
import { createWorkforceClient, type RosterEntry } from "../src/workers/client";
import { bootHost, FIXTURE } from "./worker-model-harness";

type Subscribed = { topics: readonly WireTopic[]; options: SubscribeOptions; closed: boolean };

function harness(options: { failReads?: () => boolean } = {}) {
  const h = bootHost(createInMemoryStores());
  const subscriptions: Subscribed[] = [];
  let rosterReads = 0;
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    // One read of the roster lists the user's own workers' collection once.
    if (url.includes("workforceWorkers") && !url.includes("Standard")) {
      rosterReads += 1;
      if (options.failReads?.() === true) return new Response(JSON.stringify({ error: "down" }), { status: 502 });
    }
    return h.fetcherFor("alice")(input, init);
  };
  const client = createClient({ userId: "alice", fetcher });
  const source = {
    ...client,
    subscribe: (topics: readonly WireTopic[], subscribeOptions: SubscribeOptions) => {
      const held: Subscribed = { topics, options: subscribeOptions, closed: false };
      subscriptions.push(held);
      return { close: () => (held.closed = true) };
    }
  };
  const workforce = createWorkforceClient(source);
  const shown: RosterEntry[][] = [];
  const errors: unknown[] = [];
  const notify = (notice: WireNotice | null) => {
    for (const s of subscriptions) if (!s.closed) s.options.onChange(notice);
  };
  return { h, workforce, subscriptions, shown, errors, notify, reads: () => rosterReads };
}

const settle = async (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));
const ids = (entries: readonly RosterEntry[]) => entries.filter((e) => !e.standard).map((e) => e.id).sort();
const resource = (path?: string): WireNotice => ({
  topic: { scope: "user", ...(path !== undefined ? { resource: path } : {}) },
  kind: "resource"
});

describe("watchRoster", () => {
  it("hears the user topic at the fallback pace, reads at start, and shows a hire a notice tells it of", async () => {
    const t = harness();
    t.workforce.watchRoster((entries) => t.shown.push(entries));
    await settle();
    expect(t.subscriptions.map((s) => [s.topics, s.options.pollIntervalMs])).toEqual([[[{ scope: "user" }], 3_000]]);
    expect(t.shown.map(ids)).toEqual([[]]);

    await t.h.rosterAction("alice", "hire", { id: "scribe", flow: FIXTURE });
    t.notify(resource("workforce/workers/scribe"));
    await settle();
    expect(t.shown.map(ids)).toEqual([[], ["scribe"]]);
  });

  it("reads again on a bare notice, a standard worker's path, a connect and a resync; never on another path or a state notice", async () => {
    const t = harness();
    t.workforce.watchRoster((entries) => t.shown.push(entries));
    await settle();
    const start = t.reads();

    for (const unrelated of [resource("notes/today"), resource("workforce/workersish/x"), { topic: { scope: "user" }, kind: "state" } as WireNotice]) {
      t.notify(unrelated);
      await settle();
    }
    expect(t.reads()).toBe(start);

    const wakes: Array<WireNotice | null> = [resource(), resource("workforce/standard-workers/researcher"), null, { topic: { scope: "user" }, kind: "resync" }];
    for (const wake of wakes) {
      t.notify(wake);
      await settle();
    }
    expect(t.reads()).toBe(start + wakes.length);
    // Nothing changed, so nothing new was shown.
    expect(t.shown).toHaveLength(1);
  });

  it("coalesces notices that land during a read into one more read", async () => {
    const t = harness();
    t.workforce.watchRoster((entries) => t.shown.push(entries));
    await settle();
    const start = t.reads();
    for (let i = 0; i < 10; i++) t.notify(resource(`workforce/workers/w${i}`));
    await settle(150);
    expect(t.reads() - start).toBe(2);
  });

  it("tells onError of a failed read, and the next read that lands shows the roster even unchanged", async () => {
    let failing = false;
    const t = harness({ failReads: () => failing });
    t.workforce.watchRoster((entries) => t.shown.push(entries), { onError: (error) => t.errors.push(error) });
    await settle();
    failing = true;
    t.notify(null);
    await settle();
    expect(t.errors).toHaveLength(1);
    failing = false;
    t.notify(null);
    await settle();
    expect(t.shown.map(ids)).toEqual([[], []]);
  });

  it("reports nothing after stop, and closes its subscription", async () => {
    const t = harness();
    const stop = t.workforce.watchRoster((entries) => t.shown.push(entries));
    await settle();
    await t.h.rosterAction("alice", "hire", { id: "scribe", flow: FIXTURE });
    t.notify(resource("workforce/workers/scribe"));
    stop();
    await settle();
    expect(t.shown.map(ids)).toEqual([[]]);
    expect(t.subscriptions.every((s) => s.closed)).toBe(true);
  });
});
