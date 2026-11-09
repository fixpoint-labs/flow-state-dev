/**
 * Polling (FIX-2536): with no webhook, a subscribed session hears each event on
 * its thread once, within one poll period, through the same screens and
 * delivery as push.
 *
 * Why these matter: a laptop has no public URL, so polling is the only way its
 * sessions hear GitHub. One user's two sessions on a PR must cost one fetch, not
 * two (D1); a delivery the host lost must come back on a later poll, once, and
 * one that can never land must stop costing fetches (D2); a refused version
 * must not be judged again; a row no one needs must stop polling; and config
 * must not double a pinned repo on every restart (D3).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { declaredSubscriptionKey } from "../src/subscriptions/poll";
import { bootSubscriptionsHost, event, pollTimeline, type SubscriptionsHost } from "./subscriptions-harness";

const PR = "github:acme/api#412";
const T0 = Date.parse("2026-11-09T10:00:00Z");
const MINUTE = 60_000;

let now = T0;
const setNow = (at: number) => {
  now = at;
  vi.setSystemTime(at);
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  setNow(T0);
  pollTimeline.events = [];
  pollTimeline.calls = [];
  pollTimeline.incomplete = false;
});
afterEach(() => vi.useRealTimers());

async function withPolling(run: (host: SubscriptionsHost) => Promise<void>, poll: NonNullable<Parameters<typeof bootSubscriptionsHost>[0]>["poll"] = {}) {
  const host = bootSubscriptionsHost({ poll });
  try {
    await run(host);
  } finally {
    await host.dispose();
  }
}

/** Advance the clock a minute at a time for `minutes`, ticking at each. */
async function run(host: SubscriptionsHost, minutes: number) {
  for (let i = 0; i < minutes; i += 1) {
    setNow(now + MINUTE);
    await host.tick();
  }
}

/** A review on the PR at time `at`. */
const reviewAt = (at: number, fields: Parameters<typeof event>[0] = {}) => event({ at, received: at, ...fields });

describe("one poll per user and thread", () => {
  it("fetches a PR once a cadence for one user's two sessions on it, and each session hears each review once", () =>
    withPolling(async (host) => {
      const one = await host.follower("alice");
      const two = await host.follower("alice");
      await host.subscribe("alice", one, { thread: PR });
      await host.subscribe("alice", two, { thread: PR });
      expect(await host.pollRows("alice")).toHaveLength(1);
      pollTimeline.events.push(reviewAt(T0 + 30_000, { text: "first" }), reviewAt(T0 + 6 * MINUTE, { text: "second" }));
      await run(host, 15);
      const alicePolls = pollTimeline.calls.filter((c) => c.userId === "alice" && c.thread === PR);
      expect(alicePolls).toHaveLength(3);
      for (const session of [one, two]) expect(await host.heard(session)).toHaveLength(2);
    }));

  it("polls as each user apart: two users on one PR are two rows, and each fetch reaches only its own user's sessions", () =>
    withPolling(async (host) => {
      const alice = await host.follower("alice");
      const bob = await host.follower("bob");
      await host.subscribe("alice", alice, { thread: PR });
      await host.subscribe("bob", bob, { thread: PR });
      pollTimeline.events.push(reviewAt(T0 + 30_000));
      await run(host, 5);
      expect(new Set(pollTimeline.calls.map((c) => c.userId))).toEqual(new Set(["alice", "bob"]));
      expect(await host.heard(alice)).toHaveLength(1);
      expect(await host.heard(bob)).toHaveLength(1);
      // Each user's rows were written only in that user's cell.
      expect((await host.serviceRows("alice")).every((r) => r.toSession === alice)).toBe(true);
      expect((await host.serviceRows("bob")).every((r) => r.toSession === bob)).toBe(true);
    }));

  it("fires a row no sooner than its cadence, and only when due", () =>
    withPolling(async (host) => {
      const one = await host.follower("alice");
      await host.subscribe("alice", one, { thread: PR, everyMinutes: 15 });
      await run(host, 60);
      const at = host.fires.filter((f) => f.userId === "alice").map((f) => f.at);
      expect(at.length).toBe(4);
      for (let i = 1; i < at.length; i += 1) expect(at[i]! - at[i - 1]!).toBe(15 * MINUTE);
      expect(host.fires.every((f) => f.status === 202)).toBe(true);
    }));

  it("refuses a cadence off the list", () =>
    withPolling(async (host) => {
      const one = await host.follower("alice");
      expect(await host.subscribe("alice", one, { thread: PR, everyMinutes: 3 })).toBeUndefined();
      expect(await host.subscriptionRows("alice")).toHaveLength(0);
      expect(await host.pollRows("alice")).toHaveLength(0);
    }));
});

describe("the mark holds at what is still owed", () => {
  it("lands a delivery the host lost on a later poll, once, and sends no validator while it is owed", () =>
    withPolling(async (host) => {
      const one = await host.follower("alice");
      await host.subscribe("alice", one, { thread: PR });
      pollTimeline.events.push(reviewAt(T0 + 30_000, { text: "lost the first time" }));
      const lost = await host.loseDispatches("onMessageReceived");
      await run(host, 5);
      lost.restore();
      expect(lost.lost()).toBeGreaterThan(0);
      expect(await host.heard(one)).toEqual([]);
      const [row] = await host.pollRows("alice");
      expect(row!.input.owed).toHaveLength(1);
      await run(host, 20);
      expect(await host.heard(one)).toHaveLength(1);
      // The poll after the loss fetched without a validator, so an unchanged answer couldn't hide the retry;
      // once nothing is owed, the validators come back.
      const afterLoss = pollTimeline.calls.filter((c) => c.userId === "alice");
      expect(afterLoss[1]!.etags).toBe(false);
      expect(afterLoss.at(-1)!.etags).toBe(true);
      expect(await host.serviceRows("alice")).toHaveLength(1);
    }));

  it("gives up an event no poll could land after three polls, and stops refetching it", () =>
    withPolling(async (host) => {
      const one = await host.follower("alice");
      await host.subscribe("alice", one, { thread: PR });
      const review = reviewAt(T0 + 30_000, { text: "never lands" });
      pollTimeline.events.push(review);
      const lost = await host.loseDispatches("onMessageReceived");
      await run(host, 15);
      lost.restore();
      // Given up on the third poll: the mark moved past it, so later polls neither fetch nor send it.
      const [row] = await host.pollRows("alice");
      expect(row!.input.owed).toBeUndefined();
      expect(row!.input.polledThrough).toBeGreaterThan(review.at);
      const polls = pollTimeline.calls.length;
      await run(host, 10);
      expect(pollTimeline.calls.slice(polls).every((c) => c.since! > review.at)).toBe(true);
      expect((await host.serviceRows("alice")).filter((r) => r.status === "delivered")).toHaveLength(0);
    }));

  it("records a version the screens refused while the mark is held, so its refetch is dropped unjudged", () =>
    withPolling(async (host) => {
      const one = await host.follower("alice");
      const id = ((await host.subscribe("alice", one, { thread: PR, screens: [{ screen: "words", any: ["deploy"] }] })) as { id: string }).id;
      const held = reviewAt(T0 + 20_000, { text: "deploy is blocked" });
      const refused = reviewAt(T0 + 40_000, { text: "nothing about shipping" });
      pollTimeline.events.push(held, refused);
      const lost = await host.loseDispatches("onMessageReceived");
      await run(host, 5);
      lost.restore();
      // The mark holds at the lost delivery, before the refused one: the refusal is remembered, not re-judged.
      expect((await host.pollRows("alice"))[0]!.input.polledThrough).toBe(held.at);
      expect((await host.cursorOf("alice", id)).screened).toEqual([[refused.object.id, refused.object.version, refused.at]]);
      await run(host, 15);
      expect(await host.heard(one)).toHaveLength(1);
      // Once the mark passes it, the entry is pruned: a fetch from the mark never returns it.
      expect((await host.cursorOf("alice", id)).screened).toEqual([]);
    }));
});

describe("a poll that couldn't read everything", () => {
  it("says so in each session on the thread, instead of dropping what it didn't reach in silence", () =>
    withPolling(async (host) => {
      const one = await host.follower("alice");
      await host.subscribe("alice", one, { thread: PR });
      pollTimeline.incomplete = true;
      await run(host, 5);
      const heard = await host.heard(one);
      expect(heard).toHaveLength(1);
      expect(heard[0]).toContain("busier than one poll reads");
    }));
});

describe("a thread's closing", () => {
  it("sends nothing after a close whose send was lost, then lands the close and ends the subscription", () =>
    withPolling(async (host) => {
      const one = await host.follower("alice");
      const id = ((await host.subscribe("alice", one, { thread: PR })) as { id: string }).id;
      const close = reviewAt(T0 + 20_000, { kind: "pull_request", title: "Pull request #412 merged", closes: true });
      const after = reviewAt(T0 + 40_000, { kind: "comment", text: "after the merge" });
      pollTimeline.events.push(close, after);
      // Only the close's send is lost; the comment after it, in the same fetch, would go through.
      const held = await host.holdFirstDispatch("onMessageReceived");
      const ticking = run(host, 5);
      await held.reached;
      held.release({ lose: true });
      await ticking;
      expect(await host.heard(one)).toEqual([]);
      await run(host, 10);
      const heard = await host.heard(one);
      expect(heard).toHaveLength(1);
      expect(heard[0]).toContain("merged");
      expect((await host.subscriptionRows("alice")).find((r) => r.id === id)).toMatchObject({ enabled: false, endedReason: "thread_closed" });
    }));
});

describe("a row's life", () => {
  it("ends the poll row at its next fire once no subscription on it is on", () =>
    withPolling(async (host) => {
      const one = await host.follower("alice");
      const id = ((await host.subscribe("alice", one, { thread: PR })) as { id: string }).id;
      await host.unsubscribe("alice", one, id);
      await run(host, 5);
      const [row] = await host.pollRows("alice");
      expect(row!.enabled).toBe(false);
      expect(host.index!.rows.size).toBe(0);
      const fired = host.fires.length;
      await run(host, 10);
      expect(host.fires.length).toBe(fired);
    }));
});

describe("declared routines on a polled thread", () => {
  // The seed is the routines' own; what polling owns is ending a declared row whose entry left config.
  it("ends a declared routine's row at its next fire once its entry leaves config, and leaves a session's own subscription on", () => {
    let declared = [{ id: "api-pr" }];
    return withPolling(
      async (host) => {
        const one = await host.follower("alice");
        const own = ((await host.subscribe("alice", one, { thread: PR })) as { id: string }).id;
        const key = await declaredSubscriptionKey("api-pr");
        await host.storeAs("alice", own, key);
        await run(host, 5);
        expect((await host.subscriptionRows("alice")).find((r) => r.id === key)).toMatchObject({ enabled: true });
        declared = [];
        await run(host, 5);
        const rows = await host.subscriptionRows("alice");
        expect(rows.find((r) => r.id === key)).toMatchObject({ enabled: false, endedReason: "config_removed" });
        expect(rows.find((r) => r.id === own)).toMatchObject({ enabled: true });
      },
      { declared: () => declared }
    );
  });

  it("names a declared routine's row as the routines' seed does: cfg_ and a hash of the roster flow and the entry id", async () => {
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode("workforce-roster\napi-pr")));
    expect(await declaredSubscriptionKey("api-pr")).toBe(`cfg_${[...digest.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("")}`);
  });
});

