// FIX-2784; FIX-2535 D3.
/**
 * A pull request a coding session follows (`followPullRequest`) reaches that
 * session when it closes, on push and on poll, whatever the follow's kinds and
 * screens, and then the follow ends.
 *
 * Why it matters: a task that opened a PR waits on it until it merges or
 * closes, and only a message delivered to its session wakes it. The follow
 * hears `review`, `comment` and `check`; a merge is a `pull_request` event, and
 * the person who merges is usually the subscriber, whose own actions the `own`
 * screen drops. Without this, a merged PR's task stays open until someone
 * types in its session. A routine's close is unchanged: its kinds and screens
 * still decide it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootSubscriptionsHost, event, pollTimeline, type SubscriptionsHost } from "./subscriptions-harness";

const PR = "github:acme/api#412";
const T0 = Date.parse("2026-11-09T10:00:00Z");
const MINUTE = 60_000;

/** Alice merges #412 herself: the `own` screen would drop it for her subscription. */
const merged = (fields: Parameters<typeof event>[0] = {}) =>
  event({ kind: "pull_request", title: "Pull request #412 merged", text: "", closes: true, sender: { id: "alice-gh", name: "Alice", role: "member" }, ...fields });

async function following(host: SubscriptionsHost) {
  const session = await host.follower("alice");
  const ran = await host.act("alice", session, "respond", { message: "opened it [follow-pr:412]" }, "follower");
  expect((ran as { error?: unknown }).error).toBeUndefined();
  const rows = await host.subscriptionRows("alice");
  expect(rows.map((r) => ({ thread: r.thread, kinds: r.kinds, hearsClose: r.hearsClose }))).toEqual([
    { thread: PR, kinds: ["review", "comment", "check"], hearsClose: true }
  ]);
  return session;
}

describe("a followed pull request's close, on push", () => {
  it("reaches the session that follows it, though its own subscriber merged it, then ends the follow", async () => {
    const host = bootSubscriptionsHost();
    try {
      const session = await following(host);
      await host.route(merged());
      const heard = await host.heard(session);
      expect(heard).toHaveLength(1);
      expect(heard[0]).toContain("merged");
      expect((await host.subscriptionRows("alice")).map((r) => [r.enabled, r.endedReason])).toEqual([[false, "thread_closed"]]);
    } finally {
      await host.dispose();
    }
  });

  it("leaves a routine on the same PR as signed: its own merge ends it unheard", async () => {
    const host = bootSubscriptionsHost();
    try {
      const routine = await host.follower("alice");
      await host.subscribe("alice", routine, { thread: PR, kinds: ["review"] });
      await host.route(merged());
      expect(await host.heard(routine)).toEqual([]);
      expect((await host.subscriptionRows("alice")).map((r) => [r.enabled, r.endedReason])).toEqual([[false, "thread_closed"]]);
    } finally {
      await host.dispose();
    }
  });
});

describe("a followed pull request's close, on poll", () => {
  let now = T0;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    now = T0;
    vi.setSystemTime(now);
    pollTimeline.events = [];
    pollTimeline.calls = [];
    pollTimeline.incomplete = false;
    pollTimeline.overlapMs = 0;
  });
  afterEach(() => vi.useRealTimers());

  it("reaches the session that follows it, then ends the follow", async () => {
    const host = bootSubscriptionsHost({ poll: {} });
    try {
      const session = await following(host);
      expect(await host.pollSchedules("alice")).toHaveLength(1);
      pollTimeline.events.push(merged({ at: T0 + 30_000, received: T0 + 30_000 }));
      for (let i = 0; i < 10; i += 1) {
        now += MINUTE;
        vi.setSystemTime(now);
        await host.tick();
      }
      const heard = await host.heard(session);
      expect(heard).toHaveLength(1);
      expect(heard[0]).toContain("merged");
      expect((await host.subscriptionRows("alice")).map((r) => [r.enabled, r.endedReason])).toEqual([[false, "thread_closed"]]);
    } finally {
      await host.dispose();
    }
  });
});
