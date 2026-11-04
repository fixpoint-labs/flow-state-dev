/**
 * Subscriptions and delivery (FIX-2534): a session that subscribed to a thread
 * hears each event on it once, from the service, after the config screens, and
 * nothing it didn't ask for, can't read, or caused itself.
 *
 * Why these matter: the epic's first promise is that a coding task hears the
 * reviews on its PR with nobody relaying them. A second session on the same PR
 * must hear them too (one dedupe key would starve it), a redelivery must add
 * nothing, and one user's private repo must never reach another user.
 */
import { describe, expect, it } from "vitest";
import { bootSubscriptionsHost, event, revoked, type SubscriptionsHost } from "./subscriptions-harness";

const PR = "github:acme/api#412";

async function withHost(run: (host: SubscriptionsHost) => Promise<void>, options: Parameters<typeof bootSubscriptionsHost>[0] = {}) {
  const host = bootSubscriptionsHost(options);
  try {
    await run(host);
  } finally {
    await host.dispose();
  }
}

describe("a subscribed session hears each event once", () => {
  it("delivers one review to each of two sessions on one PR, from service:github, marked outside content", () =>
    withHost(async (host) => {
      const one = await host.follower("alice");
      const two = await host.follower("alice");
      expect(await host.subscribe("alice", one, { thread: PR })).toHaveProperty("id");
      expect(await host.subscribe("alice", two, { thread: PR })).toHaveProperty("id");
      const review = event({ text: "Please rename the handler." });
      await host.route(review);
      for (const session of [one, two]) {
        const heard = await host.heard(session);
        expect(heard).toHaveLength(1);
        expect(heard[0]).toMatch(/^From service:github: Outside content from github/);
        expect(heard[0]).toContain("Please rename the handler.");
      }
    }));

  it("adds nothing on a redelivery of the same version, and delivers the next version", () =>
    withHost(async (host) => {
      const one = await host.follower("alice");
      await host.subscribe("alice", one, { thread: PR });
      const review = event();
      await host.route(review);
      const again = await host.route({ ...review, deliveryId: "redelivered" });
      expect(await host.heard(one)).toHaveLength(1);
      // The subscription's cursor stops it before any send: it costs the cap nothing.
      const [run] = again.ownerRuns;
      expect((await run!.finished!).output).toEqual({ act: "seen" });
      expect((await host.cursorOf("alice", (await host.subscriptionRows("alice"))[0]!.id)).window.sent).toBe(1);
      await host.route({ ...review, object: { ...review.object, version: 2 }, text: "Edited." });
      expect(await host.heard(one)).toHaveLength(2);
    }));

  it("lands on the next delivery of the event when the recipient's host lost the first: a lost dispatch isn't seen", () =>
    withHost(async (host) => {
      const one = await host.follower("alice");
      await host.subscribe("alice", one, { thread: PR });
      const review = event({ text: "lost the first time" });
      const lost = await host.loseDispatches("onMessageReceived");
      await host.route(review);
      lost.restore();
      expect(lost.lost()).toBeGreaterThan(0);
      expect(await host.heard(one)).toEqual([]);
      await host.route({ ...review, deliveryId: "redelivered" });
      expect(await host.heard(one)).toHaveLength(1);
    }));

  it("hears nothing on a thread it didn't subscribe to, or of a kind it didn't list", () =>
    withHost(async (host) => {
      const one = await host.follower("alice");
      await host.subscribe("alice", one, { thread: PR, kinds: ["check"] });
      await host.route(event());
      await host.route(event({ threads: ["github:acme/web", "github:acme/web#9"], kind: "check" }));
      expect(await host.heard(one)).toEqual([]);
      await host.route(event({ kind: "check" }));
      expect(await host.heard(one)).toHaveLength(1);
    }));
});

describe("the config screens", () => {
  it("refuse an outsider by default and pass one when the subscription opts in (fail closed, epic Q1)", () =>
    withHost(async (host) => {
      const closed = await host.follower("alice");
      const open = await host.follower("alice");
      await host.subscribe("alice", closed, { thread: PR });
      await host.subscribe("alice", open, { thread: PR, outsiders: true });
      await host.route(event({ sender: { id: "drive-by", name: "Drive By", role: "outsider" } }));
      await host.route(event({ sender: { id: "who", name: "Who", role: "unknown" } }));
      expect(await host.heard(closed)).toEqual([]);
      expect(await host.heard(open)).toHaveLength(2);
    }));

  it("pass a listed bot and refuse an unlisted one", () =>
    withHost(async (host) => {
      const one = await host.follower("alice");
      await host.subscribe("alice", one, { thread: PR });
      await host.route(event({ sender: { id: "codex", name: "Codex", role: "bot" }, text: "codex says" }));
      await host.route(event({ sender: { id: "spam-bot", name: "Spam", role: "bot" }, text: "spam says" }));
      expect((await host.heard(one)).map((t) => t.includes("codex says"))).toEqual([true]);
    }));

  it("drop the subscriber's own actions", () =>
    withHost(async (host) => {
      const one = await host.follower("alice");
      await host.subscribe("alice", one, { thread: PR });
      await host.route(event({ sender: { id: "alice-gh", name: "Alice", role: "member" } }));
      expect(await host.heard(one)).toEqual([]);
    }));

  it("apply each listed screen: labels, words and allow all must pass", () =>
    withHost(async (host) => {
      const labels = await host.follower("alice");
      const words = await host.follower("alice");
      const allow = await host.follower("alice");
      await host.subscribe("alice", labels, { thread: PR, screens: [{ screen: "labels", any: ["bug"] }] });
      await host.subscribe("alice", words, { thread: PR, screens: [{ screen: "words", any: ["panic", "crash"] }] });
      await host.subscribe("alice", allow, { thread: PR, screens: [{ screen: "allow", ids: ["octocat"] }] });
      await host.route(event({ labels: ["bug"], text: "fine", sender: { id: "hubot", name: "Hubot", role: "member" } }));
      await host.route(event({ text: "This will PANIC on nil.", sender: { id: "octocat", name: "The Octocat", role: "member" } }));
      expect(await host.heard(labels)).toHaveLength(1);
      expect(await host.heard(words)).toHaveLength(1);
      expect(await host.heard(allow)).toHaveLength(1);
      expect((await host.heard(allow))[0]).toContain("PANIC");
    }));

  it("return one verdict per nominated subscription, and report the share the config screens decided", () =>
    withHost(async (host) => {
      const listed = await host.follower("alice");
      const open = await host.follower("alice");
      await host.subscribe("alice", listed, { thread: PR, screens: [{ screen: "words", any: ["panic"] }] });
      await host.subscribe("alice", open, { thread: PR });
      const routed = await host.route(event({ text: "no match here" }));
      const output = routed.output as { verdicts: Array<{ subscription: string; pass: boolean; reason: string }>; selected: number; decidedByConfig: number };
      expect(output.verdicts).toHaveLength(2);
      expect(output.verdicts.map((v) => v.pass).sort()).toEqual([false, true]);
      // The words screen refused one: decided. The other passed with nothing but its sentence: open.
      expect([output.selected, output.decidedByConfig]).toEqual([2, 1]);
    }));
});

describe("who hears what", () => {
  it("refuses a subscription to a thread the user can't read, and delivers a private event only to who can", () =>
    withHost(async (host) => {
      const privateThread = "github:acme/private-api#7";
      const alice = await host.follower("alice");
      const bob = await host.follower("bob");
      expect(await host.subscribe("alice", alice, { thread: privateThread })).toHaveProperty("id");
      expect(await host.subscribe("bob", bob, { thread: privateThread })).toEqual({ refused: expect.stringMatching(/^not_readable/) });
      await host.route(event({ threads: ["github:acme/private-api", privateThread], audience: "private", text: "secret diff" }));
      expect(await host.heard(alice)).toHaveLength(1);
      expect(await host.heard(bob)).toEqual([]);
      expect(await host.subscriptionRows("bob")).toEqual([]);
    }));

  it("checks a private event again as its subscriber: access lost since subscribing delivers nothing", () =>
    withHost(async (host) => {
      const privateThread = "github:acme/private-api#7";
      const alice = await host.follower("alice");
      await host.subscribe("alice", alice, { thread: privateThread });
      revoked.add("alice");
      try {
        await host.route(event({ threads: ["github:acme/private-api", privateThread], audience: "private", text: "secret diff" }));
        expect(await host.heard(alice)).toEqual([]);
      } finally {
        revoked.delete("alice");
      }
    }));

  it("refuses a sentence with no thread, and a thread of another provider", () =>
    withHost(async (host) => {
      const one = await host.follower("alice");
      expect(await host.subscribe("alice", one, { thread: "" })).toEqual({ refused: expect.stringMatching(/^no_thread/) });
      expect(await host.subscribe("alice", one, { thread: "gitlab:acme/api#1" })).toEqual({ refused: expect.stringMatching(/^wrong_provider/) });
    }));
});

describe("a subscription's end", () => {
  it("hears nothing after it unsubscribed, and only its own session may end it", () =>
    withHost(async (host) => {
      const one = await host.follower("alice");
      const other = await host.follower("alice");
      const { id } = (await host.subscribe("alice", one, { thread: PR })) as { id: string };
      expect(await host.unsubscribe("alice", other, id)).toEqual({ refused: expect.stringMatching(/^not_yours/) });
      expect(await host.unsubscribe("alice", one, id)).toEqual({ ended: id });
      await host.route(event());
      expect(await host.heard(one)).toEqual([]);
    }));

  it("ends when its thread closes, after the closing event is delivered (ER-7 as amended)", () =>
    withHost(async (host) => {
      const one = await host.follower("alice");
      await host.subscribe("alice", one, { thread: PR });
      await host.route(event({ kind: "pull_request", text: "Merged.", closes: true }));
      await host.route(event({ text: "late comment" }));
      const heard = await host.heard(one);
      expect(heard).toHaveLength(1);
      expect(heard[0]).toContain("Merged.");
      expect((await host.subscriptionRows("alice")).map((row) => [row.enabled, row.endedReason])).toEqual([[false, "thread_closed"]]);
    }));
});

describe("the cap", () => {
  it("holds deliveries past the cap and tells the session how many were held", () =>
    withHost(
      async (host) => {
        const one = await host.follower("alice");
        await host.subscribe("alice", one, { thread: PR });
        for (let i = 0; i < 4; i += 1) await host.route(event({ text: `review ${i}` }));
        const heard = await host.heard(one);
        expect(heard).toHaveLength(2);
        const rows = await host.subscriptionRows("alice");
        expect(rows).toHaveLength(1);
        const cursor = await host.cursorOf("alice", rows[0]!.id);
        expect(cursor.held).toBe(2);
      },
      { service: { capPerHour: 2 } }
    ));
});
