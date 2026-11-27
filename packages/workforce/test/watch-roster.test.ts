// FIX-2412; FIX-2623.
/**
 * `watchRoster`: a watch of the user's roster that follows hires, forks,
 * edits and fires made anywhere, through the roster view and the client's
 * one `subscribe`, never a timer of its own.
 *
 * The reads go to a real engine through the HTTP router; the subscription is
 * a recording double, so each notice the watch hears is one the test sends.
 * What each case pins:
 *
 * - it reads at start and hears the topics the view's answer names (the
 *   user's), with the one fallback pace;
 * - a notice on that topic, a connect and a `resync` read again, and a change
 *   reaches the watch;
 * - a read that finds nothing new reports nothing;
 * - notices that land during a read queue one more read, not one each;
 * - a failed read reaches `onError`, and the next read that lands reports
 *   even an unchanged roster, so the view leaves its failure;
 * - a failed read is tried again on its own, with no notice;
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
    // One read of the roster is one call of the roster view.
    if (url.includes("/views/roster")) {
      rosterReads += 1;
      if (options.failReads?.() === true) return new Response(JSON.stringify({ error: "down" }), { status: 502 });
    }
    return h.fetcherFor("alice")(input, init);
  };
  const client = createClient({ userId: "alice", fetcher });
  const subscribe = (topics: readonly WireTopic[], subscribeOptions: SubscribeOptions) => {
    const held: Subscribed = { topics, options: subscribeOptions, closed: false };
    subscriptions.push(held);
    return { close: () => (held.closed = true) };
  };
  // The client, with its subscription recorded.
  const source = { ...client, subscribe: subscribe as typeof client.subscribe };
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
  it("reads at start, hears the topics the view's answer names at the fallback pace, and shows a hire a notice tells it of", async () => {
    const t = harness();
    t.workforce.watchRoster((entries) => t.shown.push(entries));
    await settle();
    // The live read starts on no topic, then follows the first answer's.
    expect(t.subscriptions.filter((s) => !s.closed).map((s) => [s.topics, s.options.pollIntervalMs])).toEqual([[[{ scope: "user" }], 3_000]]);
    expect(t.shown.map(ids)).toEqual([[]]);

    await t.h.rosterAction("alice", "hire", { id: "scribe", flow: FIXTURE });
    t.notify(resource("workforce/workers/scribe"));
    await settle();
    expect(t.shown.map(ids)).toEqual([[], ["scribe"]]);
  });

  it("reads again on a notice on the view's topic, a connect and a resync, and reports only a change", async () => {
    const t = harness();
    t.workforce.watchRoster((entries) => t.shown.push(entries));
    await settle();
    const start = t.reads();

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

  it("recovers from a failed read on its own, with no notice: while push is up nothing else would read again", async () => {
    let failing = false;
    const t = harness({ failReads: () => failing });
    t.workforce.watchRoster((entries) => t.shown.push(entries), { onError: (error) => t.errors.push(error) });
    await settle();
    failing = true;
    t.notify(null);
    await settle();
    expect(t.errors).toHaveLength(1);
    failing = false;
    await t.h.rosterAction("alice", "hire", { id: "scribe", flow: FIXTURE });
    // No notice: the retry, 1 s after the failure, is what reads.
    await settle(1_500);
    expect(t.shown.map(ids)).toEqual([[], ["scribe"]]);
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
