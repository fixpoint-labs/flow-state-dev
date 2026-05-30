/**
 * Integration coverage for wave-batched resource prefetch.
 *
 * These tests lock the contract that resources declared on a scope are
 * fetched in dependency-ordered waves before the flow body runs, and that
 * the prefetched values land in the resource cache for handlers to read.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { defineFlow } from "@flow-state-dev/core";
import { createExecutionContext } from "../src/context/createExecutionContext";
import { InMemoryStoreRegistry } from "../src/stores/in-memory";

type FetchLog = string[];

function makeResourceFlow(log: FetchLog) {
  return defineFlow({
    kind: "prefetch-test",
    actions: {
      ask: {
        input: z.object({ q: z.string() }),
        scopes: ["session"]
      }
    },
    resources: {
      // Base resource with no dependencies
      profile: {
        scope: "session",
        fetch: async () => {
          log.push("profile");
          return { tier: "premium" };
        }
      },
      // Depends on profile
      preferences: {
        scope: "session",
        dependsOn: ["profile"],
        fetch: async () => {
          log.push("preferences");
          return { theme: "dark" };
        }
      }
    }
  });
}

describe("wave-batched resource prefetch", () => {
  let stores: InMemoryStoreRegistry;

  beforeEach(() => {
    stores = new InMemoryStoreRegistry();
  });

  it("prefetches all scope resources before the flow body", async () => {
    const log: FetchLog = [];
    const flow = makeResourceFlow(log);
    const ctx = createExecutionContext({
      flow,
      stores,
      runtimeConfig: {}
    });

    await ctx.prefetchResources("session", { q: "hello" });

    expect(log).toContain("profile");
    expect(log).toContain("preferences");
  });

  it("fetches dependency-ordered resources in waves", async () => {
    const log: FetchLog = [];
    const flow = makeResourceFlow(log);
    const ctx = createExecutionContext({
      flow,
      stores,
      runtimeConfig: {}
    });

    await ctx.prefetchResources("session", { q: "hello" });

    // profile must come before preferences (dependency order)
    expect(log.indexOf("profile")).toBeLessThan(log.indexOf("preferences"));
  });

  it("caches prefetched values for handler reads", async () => {
    const log: FetchLog = [];
    const flow = makeResourceFlow(log);
    const ctx = createExecutionContext({
      flow,
      stores,
      runtimeConfig: {}
    });

    await ctx.prefetchResources("session", { q: "hello" });

    // Second access should hit cache, not re-fetch
    const cached = await ctx.getResource("profile");
    expect(cached).toEqual({ tier: "premium" });
    expect(log.filter((r) => r === "profile")).toHaveLength(1);
  });

  it("threads runtimeConfig resolvers into prefetch", async () => {
    const log: FetchLog = [];
    const flow = makeResourceFlow(log);
    const ctx = createExecutionContext({
      flow,
      stores,
      runtimeConfig: {
        modelResolver: () => {
          throw new Error("should not be called during prefetch");
        }
      }
    });

    await ctx.prefetchResources("session", { q: "hello" });

    expect(log).toContain("profile");
  });

  it("isolates resource caches across requests", async () => {
    const logA: FetchLog = [];
    const flowA = makeResourceFlow(logA);
    const ctxA = createExecutionContext({
      flow: flowA,
      stores,
      runtimeConfig: {}
    });

    const logB: FetchLog = [];
    const flowB = makeResourceFlow(logB);
    const ctxB = createExecutionContext({
      flow: flowB,
      stores,
      runtimeConfig: {}
    });

    await ctxA.prefetchResources("session", { q: "a" });
    await ctxB.prefetchResources("session", { q: "b" });

    expect(logA).toEqual(["profile", "preferences"]);
    expect(logB).toEqual(["profile", "preferences"]);
  });
});
