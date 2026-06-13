/**
 * Cached-fetch capability — registry-backed scenario.
 *
 * Exercises the parts the stub-based unit tests cannot: capability resolution
 * + collection auto-install, real persistence through the resource registry
 * (read-through within a request and across requests via a shared store), the
 * resource_change SSE event, and count eviction interplay.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createInMemoryStores } from "@flow-state-dev/server";
import { testFlow } from "@flow-state-dev/testing";
import cachedFetchFlow, { counters, resetCounters } from "./fixtures/cached-fetch-flow";
import { findResourceChanges } from "../helpers/assertions";

describe("cached-fetch capability scenario", () => {
  beforeEach(() => resetCounters());

  it("auto-installs the cache collection and serves a same-key read from cache", async () => {
    const result = await testFlow({
      flow: cachedFetchFlow,
      action: "fetch",
      userId: "user-1",
      input: { keys: ["a", "a", "b"] },
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe("completed");
    // "a" twice + "b" once => only two real fetches (the repeat hit the cache).
    expect(counters.fetches).toBe(2);

    // The capability's collection write surfaced as a resource_change event,
    // proving the collection was installed and persisted through the registry.
    const changes = findResourceChanges(result.items, "cache/");
    expect(changes.length).toBeGreaterThan(0);
    expect(changes[0].changeType).toMatch(/created|updated/);
  });

  it("reuses a persisted entry across requests sharing a store", async () => {
    const stores = createInMemoryStores();

    await testFlow({
      flow: cachedFetchFlow,
      action: "fetch",
      userId: "user-1",
      input: { keys: ["x"] },
      stores,
    });
    expect(counters.fetches).toBe(1);

    // A second request for the same user + key finds the persisted envelope.
    await testFlow({
      flow: cachedFetchFlow,
      action: "fetch",
      userId: "user-1",
      input: { keys: ["x"] },
      stores,
    });
    expect(counters.fetches).toBe(1);
  });

  it("bounds cardinality via count eviction", async () => {
    // maxInstances is 3; four distinct keys force one eviction.
    const result = await testFlow({
      flow: cachedFetchFlow,
      action: "fetch",
      userId: "user-1",
      input: { keys: ["k1", "k2", "k3", "k4"] },
    });

    expect(result.status).toBe("completed");
    expect(counters.fetches).toBe(4);
    expect((result.output as { count: number }).count).toBe(3);
  });
});
