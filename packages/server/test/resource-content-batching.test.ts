/**
 * Tests for microtask-batched resource content persistence.
 *
 * Verifies that multiple concurrent writeContent() calls within the same
 * microtask are coalesced into a single store write, eliminating CAS
 * contention and redundant serialization.
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineFlow, defineResource, defineResourceCollection, handler } from "@flow-state-dev/core";
import { createExecutionContext, createInMemoryStores } from "../src";
import type { SessionStore } from "../src/stores/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const artifactResource = defineResource({
  stateSchema: z.object({ version: z.number().default(0) }),
});

const filesCollection = defineResourceCollection({
  pattern: "files/**",
  stateSchema: z.object({ language: z.string() }),
  maxInstances: 10,
  eviction: "none",
});

function makeFlow(options?: {
  sessionResources?: Record<string, any>;
}) {
  const resources = options?.sessionResources ?? { artifact: artifactResource };
  const block = handler({
    name: "noop",
    sessionResources: resources,
    execute: () => "ok",
  });

  return defineFlow({
    kind: "batch-test",
    actions: { run: { inputSchema: z.string(), block } },
  })();
}

async function createCtx(options?: {
  sessionResources?: Record<string, any>;
  stores?: ReturnType<typeof createInMemoryStores>;
}) {
  const stores = options?.stores ?? createInMemoryStores();
  const flow = makeFlow({ sessionResources: options?.sessionResources });
  const ctx = await createExecutionContext({
    flow,
    actionName: "run",
    requestId: "req_1",
    sessionId: "sess_1",
    userId: "user_1",
    stores,
  });
  return { ctx, stores };
}

// ---------------------------------------------------------------------------
// Batching behavior
// ---------------------------------------------------------------------------

describe("resource content write batching", () => {
  it("concurrent writeContent calls are coalesced into a single store write", async () => {
    const stores = createInMemoryStores();
    const originalSet = stores.session.set.bind(stores.session);
    let setCallCount = 0;
    stores.session.set = async (...args: Parameters<SessionStore["set"]>) => {
      setCallCount++;
      return originalSet(...args);
    };

    const { ctx } = await createCtx({
      sessionResources: { files: filesCollection },
      stores,
    });

    const ns = ctx.session.resources.files as any;
    await ns.create("a.ts", { language: "typescript" });
    await ns.create("b.ts", { language: "typescript" });
    await ns.create("c.ts", { language: "typescript" });

    // Reset the counter after setup writes
    setCallCount = 0;

    // Fire three writeContent calls concurrently (same microtask)
    const refA = ns.get("a.ts");
    const refB = ns.get("b.ts");
    const refC = ns.get("c.ts");

    await Promise.all([
      refA.writeContent("content A"),
      refB.writeContent("content B"),
      refC.writeContent("content C"),
    ]);

    // With batching, all three should coalesce into a single store write
    expect(setCallCount).toBe(1);

    // All content should be readable
    expect(await ns.get("a.ts").readContent()).toBe("content A");
    expect(await ns.get("b.ts").readContent()).toBe("content B");
    expect(await ns.get("c.ts").readContent()).toBe("content C");
  });

  it("sequential writeContent calls each trigger a write", async () => {
    const stores = createInMemoryStores();
    const originalSet = stores.session.set.bind(stores.session);
    let setCallCount = 0;
    stores.session.set = async (...args: Parameters<SessionStore["set"]>) => {
      setCallCount++;
      return originalSet(...args);
    };

    const { ctx } = await createCtx({
      sessionResources: { files: filesCollection },
      stores,
    });

    const ns = ctx.session.resources.files as any;
    await ns.create("a.ts", { language: "typescript" });
    setCallCount = 0;

    const ref = ns.get("a.ts");

    // Each await introduces a microtask boundary, so each write
    // fires as a separate batch
    await ref.writeContent("v1");
    await ref.writeContent("v2");
    await ref.writeContent("v3");

    expect(setCallCount).toBe(3);
    expect(await ref.readContent()).toBe("v3");
  });

  it("flushResourceContent drains pending writes", async () => {
    const { ctx } = await createCtx({
      sessionResources: { artifact: artifactResource },
    });

    const resource = (ctx.session.resources as any).artifact;
    await resource.writeContent("initial");
    await ctx.flushResourceContent();

    // After flush, content is persisted
    expect(await resource.readContent()).toBe("initial");
  });

  it("flushResourceContent resolves immediately when no writes pending", async () => {
    const { ctx } = await createCtx();

    // Should resolve without error
    await ctx.flushResourceContent();
  });

  it("static resource writeContent batches correctly", async () => {
    const stores = createInMemoryStores();
    const originalSet = stores.session.set.bind(stores.session);
    let setCallCount = 0;
    stores.session.set = async (...args: Parameters<SessionStore["set"]>) => {
      setCallCount++;
      return originalSet(...args);
    };

    const res1 = defineResource({
      stateSchema: z.object({}),
    });
    const res2 = defineResource({
      stateSchema: z.object({}),
    });

    const { ctx } = await createCtx({
      sessionResources: { doc1: res1, doc2: res2 },
      stores,
    });

    setCallCount = 0;

    const doc1 = (ctx.session.resources as any).doc1;
    const doc2 = (ctx.session.resources as any).doc2;

    // Concurrent writes to two different static resources
    await Promise.all([
      doc1.writeContent("Document 1 content"),
      doc2.writeContent("Document 2 content"),
    ]);

    // Both coalesced into one store write
    expect(setCallCount).toBe(1);

    expect(await doc1.readContent()).toBe("Document 1 content");
    expect(await doc2.readContent()).toBe("Document 2 content");
  });

  it("content is preserved in the store after batched writes", async () => {
    const stores = createInMemoryStores();
    const { ctx } = await createCtx({
      sessionResources: { files: filesCollection },
      stores,
    });

    const ns = ctx.session.resources.files as any;
    await ns.create("readme.md", { language: "markdown" });
    await ns.create("main.ts", { language: "typescript" });

    // Concurrent content writes
    await Promise.all([
      ns.get("readme.md").writeContent("# Hello"),
      ns.get("main.ts").writeContent("const x = 1;"),
    ]);

    // Flush to ensure all writes are committed
    await ctx.flushResourceContent();

    // Verify via the store directly
    const sessionRecord = await stores.session.get("sess_1");
    expect(sessionRecord).toBeDefined();
    expect(sessionRecord!.resourceContent!["files/readme.md"]).toBe("# Hello");
    expect(sessionRecord!.resourceContent!["files/main.ts"]).toBe("const x = 1;");
  });
});
