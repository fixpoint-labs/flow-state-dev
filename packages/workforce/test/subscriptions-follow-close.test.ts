// FIX-2784; FIX-2535 D3.
/**
 * A pull request a coding session follows (`followPullRequest`) reaches that
 * session when it closes, on push and on poll, whatever the follow's kinds and
 * screens, and then the follow ends.
 *
 * Why it matters: a task that opened a PR waits on it until it merges or
 * closes, and only a message delivered to its session wakes it. The follow
 * hears `review`, `comment` and `check`; a merge is a `pull_request` event, and
 * whoever merges is usually the subscriber, whose own actions the `own`
 * screen drops. Without this, a merged PR's task stays open until someone
 * types in its session. A routine's close is unchanged: its kinds and screens
 * still decide it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { unheard, type Routed } from "../src/service-flows/service-flow";
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
  const subscriptions = await host.subscriptionRows("alice");
  expect(subscriptions.map((r) => ({ thread: r.thread, kinds: r.kinds, hearsClose: r.hearsClose }))).toEqual([
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

  it("counts the close as heard: a coordinator following the repo for what nobody heard isn't sent it too", async () => {
    // The app forwards pull_request events, so a close nobody heard would reach the coordinator as inferred work.
    const host = bootSubscriptionsHost({ service: { forwards: { kinds: ["pull_request"] } } });
    try {
      const session = await following(host);
      const coordinator = await host.conversation("alice", "lead");
      expect(await host.subscribe("alice", coordinator, { thread: "github:acme/api", unmatched: true, interest: "what nobody picked up" }, undefined, "coordinator")).toHaveProperty("id");
      const routed = await host.route(merged({ sender: { id: "octocat", name: "The Octocat", role: "member" } }));
      expect(routed.output).not.toHaveProperty("unmatched");
      // The exported helper answers as routing does.
      expect(unheard(routed.output as Routed)).toBe(false);
      expect(await host.heard(session)).toHaveLength(1);
      expect((await host.serviceRows("alice")).filter((message) => message.forward !== undefined)).toEqual([]);
    } finally {
      await host.dispose();
    }
  });

  it("still reaches the session after it saves its own routine on the PR it follows", async () => {
    // The routine lands on the follow's subscription (one per session and thread): the close must stay heard.
    const host = bootSubscriptionsHost();
    try {
      const session = await following(host);
      expect(await host.subscribe("alice", session, { thread: PR, kinds: ["review"] })).toHaveProperty("id");
      expect((await host.subscriptionRows("alice")).map((r) => [r.kinds, r.hearsClose])).toEqual([[["review"], true]]);
      await host.route(merged());
      const heard = await host.heard(session);
      expect(heard).toHaveLength(1);
      expect(heard[0]).toContain("merged");
    } finally {
      await host.dispose();
    }
  });

  it("keeps the run's task on the follow after its session saves a routine on the PR, so the task's failure still ends it", async () => {
    const host = bootSubscriptionsHost();
    try {
      const session = await host.follower("alice");
      const ran = await host.act("alice", session, "respond", { message: "opened it [follow-pr:412] [run-task:task-7]" }, "follower");
      expect((ran as { error?: unknown }).error).toBeUndefined();
      expect((await host.subscriptionRows("alice")).map((r) => r.taskId)).toEqual(["task-7"]);
      // The session's state names no task, so the routine's own write carries none.
      expect(await host.subscribe("alice", session, { thread: PR, kinds: ["review"] })).toHaveProperty("id");
      expect((await host.subscriptionRows("alice")).map((r) => [r.hearsClose, r.taskId])).toEqual([[true, "task-7"]]);
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

  it("still sends the close when a comment before it can't be delivered and is given up", async () => {
    const host = bootSubscriptionsHost({ poll: {} });
    try {
      const session = await following(host);
      pollTimeline.events.push(
        event({ kind: "comment", text: "before the merge", object: { id: "comment-7", version: 1 }, at: T0 + 20_000, received: T0 + 20_000 }),
        merged({ object: { id: "pr-412-closed", version: 1 }, at: T0 + 40_000, received: T0 + 40_000 })
      );
      // Only the comment's sends are lost, every time: it is given up after three polls.
      const lost = await host.loseDispatches("onMessageReceived", (record) => { return JSON.stringify(record).includes("comment-7"); });
      for (let i = 0; i < 30; i += 1) {
        now += MINUTE;
        vi.setSystemTime(now);
        await host.tick();
      }
      lost.restore();
      expect(lost.lost()).toBeGreaterThan(0);
      const heard = await host.heard(session);
      expect(heard.filter((text) => text.includes("merged") && !text.includes("given up"))).toHaveLength(1);
      expect((await host.subscriptionRows("alice")).map((r) => [r.enabled, r.endedReason])).toEqual([[false, "thread_closed"]]);
    } finally {
      await host.dispose();
    }
  });
});
