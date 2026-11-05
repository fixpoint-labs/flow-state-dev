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
import { describe, expect, it, vi } from "vitest";
import { deliveryMessageId } from "../src/subscriptions";
import { bootSubscriptionsHost, event, revoked, type SubscriptionsHost } from "./subscriptions-harness";

const PR = "github:acme/api#412";
const REPO = "github:acme/api";

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

  // An accepted dispatch isn't a landed message: a recipient request that fails
  // before taking it must leave the event for its next delivery, or it is lost.
  it("lands on the next delivery when the recipient's request was accepted and failed before taking it", () =>
    withHost(async (host) => {
      const one = await host.follower("alice");
      await host.subscribe("alice", one, { thread: PR });
      const review = event({ text: "accepted, never taken" });
      const take = await host.failFirstTake();
      await host.route(review);
      take.restore();
      expect(take.failed()).toBe(1);
      expect(await host.heard(one)).toEqual([]);
      await host.route({ ...review, deliveryId: "redelivered" });
      expect(await host.heard(one)).toHaveLength(1);
      // Landed, it is seen: a third copy adds nothing and costs the cap nothing.
      await host.route({ ...review, deliveryId: "again" });
      expect(await host.heard(one)).toHaveLength(1);
      expect(await host.serviceRows("alice")).toHaveLength(1);
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

  it("apply every listed screen of one kind: two words screens both must pass", () =>
    withHost(async (host) => {
      const both = await host.follower("alice");
      await host.subscribe("alice", both, {
        thread: PR,
        screens: [
          { screen: "words", any: ["panic"] },
          { screen: "words", any: ["crash"] }
        ]
      });
      await host.route(event({ text: "This will panic." }));
      expect(await host.heard(both)).toEqual([]);
      await host.route(event({ text: "This will panic, then crash." }));
      expect(await host.heard(both)).toHaveLength(1);
    }));

  it("return one verdict per nominated subscription, and no share: the routed output is bounded production output", () =>
    withHost(async (host) => {
      const listed = await host.follower("alice");
      const open = await host.follower("alice");
      await host.subscribe("alice", listed, { thread: PR, screens: [{ screen: "words", any: ["panic"] }] });
      await host.subscribe("alice", open, { thread: PR });
      const routed = await host.route(event({ text: "no match here" }));
      const output = routed.output as Record<string, unknown> & { verdicts: Array<{ pass: boolean }>; verdictsCut: number };
      expect(output.verdicts.map((v) => v.pass).sort()).toEqual([false, true]);
      expect(output.verdictsCut).toBe(0);
      expect(Object.keys(output).sort()).toEqual(["ownerRuns", "verdicts", "verdictsCut"]);
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

  it("delivers under the subscribing session's tenant: the row, the index and the owner run carry it", () =>
    withHost(async (host) => {
      const one = await host.followerInTenant("alice", "tenant-a");
      expect(await host.subscribe("alice", one, { thread: PR }, "tenant-a")).toHaveProperty("id");
      expect((await host.subscriptionRows("alice"))[0]).toMatchObject({ tenantId: "tenant-a" });
      const routed = await host.route(event({ text: "for the tenant" }));
      expect(routed.ownerRuns.map((run) => run.run.owner.tenantId)).toEqual(["tenant-a"]);
      expect((await host.serviceRows("alice")).map((row) => [row.toSession, row.status])).toEqual([[one, "delivered"]]);
    }));

  it("keeps one user's same-id sessions in two tenants apart: each subscribes, and each tenant's session hears the event", () =>
    withHost(async (host) => {
      // A session id is unique within a tenant only, and both tenants' rows share the user's cell.
      const one = await host.followerInTenant("alice", "tenant-a", "sess-shared");
      const two = await host.followerInTenant("alice", "tenant-b", "sess-shared");
      expect([one, two]).toEqual(["sess-shared", "sess-shared"]);
      const a = (await host.subscribe("alice", one, { thread: PR }, "tenant-a")) as { id: string };
      const b = (await host.subscribe("alice", two, { thread: PR }, "tenant-b")) as { id: string };
      expect(a.id).not.toBe(b.id);
      expect((await host.subscriptionRows("alice")).map((row) => row.tenantId).sort()).toEqual(["tenant-a", "tenant-b"]);
      const routed = await host.route(event({ text: "for both tenants" }));
      expect(routed.ownerRuns.map((run) => run.run.owner.tenantId).sort()).toEqual(["tenant-a", "tenant-b"]);
      // Two deliveries of one event to one session id, one per tenant: two log rows, not one overwritten.
      expect((await host.serviceRows("alice")).map((row) => row.status)).toEqual(["delivered", "delivered"]);
    }));

  it("names a delivery by its tenant too, and keeps a session with no tenant on the id it had", () => {
    const object = { id: "review/1", version: 3 };
    expect(deliveryMessageId(object, "sess-1")).toBe("sub_review%2F1@3:sess-1");
    const ids = new Set([deliveryMessageId(object, "sess-1"), deliveryMessageId(object, "sess-1", "tenant-a"), deliveryMessageId(object, "sess-1", "tenant-b")]);
    expect(ids.size).toBe(3);
  });

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

  it("ends only the subscriptions to the thread that closed: one to the whole repo keeps hearing it", () =>
    withHost(async (host) => {
      const pr = await host.follower("alice");
      const repo = await host.follower("alice");
      await host.subscribe("alice", pr, { thread: PR });
      await host.subscribe("alice", repo, { thread: REPO });
      await host.route(event({ kind: "pull_request", text: "Merged.", closes: true }));
      await host.route(event({ threads: [REPO, "github:acme/api#500"], text: "a review on another PR" }));
      expect(await host.heard(repo)).toHaveLength(2);
      const rows = await host.subscriptionRows("alice");
      expect(Object.fromEntries(rows.map((row) => [row.thread, row.enabled]))).toEqual({ [REPO]: true, [PR]: false });
    }));

  it("ends on its thread's closing even when the closing event doesn't reach it: another kind, a screen, its own action, the cap", () =>
    withHost(
      async (host) => {
        const kinds = await host.follower("alice");
        const words = await host.follower("alice");
        const own = await host.follower("alice");
        const capped = await host.follower("bob");
        await host.subscribe("alice", kinds, { thread: PR, kinds: ["review"] });
        await host.subscribe("alice", words, { thread: PR, screens: [{ screen: "words", any: ["benchmark"] }] });
        await host.subscribe("alice", own, { thread: PR, kinds: ["pull_request"] });
        await host.subscribe("bob", capped, { thread: PR });
        // Bob's subscription spends its one message of the hour.
        await host.route(event({ text: "a first review" }));
        // Alice merges the PR herself.
        await host.route(event({ kind: "pull_request", text: "Merged.", closes: true, sender: { id: "alice-gh", name: "Alice", role: "member" } }));
        for (const user of ["alice", "bob"]) {
          expect((await host.subscriptionRows(user)).map((row) => [row.enabled, row.endedReason])).toEqual(
            (await host.subscriptionRows(user)).map(() => [false, "thread_closed"])
          );
        }
        expect(await host.subscriptionRows("alice")).toHaveLength(3);
        // Nothing reaches them after: the hour's slots aren't spent for alice's `words` and `own`, so only the end stops them.
        const before = await Promise.all([kinds, words, own, capped].map((session) => host.heard(session)));
        await host.route(event({ text: "a late review that mentions the benchmark" }));
        expect(await Promise.all([kinds, words, own, capped].map((session) => host.heard(session)))).toEqual(before);
        expect(before.map((heard) => heard.length)).toEqual([1, 0, 0, 1]);
      },
      { service: { capPerHour: 1 } }
    ));
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

  it("holds all but one of five events that arrive at once, with a cap of one: the slot is taken in one write", () =>
    withHost(
      async (host) => {
        const one = await host.follower("alice");
        await host.subscribe("alice", one, { thread: PR });
        const burst = await Promise.all(Array.from({ length: 5 }, (_, i) => host.route(event({ text: `burst ${i}` }))));
        const acts = await Promise.all(burst.map(async (routed) => ((await routed.ownerRuns[0]!.finished!).output as { act: string }).act));
        expect(acts.sort()).toEqual(["held", "held", "held", "held", "sent"]);
        expect(await host.heard(one)).toHaveLength(1);
        const cursor = await host.cursorOf("alice", (await host.subscriptionRows("alice"))[0]!.id);
        expect([cursor.window.sent, cursor.held]).toEqual([1, 4]);
      },
      { service: { capPerHour: 1 } }
    ));

  // Two copies of one event in flight at once (a webhook redelivered while the
  // first is still sending) are one message: they must cost one slot, or one
  // event spends a second slot a later event needed.
  it("spends one slot on two copies of one event that arrive at once, and sends the next event", () =>
    withHost(
      async (host) => {
        const one = await host.follower("alice");
        await host.subscribe("alice", one, { thread: PR });
        const review = event({ text: "the first" });
        const gate = await host.holdFirstDispatch("onMessageReceived");
        const first = host.route(review);
        await gate.reached;
        // The copy arrives while the first is still sending.
        const copy = await host.routeBeside({ ...review, deliveryId: "redelivered" });
        gate.release();
        await first;
        expect(await host.heard(one)).toHaveLength(1);
        expect((await host.cursorOf("alice", (await host.subscriptionRows("alice"))[0]!.id)).window.sent).toBe(1);
        await host.route(event({ text: "the next" }));
        const heard = await host.heard(one);
        expect(heard).toHaveLength(2);
        expect(heard[1]).toContain("the next");
        expect(copy).toEqual([{ act: "inflight" }]);
      },
      { service: { capPerHour: 2 } }
    ));

  // The copy that finds the first still sending must not mark the event seen:
  // if the first's dispatch is then lost, the event's next delivery is the only
  // way it reaches the session.
  it("sends a redelivery after the first of two copies at once lost its dispatch, with a cap of one", () =>
    withHost(
      async (host) => {
        const one = await host.follower("alice");
        await host.subscribe("alice", one, { thread: PR });
        const review = event({ text: "lost while a copy was in flight" });
        const gate = await host.holdFirstDispatch("onMessageReceived");
        const first = host.route(review);
        await gate.reached;
        // The copy finds the only slot taken, by the first: it is in flight, not held.
        const copy = await host.routeBeside({ ...review, deliveryId: "copy" });
        gate.release({ lose: true });
        await first;
        expect(await host.heard(one)).toEqual([]);
        await host.route({ ...review, deliveryId: "redelivered" });
        const heard = await host.heard(one);
        expect(heard).toHaveLength(1);
        expect(heard[0]).toContain("lost while a copy was in flight");
        expect(copy).toEqual([{ act: "inflight" }]);
      },
      { service: { capPerHour: 1 } }
    ));

  it("rolls the hour over when only holds came since the window opened", () =>
    withHost(
      async (host) => {
        const one = await host.follower("alice");
        await host.subscribe("alice", one, { thread: PR });
        await host.route(event({ text: "sent" }));
        await host.route(event({ text: "held one" }));
        await host.route(event({ text: "held two" }));
        expect(await host.heard(one)).toHaveLength(1);
        const real = Date.now;
        const later = vi.spyOn(Date, "now").mockImplementation(() => real() + 61 * 60 * 1000);
        try {
          await host.route(event({ text: "an hour on" }));
        } finally {
          later.mockRestore();
        }
        const heard = await host.heard(one);
        expect(heard).toHaveLength(2);
        expect(heard[1]).toContain("2 earlier events were held");
      },
      { service: { capPerHour: 1 } }
    ));
});

describe("the thread index", () => {
  it("keeps both of two users' subscriptions to one PR made at once", () =>
    withHost(async (host) => {
      const alice = await host.follower("alice");
      const bob = await host.follower("bob");
      const subscribed = await Promise.all([host.subscribe("alice", alice, { thread: PR }), host.subscribe("bob", bob, { thread: PR })]);
      for (const outcome of subscribed) expect(outcome).toHaveProperty("id");
      await host.route(event({ text: "both hear it" }));
      expect(await host.heard(alice)).toHaveLength(1);
      expect(await host.heard(bob)).toHaveLength(1);
    }));
});
