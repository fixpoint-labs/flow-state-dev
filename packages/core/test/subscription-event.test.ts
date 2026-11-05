/**
 * The normalized subscription event (FIX-2534, epic ER-6): the one shape push
 * and poll map an outside event into before it is routed. GitHub-shaped and
 * Slack-shaped events both fit it; a raw request (headers, bytes) and a body
 * past the text bound do not.
 */
import { describe, expect, it } from "vitest";
import { MAX_SUBSCRIPTION_EVENT_TEXT, subscriptionEventSchema } from "../src/types";

const review = {
  provider: "github",
  threads: ["github:acme/api", "github:acme/api#412"],
  kind: "review",
  object: { id: "review-9001", version: 1 },
  sender: { id: "octocat", name: "The Octocat", role: "member" },
  audience: "public",
  title: "Review on #412",
  text: "Looks good, one nit about the panic path.",
  labels: ["bug"],
  url: "https://github.com/acme/api/pull/412#pullrequestreview-9001",
  received: 1_700_000_000_000,
  at: 1_699_999_999_000,
  deliveryId: "d-1"
};

describe("the normalized subscription event", () => {
  it("takes a GitHub review: threads widest first, a versioned object, a sender with a role", () => {
    const parsed = subscriptionEventSchema.parse(review);
    expect(parsed.threads).toEqual(["github:acme/api", "github:acme/api#412"]);
    expect(parsed.sender.role).toBe("member");
  });

  it("takes a Slack message mapped into the same shape: the event is not GitHub-shaped (epic Q4)", () => {
    // A Slack `message` event, as its Events API sends it.
    const slack = { type: "message", channel: "C024BE91L", user: "U2147483697", text: "Is the deploy out?", ts: "1355517523.000005", thread_ts: "1355517500.000001", team: "T061EG9R6" };
    const mapped = {
      provider: "slack",
      threads: [`slack:${slack.team}/${slack.channel}`, `slack:${slack.team}/${slack.channel}/${slack.thread_ts}`],
      kind: "message",
      object: { id: slack.ts, version: 1 },
      sender: { id: slack.user, name: slack.user, role: "member" },
      audience: "private",
      title: "Message in a thread",
      text: slack.text,
      labels: [],
      url: `https://slack.com/archives/${slack.channel}/p${slack.ts.replace(".", "")}`,
      received: 1_355_517_524_000,
      at: Math.round(Number(slack.ts) * 1000)
    };
    expect(subscriptionEventSchema.safeParse(mapped).success).toBe(true);
  });

  it("refuses raw request parts and an unbounded body: routing reads no headers or bytes", () => {
    expect(subscriptionEventSchema.safeParse({ ...review, headers: { "x-hub-signature": "sha256=…" } }).success).toBe(false);
    expect(subscriptionEventSchema.safeParse({ ...review, text: "x".repeat(MAX_SUBSCRIPTION_EVENT_TEXT + 1) }).success).toBe(false);
  });

  it("refuses an event with no thread to route by, and a sender role outside the five", () => {
    expect(subscriptionEventSchema.safeParse({ ...review, threads: [] }).success).toBe(false);
    expect(subscriptionEventSchema.safeParse({ ...review, sender: { id: "x", name: "x", role: "stranger" } }).success).toBe(false);
  });
});
