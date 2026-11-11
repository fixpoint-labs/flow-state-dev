/**
 * Internal events (FIX-2630): a session publishes once on a declared topic,
 * and the routines that follow the topic hear it once, as information, from
 * `service:internal`, through the subscriptions' own routing.
 *
 * Why these matter: the publisher names no recipient and learns nobody who
 * heard, so the topic list, the sender and the budget are the only guards.
 * A misspelt topic must be refused rather than wait forever; the sender must
 * be the server's; a ring of routines announcing to each other must stop at
 * the message budget, and a fan-out's branches must share it (D2).
 */
import { afterEach, describe, expect, it } from "vitest";
import { bootSubscriptionsHost, event, type SubscriptionsHost } from "./subscriptions-harness";

let host: SubscriptionsHost | undefined;
afterEach(async () => {
  await host?.dispose();
  host = undefined;
});

describe("a delivery lands where the event's chain is", () => {
  it("delivers an event that carries a hop and a chain in that chain, one hop on", async () => {
    host = bootSubscriptionsHost();
    const session = await host.follower("alice");
    await host.subscribe("alice", session, { thread: "github:acme/api#412" });
    await host.route(event({ hop: 2, chain: "chain_publisher" }));
    const rows = await host.serviceRows("alice");
    expect(rows.map((row) => [row.hop, row.chain])).toEqual([[3, "chain_publisher"]]);
  });

  it("delivers an event with neither as before: one hop past the owner run's, in its own chain (BP-030)", async () => {
    host = bootSubscriptionsHost();
    const session = await host.follower("alice");
    await host.subscribe("alice", session, { thread: "github:acme/api#412" });
    await host.route(event());
    const rows = await host.serviceRows("alice");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.hop).toBe(1);
    expect(rows[0]!.chain).toMatch(/^chain_/);
  });
});
