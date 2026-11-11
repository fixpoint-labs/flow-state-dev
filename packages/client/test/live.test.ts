/**
 * `client.live`: the one live read. Every package and app that keeps a
 * screen current on change notices goes through it, so what these cases pin
 * is what every live screen does:
 *
 * - one read in flight and at most one waiting, however many notices land;
 * - the filter runs before the merge, so a notice nobody hears never turns a
 *   waiting read into a read of everything;
 * - the merge keeps one notice, and hands `null` for several different ones;
 * - the path rule rules a path out only when it is sure (FIX-1506: a false
 *   yes costs one read, a false no leaves a screen stale);
 * - a value is reported only when it changed;
 * - a failed read tries again on its own, 1 s doubling to 30 s, and says the
 *   screen is stale until a read lands, with no notice needed (D2);
 * - topics can come from the last result, and an unchanged set never churns;
 * - nothing is reported after `close`.
 *
 * The subscription is a recording double, so each notice is one the test
 * sends; one case runs through `createClient` to show `client.live` is the
 * client's own subscription.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type SubscribeOptions, type WireNotice, type WireTopic } from "../src";
import { liveRead } from "../src/live/live-read";
import { mayHold, storageRootsOf } from "../src/live/paths";

type Held = { topics: readonly WireTopic[]; options: SubscribeOptions; closed: boolean };

function fakeSubscribe() {
  const held: Held[] = [];
  const subscribe = (topics: readonly WireTopic[], options: SubscribeOptions) => {
    const entry: Held = { topics, options, closed: false };
    held.push(entry);
    return { close: () => void (entry.closed = true) };
  };
  const notify = (notice: WireNotice | null) => {
    for (const entry of held) if (!entry.closed) entry.options.onChange(notice);
  };
  return { subscribe, held, notify, open: () => held.filter((entry) => !entry.closed) };
}

/** A read the test settles by hand, one call at a time. */
function gatedRead<T>() {
  const calls: Array<{ notice: WireNotice | null; signal: AbortSignal; resolve: (value: T) => void; reject: (error: unknown) => void }> = [];
  const read = (notice: WireNotice | null, signal: AbortSignal) =>
    new Promise<T>((resolve, reject) => calls.push({ notice, signal, resolve, reject }));
  return { read, calls };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

const resource = (path?: string, scope: "user" | "org" = "user"): WireNotice => ({
  topic: { scope, ...(path !== undefined ? { resource: path } : {}) },
  kind: "resource"
});
const state: WireNotice = { topic: { scope: "user" }, kind: "state" };
const resync: WireNotice = { topic: { scope: "user" }, kind: "resync" };

describe("liveRead: one read in flight, one waiting", () => {
  it("reads at start, and fifty notices landing during one read make one more read, not fifty", async () => {
    const sub = fakeSubscribe();
    const gate = gatedRead<number>();
    liveRead(sub.subscribe, [{ scope: "user" }], { read: gate.read });
    expect(gate.calls).toHaveLength(1);

    for (let i = 0; i < 50; i++) sub.notify(resource(`tasks/${i}`));
    gate.calls[0]!.resolve(1);
    await flush();
    expect(gate.calls).toHaveLength(2);
    gate.calls[1]!.resolve(1);
    await flush();
    expect(gate.calls).toHaveLength(2);
  });

  it("does not read at start when told not to; the subscription's own connect read is its first", async () => {
    const sub = fakeSubscribe();
    const gate = gatedRead<number>();
    liveRead(sub.subscribe, [{ scope: "user" }], { read: gate.read, readNow: false });
    expect(gate.calls).toHaveLength(0);
    sub.notify(null);
    expect(gate.calls).toHaveLength(1);
  });

  it("reads on refresh(), through the same queue", async () => {
    const sub = fakeSubscribe();
    const gate = gatedRead<number>();
    const live = liveRead(sub.subscribe, [{ scope: "user" }], { read: gate.read });
    live.refresh();
    live.refresh();
    expect(gate.calls).toHaveLength(1);
    gate.calls[0]!.resolve(1);
    await flush();
    expect(gate.calls).toHaveLength(2);
  });
});

describe("liveRead: the filter runs before the merge", () => {
  it("hands the waiting read the one notice it heard, even when an unheard one landed meanwhile", async () => {
    const sub = fakeSubscribe();
    const gate = gatedRead<number>();
    liveRead(sub.subscribe, [{ scope: "user" }], { read: gate.read, hear: (notice) => notice.kind === "resource" });
    sub.notify(resource("tasks/a"));
    sub.notify(state);
    gate.calls[0]!.resolve(1);
    await flush();
    expect(gate.calls[1]!.notice).toEqual(resource("tasks/a"));
  });

  it("keeps the same notice twice, and hands null for two different ones", async () => {
    const sub = fakeSubscribe();
    const gate = gatedRead<number>();
    liveRead(sub.subscribe, [{ scope: "user" }], { read: gate.read });
    sub.notify(resource("tasks/a"));
    sub.notify(resource("tasks/a"));
    gate.calls[0]!.resolve(1);
    await flush();
    expect(gate.calls[1]!.notice).toEqual(resource("tasks/a"));

    sub.notify(resource("tasks/a"));
    sub.notify(resource("tasks/b"));
    gate.calls[1]!.resolve(1);
    await flush();
    expect(gate.calls[2]!.notice).toBeNull();
  });

  it("drops a notice the caller doesn't hear, but always reads on a connect, tick or resync", async () => {
    const sub = fakeSubscribe();
    const gate = gatedRead<number>();
    liveRead(sub.subscribe, [{ scope: "user" }], { read: gate.read, readNow: false, hear: () => false });
    sub.notify(state);
    expect(gate.calls).toHaveLength(0);
    sub.notify(resync);
    expect(gate.calls).toHaveLength(1);
    gate.calls[0]!.resolve(1);
    await flush();
    sub.notify(null);
    expect(gate.calls).toHaveLength(2);
  });
});

describe("liveRead: the path rule", () => {
  const hearsTasks = (notice: WireNotice | null) => {
    const sub = fakeSubscribe();
    const gate = gatedRead<number>();
    liveRead(sub.subscribe, [{ scope: "user" }], { read: gate.read, readNow: false, paths: ["tasks/"] });
    if (notice !== null) sub.notify(notice);
    return gate.calls.length;
  };

  it("reads for a path under a root or at it, and for a bare resource notice", () => {
    expect(hearsTasks(resource("tasks/a"))).toBe(1);
    expect(hearsTasks(resource("tasks"))).toBe(1);
    expect(hearsTasks(resource())).toBe(1);
  });

  it("reads nothing for a path outside every root, nor for a root that only shares a prefix", () => {
    expect(hearsTasks(resource("usage/readings"))).toBe(0);
    expect(hearsTasks(resource("tasksets/a"))).toBe(0);
  });

  it("applies only to resource notices: a state notice still reads", () => {
    expect(hearsTasks(state)).toBe(1);
  });

  it("takes roots per scope, and rules nothing out while they are unknown", () => {
    const sub = fakeSubscribe();
    const gate = gatedRead<number>();
    let known = false;
    liveRead(sub.subscribe, [{ scope: "user" }, { scope: "org" }], {
      read: gate.read,
      readNow: false,
      paths: (scope) => (!known ? undefined : scope === "org" ? ["inventory/workers"] : ["tasks"])
    });
    sub.notify(resource("anything/at-all"));
    expect(gate.calls).toHaveLength(1);
    gate.calls[0]!.resolve(1);
    known = true;
    return flush().then(() => {
      sub.notify(resource("tasks/a", "org"));
      expect(gate.calls).toHaveLength(1);
      sub.notify(resource("inventory/workers/w1", "org"));
      expect(gate.calls).toHaveLength(2);
    });
  });

  it("mayHold: FIX-1506's rule, every doubt a yes", () => {
    expect(mayHold("roster/a", ["roster"])).toBe(true);
    expect(mayHold("workforce/workers/a", ["roster", "workforce/workers"])).toBe(true);
    expect(mayHold("workforce/other/a", ["roster", "workforce/workers"])).toBe(false);
    expect(mayHold("anything", undefined)).toBe(true);
    expect(mayHold("anything", ["roster", ""])).toBe(true);
  });

  it("storageRootsOf: a key and its pattern's static prefix, or nothing ruled out while the manifest is unknown", () => {
    expect(storageRootsOf(undefined, "roster")).toBeUndefined();
    expect(storageRootsOf({ resources: undefined } as never, "roster")).toBeUndefined();
    expect(storageRootsOf({ resources: [] } as never, "roster")).toEqual(["roster"]);
    expect(storageRootsOf({ resources: [{ ref: "roster", pattern: "workforce/workers/*" }] } as never, "roster")).toEqual([
      "roster",
      "workforce/workers"
    ]);
    // A pattern with no static prefix rules nothing out.
    expect(mayHold("x/observations", storageRootsOf({ resources: [{ ref: "obs", pattern: "[topic]/observations" }] } as never, "obs"))).toBe(true);
  });
});

describe("liveRead: what it reports", () => {
  it("reports a value only when it changed, compared by value", async () => {
    const sub = fakeSubscribe();
    const gate = gatedRead<{ n: number }>();
    const seen: Array<{ n: number }> = [];
    liveRead(sub.subscribe, [{ scope: "user" }], { read: gate.read, onValue: (value) => seen.push(value) });
    gate.calls[0]!.resolve({ n: 1 });
    await flush();
    sub.notify(null);
    gate.calls[1]!.resolve({ n: 1 });
    await flush();
    sub.notify(null);
    gate.calls[2]!.resolve({ n: 2 });
    await flush();
    expect(seen).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it("reports nothing after close, aborts the read's signal, and closes the subscription", async () => {
    const sub = fakeSubscribe();
    const gate = gatedRead<number>();
    const seen: number[] = [];
    const live = liveRead(sub.subscribe, [{ scope: "user" }], { read: gate.read, onValue: (value) => seen.push(value) });
    live.close();
    expect(gate.calls[0]!.signal.aborted).toBe(true);
    expect(sub.open()).toHaveLength(0);
    gate.calls[0]!.resolve(1);
    await flush();
    expect(seen).toEqual([]);
  });
});

describe("liveRead: a failed read recovers on its own (D2)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("says stale, retries at 1 s with no notice, and reports the value that lands, unchanged or not", async () => {
    const sub = fakeSubscribe();
    const gate = gatedRead<number>();
    const seen: number[] = [];
    const stale: boolean[] = [];
    const errors: unknown[] = [];
    liveRead(sub.subscribe, [{ scope: "user" }], {
      read: gate.read,
      onValue: (value) => seen.push(value),
      onStale: (value) => stale.push(value),
      onError: (error) => errors.push(error),
      pollIntervalMs: null
    });
    gate.calls[0]!.resolve(7);
    await flush();
    sub.notify(null);
    gate.calls[1]!.reject(new Error("down"));
    await flush();
    expect(stale).toEqual([true]);
    expect(errors).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(999);
    expect(gate.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(gate.calls).toHaveLength(3);
    gate.calls[2]!.resolve(7);
    await flush();
    expect(stale).toEqual([true, false]);
    // A failure leaves the screen on an error: the next value that lands is reported.
    expect(seen).toEqual([7, 7]);
  });

  it("doubles the delay after each failure, up to 30 s, and starts over after a success", async () => {
    const sub = fakeSubscribe();
    const at: number[] = [];
    let fail = true;
    const start = Date.now();
    liveRead(sub.subscribe, [{ scope: "user" }], {
      read: async () => {
        at.push(Date.now() - start);
        if (fail) throw new Error("down");
        return 1;
      },
      pollIntervalMs: null
    });
    await vi.advanceTimersByTimeAsync(1_000 + 2_000 + 4_000 + 8_000 + 16_000 + 30_000 + 30_000);
    expect(at).toEqual([0, 1_000, 3_000, 7_000, 15_000, 31_000, 61_000, 91_000]);

    fail = false;
    await vi.advanceTimersByTimeAsync(30_000);
    fail = true;
    const before = at.length;
    sub.notify(null);
    await flush();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(at.length - before).toBe(2);
  });

  it("drops a waiting retry on close", async () => {
    const sub = fakeSubscribe();
    let reads = 0;
    const live = liveRead(sub.subscribe, [{ scope: "user" }], {
      read: async () => {
        reads += 1;
        throw new Error("down");
      },
      pollIntervalMs: null
    });
    await flush();
    live.close();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reads).toBe(1);
  });
});

describe("liveRead: the subscription it holds", () => {
  it("subscribes at the 3 s pace by default; another pace, or none, when asked", () => {
    const sub = fakeSubscribe();
    liveRead(sub.subscribe, [{ scope: "user" }], { read: async () => 1 });
    liveRead(sub.subscribe, [{ scope: "user" }], { read: async () => 1, pollIntervalMs: 30_000 });
    liveRead(sub.subscribe, [{ scope: "user" }], { read: async () => 1, pollIntervalMs: null });
    expect(sub.held.map((entry) => entry.options.pollIntervalMs)).toEqual([3_000, 30_000, undefined]);
    expect("pollIntervalMs" in sub.held[2]!.options).toBe(false);
  });

  it("takes topics from the last result: a new set re-subscribes and reads once; the same set in another order never churns", async () => {
    const sub = fakeSubscribe();
    const gate = gatedRead<{ value: string; topics: WireTopic[] }>();
    const seen: string[] = [];
    liveRead(sub.subscribe, [{ scope: "user" }], {
      topicsFromResult: true,
      read: gate.read,
      onValue: (value) => seen.push(value)
    });
    const a: WireTopic = { scope: "session", id: "a" };
    const b: WireTopic = { scope: "session", id: "b" };
    gate.calls[0]!.resolve({ value: "one", topics: [{ scope: "user" }, a] });
    await flush();
    expect(seen).toEqual(["one"]);
    expect(sub.held[0]!.closed).toBe(true);
    expect(sub.open().map((entry) => entry.topics)).toEqual([[{ scope: "user" }, a]]);
    // Read once after the new topics are held, so a change between the two is not missed.
    expect(gate.calls).toHaveLength(2);

    gate.calls[1]!.resolve({ value: "one", topics: [a, { scope: "user" }, a] });
    await flush();
    expect(sub.held).toHaveLength(2);
    expect(gate.calls).toHaveLength(2);

    sub.notify(null);
    gate.calls[2]!.resolve({ value: "two", topics: [a, b, { scope: "user" }] });
    await flush();
    expect(sub.held).toHaveLength(3);
    expect(sub.open().map((entry) => entry.topics)).toEqual([[a, b, { scope: "user" }]]);
    expect(seen).toEqual(["one", "two"]);
  });
});

describe("client.live", () => {
  it("is the client's own: it reads at start through the client, on a host with no push", async () => {
    const urls: string[] = [];
    const client = createClient({
      userId: "alice",
      fetcher: async (input) => {
        const url = String(input);
        urls.push(url);
        if (url.endsWith("/capabilities")) return Response.json({ push: null });
        return Response.json({ ok: true });
      }
    });
    const seen: unknown[] = [];
    const live = client.live([{ scope: "user" }], { read: () => client.capabilities(), onValue: (value) => seen.push(value) });
    await vi.waitFor(() => expect(seen).toEqual([{ push: null }]));
    live.close();
  });
});
