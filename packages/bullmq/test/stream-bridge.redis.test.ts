/**
 * The Redis stream bridge's subscriber, on a real Redis: what it holds for a
 * dispatch that streams events nobody reads.
 *
 * The runner keeps a subscriber per dispatched request and reads only its
 * terminal. Every item update the worker publishes reaches that subscriber,
 * so anything it kept would grow with the reply for as long as the dispatch
 * lived.
 */
import { afterEach, expect, it } from "vitest";
import type { StreamBridgeEvent, StreamSubscriber } from "@flow-state-dev/engine/host";
import { createRedisStreamBridge } from "../src/stream-bridge";
import { REDIS_URL, describeWithRedis, isolatedPrefix } from "./redis-helpers";

describeWithRedis("createRedisStreamBridge — a subscriber nobody reads events from", () => {
  const open: StreamSubscriber[] = [];
  afterEach(async () => {
    await Promise.all(open.splice(0).map((s) => s.close().catch(() => {})));
  });

  it("holds none of the events streamed before a consumer asked for them", async () => {
    const bridge = createRedisStreamBridge({ connection: REDIS_URL!, channelPrefix: isolatedPrefix() });
    const subscriber = bridge.createSubscriber("req_1");
    open.push(subscriber);
    // Let the SUBSCRIBE land before anything is published.
    await new Promise((r) => setTimeout(r, 100));

    const publisher = bridge.createPublisher("req_1");
    for (let i = 0; i < 200; i++) {
      await publisher.publishEvent({ event: "item.updated", data: JSON.stringify({ text: "x".repeat(i) }) });
    }
    await publisher.publishTerminal({ output: "done" } as never);
    await publisher.close();
    await expect(subscriber.completed).resolves.toEqual({ output: "done" });

    // A consumer that arrives now finds nothing kept for it: the 200 updates
    // were dropped as they came, not held for a reader that never came.
    const late: StreamBridgeEvent[] = [];
    for await (const event of subscriber.events()) late.push(event);
    expect(late).toEqual([]);
  });

  it("still delivers the events that stream once a consumer is reading", async () => {
    const bridge = createRedisStreamBridge({ connection: REDIS_URL!, channelPrefix: isolatedPrefix() });
    const subscriber = bridge.createSubscriber("req_2");
    open.push(subscriber);
    const reading = (async () => {
      const seen: string[] = [];
      for await (const event of subscriber.events()) seen.push(event.data);
      return seen;
    })();
    await new Promise((r) => setTimeout(r, 100));

    const publisher = bridge.createPublisher("req_2");
    await publisher.publishEvent({ event: "item.added", data: "a" });
    await publisher.publishEvent({ event: "item.done", data: "b" });
    await publisher.publishTerminal({ output: "done" } as never);
    await publisher.close();

    await expect(reading).resolves.toEqual(["a", "b"]);
  });
});
